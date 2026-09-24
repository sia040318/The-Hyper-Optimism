"""Standalone driver direction proof of concept.

This module estimates eye-gaze direction from MediaPipe iris landmarks and
confirms LEFT, CENTER, or RIGHT only after a direction is stable long enough.
Head pose is shown as a secondary diagnostic signal.
It intentionally has no WebSocket, React, audio, or CARLA integration (test purpose only).
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

Direction = Literal["LEFT", "CENTER", "RIGHT"]

MODEL_PATH = Path(__file__).parent / "models" / "face_landmarker.task"
LANDMARK_INDICES = {
    "nose": 1,
    "chin": 152,
    "left_eye": 33,
    "right_eye": 263,
    "left_mouth": 61,
    "right_mouth": 291,
}

FACE_3D_MODEL = np.array(
    [
        (0.0, 0.0, 0.0),
        (0.0, -63.6, -12.5),
        (-43.3, 32.7, -26.0),
        (43.3, 32.7, -26.0),
        (-28.9, -28.9, -24.1),
        (28.9, -28.9, -24.1),
    ],
    dtype=np.float64,
)

EYE_CORNERS = ((33, 133), (263, 362))
IRIS_INDICES = (range(468, 473), range(473, 478))


@dataclass(frozen=True)
class StabilizationState:
    raw_direction: Direction
    candidate_direction: Direction
    confirmed_direction: Direction | None
    candidate_duration_ms: int


class DirectionStabilizer:
    """Confirm a raw direction only after it remains unchanged long enough."""

    def __init__(self, confirmation_ms: int = 500) -> None:
        if confirmation_ms <= 0:
            raise ValueError("confirmation_ms must be greater than zero")
        self.confirmation_ms = confirmation_ms
        self._candidate_direction: Direction | None = None
        self._candidate_started_at: float | None = None
        self._confirmed_direction: Direction | None = None

    def update(self, raw_direction: Direction, now: float | None = None) -> StabilizationState:
        current_time = time.monotonic() if now is None else now

        if raw_direction != self._candidate_direction:
            self._candidate_direction = raw_direction
            self._candidate_started_at = current_time

        if self._candidate_started_at is None:
            self._candidate_started_at = current_time

        candidate_duration_ms = int(
            max(0.0, current_time - self._candidate_started_at) * 1000
        )
        if candidate_duration_ms >= self.confirmation_ms:
            self._confirmed_direction = raw_direction

        return StabilizationState(
            raw_direction=raw_direction,
            candidate_direction=raw_direction,
            confirmed_direction=self._confirmed_direction,
            candidate_duration_ms=candidate_duration_ms,
        )

    def reset(self) -> None:
        self._candidate_direction = None
        self._candidate_started_at = None
        self._confirmed_direction = None


def classify_direction(
    yaw_degrees: float,
    left_threshold: float = -20.0,
    right_threshold: float = 20.0,
) -> Direction:
    """Map head yaw to a direction using configurable dead-zone thresholds."""
    if left_threshold >= right_threshold:
        raise ValueError("left_threshold must be less than right_threshold")
    if yaw_degrees <= left_threshold:
        return "LEFT"
    if yaw_degrees >= right_threshold:
        return "RIGHT"
    return "CENTER"


def estimate_eye_position(
    landmarks: list[object],
    mirror_input: bool = False,
) -> float | None:
    """Return the average horizontal iris position in the driver's view.

    MediaPipe reports normalized image coordinates. The runtime sends an
    already mirrored frame to MediaPipe, so no second inversion is needed.
    Set mirror_input=True only for an unmirrored camera frame.
    """
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

    position = sum(eye_positions) / len(eye_positions)
    return 1.0 - position if mirror_input else position


def classify_eye_gaze(
    landmarks: list[object],
    left_threshold: float = 0.42,
    right_threshold: float = 0.58,
    mirror_input: bool = False,
) -> Direction | None:
    """Classify gaze from iris position relative to both eye openings."""
    if left_threshold >= right_threshold:
        raise ValueError("left_threshold must be less than right_threshold")
    position = estimate_eye_position(landmarks, mirror_input=mirror_input)
    if position is None:
        return None
    if position <= left_threshold:
        return "LEFT"
    if position >= right_threshold:
        return "RIGHT"
    return "CENTER"


def estimate_head_pose(
    landmarks: list[object],
    frame_width: int,
    frame_height: int,
) -> tuple[float, float, float] | None:
    """Return pitch, yaw, roll in degrees, or None when PnP cannot solve."""
    image_points = np.array(
        [
            (
                landmarks[index].x * frame_width,
                landmarks[index].y * frame_height,
            )
            for index in LANDMARK_INDICES.values()
        ],
        dtype=np.float64,
    )
    focal_length = frame_width
    camera_matrix = np.array(
        [
            [focal_length, 0, frame_width / 2],
            [0, focal_length, frame_height / 2],
            [0, 0, 1],
        ],
        dtype=np.float64,
    )
    distortion = np.zeros((4, 1), dtype=np.float64)

    solved, rotation_vector, translation_vector = cv2.solvePnP(
        FACE_3D_MODEL,
        image_points,
        camera_matrix,
        distortion,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not solved:
        return None

    rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
    projection_matrix = np.hstack((rotation_matrix, translation_vector))
    *_, euler_angles = cv2.decomposeProjectionMatrix(projection_matrix)
    pitch = float(euler_angles[0][0])
    yaw = float(euler_angles[1][0])
    roll = float(euler_angles[2][0])

    if pitch > 90:
        pitch -= 180
    elif pitch < -90:
        pitch += 180

    return pitch, yaw, roll


def draw_label(frame: np.ndarray, text: str, position: tuple[int, int], color: tuple[int, int, int]) -> None:
    cv2.putText(
        frame,
        text,
        position,
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        color,
        2,
        cv2.LINE_AA,
    )


def run(camera_index: int, confirmation_ms: int) -> None:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"MediaPipe model not found: {MODEL_PATH}")

    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    capture = cv2.VideoCapture(camera_index)
    stabilizer = DirectionStabilizer(confirmation_ms)
    started_at = time.monotonic()

    if not capture.isOpened():
        landmarker.close()
        raise RuntimeError(f"Could not open webcam at index {camera_index}")

    try:
        while True:
            success, frame = capture.read()
            if not success:
                raise RuntimeError("Could not read a frame from the webcam")

            frame = cv2.flip(frame, 1)
            frame_height, frame_width = frame.shape[:2]
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            timestamp_ms = int((time.monotonic() - started_at) * 1000)
            result = landmarker.detect_for_video(image, timestamp_ms)

            if result.face_landmarks:
                landmarks = result.face_landmarks[0]
                for landmark in landmarks:
                    cv2.circle(
                        frame,
                        (int(landmark.x * frame_width), int(landmark.y * frame_height)),
                        1,
                        (0, 180, 0),
                        -1,
                    )

                # The frame was flipped above; avoid a second mirror inversion.
                raw_direction = classify_eye_gaze(landmarks, mirror_input=False)
                if raw_direction is not None:
                    state = stabilizer.update(raw_direction)
                    confirmed = state.confirmed_direction or "WAITING"
                    eye_position = estimate_eye_position(landmarks)
                    draw_label(frame, f"RAW GAZE: {state.raw_direction}", (20, 35), (0, 220, 255))
                    draw_label(frame, f"CONFIRMED GAZE: {confirmed}", (20, 70), (0, 255, 0))
                    draw_label(
                        frame,
                        f"STABLE: {state.candidate_duration_ms}/{confirmation_ms} ms",
                        (20, 105),
                        (255, 220, 0),
                    )
                    draw_label(
                        frame,
                        f"EYE POSITION: {eye_position:.2f}",
                        (20, 140),
                        (220, 220, 220),
                    )

                    pose = estimate_head_pose(landmarks, frame_width, frame_height)
                    if pose is not None:
                        pitch, yaw, roll = pose
                        draw_label(
                            frame,
                            f"HEAD Yaw: {yaw:6.1f}  Pitch: {pitch:6.1f}  Roll: {roll:6.1f}",
                            (20, 175),
                            (180, 180, 180),
                        )
                else:
                    stabilizer.reset()
                    draw_label(frame, "EYE GAZE: UNAVAILABLE", (20, 35), (0, 0, 255))
            else:
                stabilizer.reset()
                draw_label(frame, "NO FACE", (20, 35), (0, 0, 255))

            draw_label(frame, "Press Q to quit", (20, frame_height - 20), (220, 220, 220))
            cv2.imshow("Standalone Driver Monitoring", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        capture.release()
        cv2.destroyAllWindows()
        landmarker.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0, help="Webcam device index")
    parser.add_argument(
        "--confirmation-ms",
        type=int,
        default=500,
        help="Required stable duration before confirming a direction",
    )
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    try:
        run(arguments.camera, arguments.confirmation_ms)
    except (FileNotFoundError, RuntimeError) as error:
        print(f"[CV Error] {error}", file=sys.stderr)
        raise SystemExit(1)
