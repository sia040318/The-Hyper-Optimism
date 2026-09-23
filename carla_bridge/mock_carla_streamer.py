"""
Mock CARLA & MediaPipe Telemetry Streamer
Simulates a live CARLA simulation feed and MediaPipe gaze tracking,
streaming 3D relative threat vectors over a local WebSocket server (ws://127.0.0.1:8765).
"""

import asyncio
import json
import math
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

app = FastAPI(title="CARLA & ADAS Spatial Audio Streamer")

class TelemetryBroadcaster:
    def __init__(self):
        self.active_connections = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[WebSocket] Client connected! Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[WebSocket] Client disconnected. Remaining: {len(self.active_connections)}")

    async def broadcast(self, data: dict):
        if not self.active_connections:
            return
        payload = json.dumps(data)
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                disconnected.append(connection)
        for dead in disconnected:
            self.disconnect(dead)

broadcaster = TelemetryBroadcaster()

@app.websocket("/")
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await broadcaster.connect(websocket)
    try:
        while True:
            # Keep alive and listen for any client messages
            msg = await websocket.receive_text()
            print(f"[Client Message]: {msg}")
    except WebSocketDisconnect:
        broadcaster.disconnect(websocket)
    except Exception as e:
        broadcaster.disconnect(websocket)

async def simulation_loop():
    """Generates continuous simulated CARLA traffic telemetry at 30 Hz"""
    sim_time = 0.0
    print("[Simulation] Mock CARLA traffic engine started (30 Hz)...")

    while True:
        await asyncio.sleep(1.0 / 30.0) # 30 Hz
        sim_time += 1.0 / 30.0

        # Simulate a car overtaking in Left Blind Spot
        # CARLA coordinate convention: rel_x = forward (+), rel_y = right (+), rel_z = up (+)
        left_lane_y = -3.5 # Left adjacent lane
        left_forward_x = -20.0 + (sim_time * 4.5) % 28.0 # Moves from -20m (behind) to +8m (ahead)
        left_dist = math.sqrt(left_forward_x**2 + left_lane_y**2)
        left_azimuth = math.atan2(left_lane_y, left_forward_x) * (180.0 / math.pi)

        # Simulate a tailgater directly behind
        rear_forward_x = -25.0 + math.sin(sim_time * 0.8) * 6.0
        rear_dist = abs(rear_forward_x)

        # Simulated driver gaze (looks at left mirror periodically)
        gaze_zone = "CENTER"
        if 8.0 < (sim_time % 12.0) < 10.5 and left_dist < 12.0:
            gaze_zone = "LEFT_MIRROR"

        telemetry_frame = {
            "timestamp": time.time(),
            "ego": {
                "speed_kmh": 65.4,
                "gear": 4,
                "gaze_zone": gaze_zone,
                "gaze_confidence": 0.95
            },
            "threats": [
                {
                    "id": 101,
                    "type": "vehicle.tesla.model3",
                    "rel_x": round(left_forward_x, 2), # CARLA forward
                    "rel_y": round(left_lane_y, 2),     # CARLA right
                    "rel_z": 0.2,
                    "distance": round(left_dist, 2),
                    "azimuth_deg": round(left_azimuth, 1),
                    "target_proxy": "LEFT_MIRROR",
                    "urgency_level": "CRITICAL" if left_dist < 7 else ("WARNING" if left_dist < 15 else "AWARENESS")
                },
                {
                    "id": 102,
                    "type": "vehicle.audi.tt",
                    "rel_x": round(rear_forward_x, 2),
                    "rel_y": 0.0,
                    "rel_z": 0.2,
                    "distance": round(rear_dist, 2),
                    "azimuth_deg": 180.0,
                    "target_proxy": "REAR_MIRROR",
                    "urgency_level": "CRITICAL" if rear_dist < 7 else ("WARNING" if rear_dist < 15 else "AWARENESS")
                }
            ]
        }

        await broadcaster.broadcast(telemetry_frame)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(simulation_loop())

if __name__ == "__main__":
    print("=" * 60)
    print("🚗 CARLA & ADAS Spatial Audio Mock Streamer")
    print("Broadcasting on ws://127.0.0.1:8765")
    print("Open index.html in your browser to see live CARLA HUD data!")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
