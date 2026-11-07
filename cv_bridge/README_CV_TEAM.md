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

## 📐 Gaze Zone Classification

The streamer uses the iris landmarks from MediaPipe Face Mesh (`refine_landmarks=True`) for horizontal eye gaze. The ratio is normalized to the driver's mirrored view: `0.0` is left, `0.5` is center, and `1.0` is right.

* **`LEFT_MIRROR`:** iris ratio `<= 0.45`.
* **`CENTER`:** iris ratio between `0.45` and `0.55`.
* **`RIGHT_MIRROR`:** iris ratio `>= 0.55`.
* **`REAR_MIRROR`:** head pitch `>= +14°` while `|Yaw| <= 18°`; horizontal iris position alone cannot distinguish an upward glance.

Head yaw/pitch are also included as diagnostic telemetry. Dwell time is measured for the resulting gaze zone before each update is streamed.

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

3. Open the React Cockpit in your browser. The status badge will turn **🟢 CV Stream Connected**; iris ratio drives left/right mirror gaze, while head pose angles remain visible as diagnostic telemetry.
