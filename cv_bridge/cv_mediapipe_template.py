"""
MediaPipe Face Mesh Driver Monitoring & Gaze Streamer for ADAS Spatial Audio
Computes 3D Head Pose (Pitch, Yaw, Roll) via cv2.solvePnP, classifies gaze zone,
applies dwell time filtering, and streams JSON telemetry over WebSocket.
"""

import cv2
import mediapipe as mp
import numpy as np
import asyncio
import json
import time
import websockets
from typing import Optional
from pathlib import Path
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# WebSocket Configuration
WS_HOST = "127.0.0.1"
WS_PORT = 8765
MODEL_PATH = Path(__file__).parent / "models" / "face_landmarker.task"

# 3D Reference Model Points for Head Pose Estimation (in canonical mm units)
MODEL_POINTS_3D = np.array([
    (0.0, 0.0, 0.0),          # Nose tip (landmark 1)
    (0.0, -330.0, -65.0),      # Chin (landmark 152)
    (-225.0, 170.0, -135.0),   # Left eye left corner (landmark 33)
    (225.0, 170.0, -135.0),    # Right eye right corner (landmark 263)
    (-150.0, -150.0, -125.0),  # Left Mouth corner (landmark 61)
    (150.0, -150.0, -125.0)    # Right mouth corner (landmark 291)
], dtype=np.float64)

# MediaPipe landmark indices corresponding to the 3D model points
LANDMARK_INDICES = [1, 152, 33, 263, 61, 291]
EYE_CORNERS = ((33, 133), (263, 362))
IRIS_INDICES = (range(468, 473), range(473, 478))


def estimate_iris_ratio(landmarks) -> Optional[float]:
    """Return horizontal iris position from the driver's mirrored view."""
    if len(landmarks) < 478:
        return None

    eye_positions = []
    for (corner_a, corner_b), iris_indices in zip(EYE_CORNERS, IRIS_INDICES):
        corner_x = sorted((landmarks[corner_a].x, landmarks[corner_b].x))
        eye_width = corner_x[1] - corner_x[0]
        if eye_width <= 0:
            return None
        iris_x = sum(landmarks[index].x for index in iris_indices) / len(iris_indices)
        eye_positions.append((iris_x - corner_x[0]) / eye_width)

    image_ratio = sum(eye_positions) / len(eye_positions)
    return round(1.0 - min(1.0, max(0.0, image_ratio)), 2)

class DriverGazeTracker:
    def __init__(self):
        self.current_zone = "CENTER"
        self.zone_start_time = time.time()
        self.dwell_time_ms = 0

    def classify_zone(self, iris_ratio: Optional[float], yaw_deg: float, pitch_deg: float) -> str:
        """Use iris position for side glances and head pitch for the rear mirror."""
        if pitch_deg >= 14.0 and abs(yaw_deg) <= 18.0:
            return "REAR_MIRROR"
        if iris_ratio is None:
            return "UNKNOWN"
        if iris_ratio <= 0.45:
            return "LEFT_MIRROR"
        elif iris_ratio >= 0.55:
            return "RIGHT_MIRROR"
        return "CENTER"

    def process_frame(self, frame: np.ndarray, landmarks):
        h, w, _ = frame.shape
        if not landmarks:
            return None
        iris_ratio = estimate_iris_ratio(landmarks)

        # Extract 2D image coordinates for the 6 reference points
        image_points = []
        for idx in LANDMARK_INDICES:
            pt = landmarks[idx]
            image_points.append([pt.x * w, pt.y * h])
        image_points = np.array(image_points, dtype=np.float64)

        # Approximate Camera Matrix
        focal_length = w
        center = (w / 2, h / 2)
        camera_matrix = np.array([
            [focal_length, 0, center[0]],
            [0, focal_length, center[1]],
            [0, 0, 1]
        ], dtype=np.float64)
        dist_coeffs = np.zeros((4, 1))

        # Solve Perspective-n-Point (PnP) for Head Pose
        success, rvec, tvec = cv2.solvePnP(
            MODEL_POINTS_3D,
            image_points,
            camera_matrix,
            dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE
        )

        if success:
            # Convert rotation vector to Euler Angles (Pitch, Yaw, Roll)
            rmat, _ = cv2.Rodrigues(rvec)
            proj_matrix = np.hstack((rmat, tvec))
            _, _, _, _, _, _, euler_angles = cv2.decomposeProjectionMatrix(proj_matrix)

            pitch = float(euler_angles[0][0])
            yaw = float(euler_angles[1][0])
            roll = float(euler_angles[2][0])
            if pitch > 90.0:
                pitch -= 180.0
            elif pitch < -90.0:
                pitch += 180.0
        else:
            pitch = yaw = roll = 0.0

        # Zone classification with dwell time tracking
        new_zone = self.classify_zone(iris_ratio, yaw, pitch)
        now = time.time()
        if new_zone == self.current_zone:
            self.dwell_time_ms = int((now - self.zone_start_time) * 1000)
        else:
            self.current_zone = new_zone
            self.zone_start_time = now
            self.dwell_time_ms = 0

        return {
            "type": "GAZE_UPDATE",
            "timestamp": now,
            "gaze_zone": self.current_zone,
            "confidence": 0.95 if iris_ratio is not None else 0.0,
            "iris_ratio": iris_ratio,
            "head_pose": {
                "pitch": round(pitch, 2),
                "yaw": round(yaw, 2),
                "roll": round(roll, 2)
            },
            "dwell_time_ms": self.dwell_time_ms,
            "face_detected": True
        }

