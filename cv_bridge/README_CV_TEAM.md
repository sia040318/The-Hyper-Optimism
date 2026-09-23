# Computer Vision (CV) Collaborator Guide: MediaPipe Gaze & Head Pose Integration

Welcome to the **Gaze-Contingent 3D Spatial Audio ADAS** project! This document specifies the integration contract between the **Driver Monitoring System (CV Team)** and the **3D Audio / Cockpit HUD System**.

---

## 🎯 System Goal

When a spatial audio alert sounds in the cabin (e.g., simulating a threat in the driver's left blind spot), the driver reflexively looks toward that direction (e.g., Left Side Mirror). 

Your CV model tracks the driver's head orientation and gaze. Once your model confirms that the driver has checked the corresponding mirror zone with sufficient dwell time (e.g., $\ge 300\text{ ms}$), the audio alert is instantly silenced to eliminate alarm fatigue.

---

## 🔌 WebSocket Data Contract

The Cockpit Web Application listens on a WebSocket connection (default: `ws://127.0.0.1:8765/gaze` or `ws://127.0.0.1:8765`).

Whenever your model estimates a new head pose / gaze state, emit a JSON message at **30–60 Hz**:

```json
{
  "type": "GAZE_UPDATE",
  "timestamp": 1727083200.450,
  "gaze_zone": "LEFT_MIRROR",
  "confidence": 0.94,
  "head_pose": {
    "pitch": 3.2,
    "yaw": -28.6,
    "roll": -1.1
  },
  "dwell_time_ms": 320,
  "face_detected": true
}
```

### Field Definitions

| Field | Type | Description | Values / Range |
| :--- | :--- | :--- | :--- |
| `type` | `string` | Message type identifier | Always `"GAZE_UPDATE"` |
| `timestamp` | `number` | Unix timestamp in seconds | `time.time()` |
| `gaze_zone` | `string` | Discrete classified driver focus zone | `"CENTER"`, `"LEFT_MIRROR"`, `"RIGHT_MIRROR"`, `"REAR_MIRROR"`, `"UNKNOWN"` |
| `confidence` | `number` | Detection confidence score | `0.0` to `1.0` |
| `head_pose` | `object` | 3D Euler angles in degrees | `pitch` (up/down), `yaw` (left/right), `roll` (tilt) |
| `dwell_time_ms`| `number` | Continuous duration gaze has remained in this zone | Milliseconds |
| `face_detected`| `boolean`| Whether a face is currently tracked in frame | `true` or `false` |

---

## 📐 Recommended Gaze Zone Classification Thresholds

Using 3D head pose estimation (`cv2.solvePnP`) with MediaPipe Face Mesh:

```
                          REAR-VIEW MIRROR
                   [ Pitch >= +14°, |Yaw| <= 15° ]
                                 ▲
                                 │
     LEFT MIRROR                 │                 RIGHT MIRROR
  [ Yaw <= -20° ]      ◄─── CENTER (ROAD) ───►    [ Yaw >= +20° ]
                       [ |Yaw| < 20°, Pitch < 14° ]
```

* **`CENTER` (Forward Road Focus):** $-20^\circ < \text{Yaw} < +20^\circ$ and $-12^\circ < \text{Pitch} < +14^\circ$.
* **`LEFT_MIRROR`:** $\text{Yaw} \le -20^\circ$ (Driver turned head to the left mirror).
* **`RIGHT_MIRROR`:** $\text{Yaw} \ge +20^\circ$ (Driver turned head to the right mirror).
* **`REAR_MIRROR`:** $\text{Pitch} \ge +14^\circ$ and $|\text{Yaw}| \le 18^\circ$ (Driver looking up/center at rear-view mirror).

> [!TIP]
> **Dwell Time Filtering (Crucial for HCI Evaluation):**  
> Raw gaze classification flickers due to eye saccades. Maintain a timer for how long the classified zone has remained stable. Only report `gaze_zone` as confirmed if `dwell_time_ms >= 250`.

---

## 🚀 Quickstart for CV Team

We have provided a plug-and-play Python template:

1. Install dependencies:
   ```bash
   pip install opencv-python mediapipe websockets asyncio
   ```

2. Run the template:
   ```bash
   python cv_bridge/cv_mediapipe_template.py
   ```

3. Open the React Cockpit in your browser. The status badge will turn **🟢 CV Stream Connected** and live head pose angles will appear in the telemetry HUD!
