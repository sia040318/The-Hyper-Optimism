"""
Mock Driver Gaze Streamer for Testing (Zero External Dependencies)
Runs a local WebSocket server that simulates driver head movements and mirror checks
without requiring a physical webcam or MediaPipe installation.
"""

import asyncio
import json
import math
import random
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

app = FastAPI(title="Mock Driver Gaze Streamer")

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[Mock CV] Web Cockpit connected! Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[Mock CV] Web Cockpit disconnected. Remaining: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        payload = json.dumps(message)
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.disconnect(d)

manager = ConnectionManager()

@app.websocket("/")
@app.websocket("/gaze")
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection open and read any client pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

async def simulation_loop():
    """Simulates realistic driver head gaze cycles: Center -> Mirror Check -> Center"""
    print("[Mock CV] Simulation loop started at 30 Hz. Waiting for clients...")
    
    zones = ["CENTER", "LEFT_MIRROR", "RIGHT_MIRROR", "REAR_MIRROR"]
    current_zone = "CENTER"
    zone_start = time.time()
    next_switch_time = time.time() + 4.0

    while True:
        now = time.time()
        
        # Periodic switch simulation
        if now >= next_switch_time:
            # 60% chance center, 40% chance mirror check
            if current_zone != "CENTER":
                current_zone = "CENTER"
                next_switch_time = now + random.uniform(3.0, 6.0)
            else:
                current_zone = random.choice(["LEFT_MIRROR", "RIGHT_MIRROR", "REAR_MIRROR"])
                next_switch_time = now + random.uniform(1.2, 2.5) # Dwell duration
            zone_start = now

        dwell_ms = int((now - zone_start) * 1000)

        # Generate realistic head pose angles matching the zone with subtle micro-tremor
        noise = random.uniform(-0.5, 0.5)
        if current_zone == "LEFT_MIRROR":
            yaw = -30.0 + noise
            pitch = 2.0 + noise
        elif current_zone == "RIGHT_MIRROR":
            yaw = 32.0 + noise
            pitch = 1.0 + noise
        elif current_zone == "REAR_MIRROR":
            yaw = -2.0 + noise
            pitch = 16.0 + noise
        else:
            yaw = 0.0 + noise
            pitch = 0.0 + noise

        data = {
            "type": "GAZE_UPDATE",
            "timestamp": now,
            "gaze_zone": current_zone,
            "confidence": round(random.uniform(0.92, 0.98), 2),
            "head_pose": {
                "pitch": round(pitch, 2),
                "yaw": round(yaw, 2),
                "roll": round(noise * 0.5, 2)
            },
            "dwell_time_ms": dwell_ms,
            "face_detected": True
        }

        await manager.broadcast(data)
        await asyncio.sleep(0.033) # ~30 Hz

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(simulation_loop())

if __name__ == "__main__":
    print("[Mock CV Streamer] Starting mock gaze server on http://127.0.0.1:8765 (ws://127.0.0.1:8765/gaze) ...")
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