async def main():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"MediaPipe model not found: {MODEL_PATH}. See cv_bridge/models/face_landmarker.txt."
        )

    tracker = DriverGazeTracker()
    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("[CV Error] Could not open webcam. Using mock telemetry mode.")
        landmarker.close()
        return

    print(f"[CV Streamer] Starting WebSocket server on ws://{WS_HOST}:{WS_PORT} ...")

    connected_clients = set()

    async def ws_handler(websocket):
        connected_clients.add(websocket)
        print(f"[CV Bridge] Web Cockpit connected! (Total clients: {len(connected_clients)})")
        try:
            async for message in websocket:
                pass  # Listen for incoming pings/acks
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            connected_clients.remove(websocket)
            print("[CV Bridge] Web Cockpit disconnected.")

    # Start WebSocket server
    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)

    print("[CV Streamer] Streaming iris gaze and head pose. Press 'q' in video window to exit.")
    started_at = time.monotonic()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1) # Mirror preview
            frame_height, frame_width = frame.shape[:2]
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            timestamp_ms = int((time.monotonic() - started_at) * 1000)
            results = landmarker.detect_for_video(image, timestamp_ms)
            face_landmarks = results.face_landmarks[0] if results.face_landmarks else None
            data = tracker.process_frame(frame, face_landmarks)

            if data and connected_clients:
                payload = json.dumps(data)
                websockets.broadcast(connected_clients, payload)

            if data:
                zone = data["gaze_zone"]
                yaw = data["head_pose"]["yaw"]
                pitch = data["head_pose"]["pitch"]
                dwell = data["dwell_time_ms"]
                iris_ratio = data["iris_ratio"]
                color = (0, 255, 0) if zone != "CENTER" else (255, 255, 255)
                cv2.putText(frame, f"GAZE: {zone} ({dwell}ms)", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)
                ratio_text = f"{iris_ratio:.2f}" if iris_ratio is not None else "unavailable"
                cv2.putText(frame, f"Iris ratio: {ratio_text}", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 220, 255), 2)
                cv2.putText(frame, f"Head yaw: {yaw:.1f} | pitch: {pitch:.1f}", (20, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2)

            cv2.imshow("Driver Monitoring System (CV Team)", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

            await asyncio.sleep(0.01) # Yield to event loop (~60 FPS)
    finally:
        cap.release()
        cv2.destroyAllWindows()
        landmarker.close()
        server.close()
        await server.wait_closed()

if __name__ == "__main__":
    asyncio.run(main())
