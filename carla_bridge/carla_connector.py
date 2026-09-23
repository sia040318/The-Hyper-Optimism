"""
CARLA Real-Time Python Connector & Audio Bridge
Connects to an active CARLA Autonomous Simulator instance,
computes 3D relative threat vectors for all nearby vehicles around the ego-car,
and streams live telemetry to the Spatial Audio HUD via WebSocket.
"""

import sys
import time
import math
import json
import asyncio
from fastapi import FastAPI, WebSocket
import uvicorn

# Try importing CARLA Python API
try:
    import carla
    CARLA_AVAILABLE = True
except ImportError:
    CARLA_AVAILABLE = False
    print("[WARNING] 'carla' package not found in current Python environment.")
    print("This script will run in documentation/standby mode until run inside your CARLA environment.")

app = FastAPI(title="CARLA Real-Time Bridge")
connected_clients = []

@app.websocket("/")
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    print(f"[WebSocket] Audio HUD client connected. Clients: {len(connected_clients)}")
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        if websocket in connected_clients:
            connected_clients.remove(websocket)

async def carla_extraction_loop():
    """Extracts live vehicle transforms from CARLA and broadcasts to Audio Engine"""
    if not CARLA_AVAILABLE:
        print("[CARLA Bridge] CARLA library not present. Please run from your CARLA Python environment.")
        return

    client = carla.Client('localhost', 2000)
    client.set_timeout(5.0)

    try:
        world = client.get_world()
        print("[CARLA Bridge] Successfully connected to CARLA World!")
    except Exception as e:
        print(f"[CARLA Bridge] Could not connect to CARLA at localhost:2000: {e}")
        return

    while True:
        await asyncio.sleep(1.0 / 30.0) # 30 Hz tick

        try:
            actors = world.get_actors()
            vehicles = actors.filter('vehicle.*')

            # Identify ego-vehicle (role_name='hero' or first vehicle)
            ego = None
            for v in vehicles:
                if v.attributes.get('role_name') == 'hero':
                    ego = v
                    break
            if not ego and len(vehicles) > 0:
                ego = vehicles[0]

            if not ego:
                continue

            ego_transform = ego.get_transform()
            ego_loc = ego_transform.location
            ego_yaw_rad = math.radians(ego_transform.rotation.yaw)

            threats = []
            for v in vehicles:
                if v.id == ego.id:
                    continue

                v_loc = v.get_transform().location
                dx_global = v_loc.x - ego_loc.x
                dy_global = v_loc.y - ego_loc.y
                dz_global = v_loc.z - ego_loc.z

                # Rotate into ego-vehicle coordinate frame (Forward = +X, Right = +Y)
                cos_yaw = math.cos(ego_yaw_rad)
                sin_yaw = math.sin(ego_yaw_rad)
                rel_x = cos_yaw * dx_global + sin_yaw * dy_global # Forward in CARLA
                rel_y = -sin_yaw * dx_global + cos_yaw * dy_global # Right in CARLA

                dist = math.sqrt(rel_x**2 + rel_y**2 + dz_global**2)
                if dist > 35.0: # Skip distant vehicles
                    continue

                azimuth_deg = math.atan2(rel_y, rel_x) * (180.0 / math.pi)

                # Map to proxy target
                proxy = "NONE"
                if -125 <= azimuth_deg <= -55:
                    proxy = "LEFT_MIRROR"
                elif 55 <= azimuth_deg <= 125:
                    proxy = "RIGHT_MIRROR"
                elif abs(azimuth_deg) >= 135:
                    proxy = "REAR_MIRROR"
                elif abs(azimuth_deg) <= 35:
                    proxy = "FRONT_WINDSHIELD"

                urgency = "CRITICAL" if dist < 7 else ("WARNING" if dist < 15 else "AWARENESS")

                threats.append({
                    "id": v.id,
                    "type": v.type_id,
                    "rel_x": round(rel_x, 2),
                    "rel_y": round(rel_y, 2),
                    "rel_z": round(dz_global, 2),
                    "distance": round(dist, 2),
                    "azimuth_deg": round(azimuth_deg, 1),
                    "target_proxy": proxy,
                    "urgency_level": urgency
                })

            payload = json.dumps({
                "timestamp": time.time(),
                "ego": {
                    "speed_kmh": round(3.6 * math.sqrt(ego.get_velocity().x**2 + ego.get_velocity().y**2), 1),
                    "gaze_zone": "CENTER"
                },
                "threats": threats
            })

            # Broadcast to connected HUDs
            for client_ws in list(connected_clients):
                try:
                    await client_ws.send_text(payload)
                except Exception:
                    if client_ws in connected_clients:
                        connected_clients.remove(client_ws)

        except Exception as e:
            print(f"[CARLA Bridge Loop Error]: {e}")
            await asyncio.sleep(1.0)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(carla_extraction_loop())

if __name__ == "__main__":
    print("=" * 60)
    print("🚗 CARLA Real-Time Python Audio Bridge")
    print("Listening on ws://127.0.0.1:8765")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
