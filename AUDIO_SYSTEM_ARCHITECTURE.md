# Spatial-to-Visual Proxy Mapping: 3D HRTF Audio & CARLA Integration Architecture

**Project:** The Hyper Optimism  
**System:** Gaze-Contingent 3D Spatial Audio ADAS (Advanced Driver Assistance System)  
**Document Version:** 1.0 (Comprehensive Technical Specification & Research Foundation)

---

## 1. Executive Summary & Core Objectives

### 1.1 The Human Factors Problem: ADAS Alarm Fatigue
Conventional Advanced Driver Assistance Systems (ADAS) rely heavily on non-directional, single-frequency acoustic alarms (e.g., generic beeps from the dashboard speaker). Research reveals two severe human-factor failure modes in real-world driving:
1. **Alarm Fatigue & Habituation**: When drivers are repeatedly exposed to loud, non-specific alarms whose relevance they cannot quickly evaluate, they experience cognitive overload, desensitization, or disable the safety alerts entirely.
2. **Visual & Cognitive Bottlenecks**: A generic alert forces the driver to first glance at the instrument cluster or center console display to determine *what* the warning means and *where* the threat is. This diverted glance increases "Eyes-Off-Road" (EOR) time during critical pre-collision moments.

### 1.2 The Proposed Solution: Closed-Loop Spatial-to-Visual Proxy Mapping
This project bridges the gap between auditory perception and visual reflex using a closed-loop system:
1. **360° Threat Detection**: Virtual obstacles or real vehicles detected around the car are mapped to 3D spatial coordinates relative to the driver.
2. **Physical Proxy Target Mapping**: The 360° space around the vehicle is mapped onto intuitive physical proxy targets inside the cabin:
   - **Left Blind Spot / Threat** $\longrightarrow$ **Left Side Mirror**
   - **Right Blind Spot / Threat** $\longrightarrow$ **Right Side Mirror**
   - **Rear Approaching Hazard** $\longrightarrow$ **Rear-View Mirror**
   - **Front Obstacle / Collision** $\longrightarrow$ **Forward Windshield**
3. **Binaural 3D HRTF Audio Alert**: Instead of generic stereo sound, a psychoacoustically optimized 3D spatial sound is synthesized over headphones/cabin speakers, making the alert appear to originate physically from the exact direction of the corresponding proxy mirror.
4. **Cross-Modal Orienting Reflex**: Humans have an innate physiological reflex to turn eyes and head toward the spatial origin of an acoustic stimulus.
5. **Gaze-Contingent Cancellation**: A driver-monitoring camera (MediaPipe) tracks head orientation and gaze. As soon as the driver checks the correct mirror/target zone, the warning immediately silences. If the driver does not look, the alert escalates in tempo and urgency as the threat closes in.

---

## 2. Psychoacoustics & HRTF Research: Achieving Flawless Directional Perception

To enable drivers to intuitively distinguish whether a danger is **Front, Back, Left, or Right** over standard stereo headphones, the audio system must account for human auditory physiology.

```
                     Acoustic Wavefront
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
       Left Ear                          Right Ear
  ┌─────────────────┐               ┌─────────────────┐
  │ ITD: Arrival    │               │ Head Shadow     │
  │ Time Difference │               │ Attenuation     │
  │ (< 1.5 kHz)     │               │ (ILD > 1.5 kHz) │
  └────────┬────────┘               └────────┬────────┘
           └────────────────┬────────────────┘
                            ▼
              Outer Ear (Pinna) Concha Folds
            ┌────────────────────────────────┐
            │ Spectral Coloration / Notches  │
            │ (4 kHz – 10 kHz Pinna Filter)  │
            │ → Resolves FRONT vs. REAR!     │
            └────────────────────────────────┘
```

### 2.1 The Physics of Spatial Hearing (Duplex Theory)
1. **Interaural Time Difference (ITD)**:
   - Sounds arriving from an angle reach one ear slightly earlier than the other.
   - For an average human head diameter ($D \approx 17.5\text{ cm}$), the maximum delay at $90^\circ$ azimuth is approximately:
     $$\Delta t_{\text{max}} = \frac{D}{2c} (\theta + \sin\theta) \approx 0.65\text{ ms to } 0.70\text{ ms}$$
     *(where $c = 343\text{ m/s}$ is the speed of sound).*
   - The brain uses ITD primarily for frequencies **below 1.5 kHz**, comparing phase differences at the medial superior olive.
2. **Interaural Level Difference (ILD)**:
   - At high frequencies (**above 1.5 kHz**), the wavelength of sound ($\lambda < 23\text{ cm}$) is smaller than the human head.
   - The head creates an acoustic "shadow", attenuating the sound arriving at the far (contralateral) ear by **15 dB to 20 dB**.

### 2.2 The "Cone of Confusion" & Front-Back Inversion
A major pitfall of simple stereo panning (ILD only) is the **Cone of Confusion**:
- A sound source at $+45^\circ$ (front-right) and $+135^\circ$ (rear-right) produces virtually identical ITD and ILD values.
- In tests using basic stereo audio over headphones, listeners experience **Front-Back Reversal Error Rates of 25% to 40%**—meaning a driver frequently mistakes a car behind them for a car ahead of them.

### 2.3 How HRTF Resolves Front vs. Back
A **Head-Related Transfer Function (HRTF)** is a set of frequency-response filters measured at the entrance of the human ear canal across all 3D azimuth and elevation angles. HRTF resolves the Cone of Confusion through:
1. **Pinna Spectral Notches (Outer Ear Reflections)**:
   - The folds of the outer ear (pinna, tragus, concha) reflect sound waves into the ear canal, causing destructive and constructive interference patterns in the **4 kHz to 10 kHz** range.
   - **Front Sounds**: Enter the ear canal directly, preserving high frequencies (presence peak at 3–5 kHz and 8–10 kHz).
   - **Rear Sounds**: Sound waves diffract around the back of the ear cartilage (helix), producing a pronounced **spectral notch between 4 kHz and 7 kHz** and attenuating frequencies above 8 kHz.
2. **Torso & Shoulder Shadowing**: Sounds from below and behind bounce off the shoulders, adding subtle micro-delays (0.2–0.5 ms) that the brain decodes as elevation and depth.

### 2.4 Crucial Sound Design Rules for ADAS Directional Audio
Even with an HRTF engine, **poor sound design will break spatialization**. The system follows these psychoacoustic design principles:

| Sound Parameter | Flawed Approach (Avoid) | Our Solution (Implemented) | Psychoacoustic Reason |
| :--- | :--- | :--- | :--- |
| **Waveform Spectrum** | Pure sine wave (e.g. 1000 Hz beep) | **Multi-harmonic chime or broadband burst** (base frequencies 880 Hz + 1320 Hz with rich harmonics up to 8 kHz) | A pure sine wave has no harmonic content for the ear's pinna to filter; the brain cannot distinguish front from back without spectral frequencies between 4 kHz and 10 kHz. |
| **Attack Transient** | Slow fade-in (soft attack > 50 ms) | **Fast exponential transient** (attack $\le 5\text{ ms}$) | Sharp onset transients trigger precise ITD phase detection in the brain's auditory cortex. |
| **Rear Spectral Tilt** | Identical frequency response for front & back | **Dynamic rear-hemisphere shelf filter** ($-3\text{ dB}$ to $-5\text{ dB}$ above 4.5 kHz when $\vert\theta\vert > 110^\circ$) | Reinforces the anatomical head-and-pinna shadow for threats coming from the rear mirror zone. |
| **Acoustic Externalization** | Completely dry / anechoic sound | **Subtle cabin early reflections** (10 ms – 18 ms delay, low reverberation tail) | Pure anechoic sound collapses "inside the skull" (lateralization). Subtle early reflections anchor the alert *outside the head*, positioned at the vehicle mirror. |

---

## 3. ADAS Urgency Mapping (Distance to Acoustic Salience)

In accordance with **ISO 15006** (Auditory Presentation of Ergonomic In-Vehicle Information) and human factors research, the warning system scales urgency dynamically as the distance $d$ between the ego-vehicle and the threat decreases:

```
Distance:   > 30m                  15m – 30m               7m – 15m                 < 7m
Zone:       [ Safe ]            [ Awareness ]           [ Warning ]             [ Critical ]
Acoustic:   Silent              Slow Pulse (1.2 Hz)     Active Pulse (2.8 Hz)   Urgent Alarm (5.5 Hz)
Pitch:      --                  880 Hz (Base)           980 Hz (+10%)           1100 Hz (+25%)
Salience:   0%                  Moderate (40%)          High (70%)              Maximum (100%)
```

### Urgency Formulae
1. **Repetition Rate (Pulse Frequency $f_{\text{pulse}}$)**:
   $$f_{\text{pulse}}(d) = f_{\text{min}} + (f_{\text{max}} - f_{\text{min}}) \cdot \left(1 - \frac{d - d_{\text{crit}}}{d_{\text{max}} - d_{\text{crit}}}\right)^p$$
   - $d_{\text{crit}} = 5\text{ m}$, $d_{\text{max}} = 30\text{ m}$
   - $f_{\text{min}} = 1.0\text{ Hz}$ (60 BPM), $f_{\text{max}} = 6.0\text{ Hz}$ (360 BPM)
   - Exponent $p \approx 1.5$ creates non-linear escalation: tempo increases gradually at first, then accelerates rapidly as danger becomes imminent.
2. **Inverse-Distance Gain Rolloff**:
   $$\text{Gain}(d) = \min\left(1.0, \frac{d_{\text{ref}}}{d_{\text{ref}} + \alpha \cdot (d - d_{\text{ref}})}\right)$$
   *(with $d_{\text{ref}} = 3\text{ m}$ and smooth clamping to prevent ear fatigue).*

---

## 4. CARLA Autonomous Driving Simulator Integration

### 4.1 Why a Decoupled Architecture is Best for CARLA
CARLA is an Unreal Engine 4 simulation with heavy graphics and physics compute loads. Integrating an audio/HUD pipeline directly into CARLA's Python tick loop causes two major issues:
1. **Frame Drops & GIL Contention**: Python's Global Interpreter Lock (GIL) struggles to maintain continuous 48 kHz binaural audio buffer rendering while simultaneously querying CARLA's actor physics.
2. **Display Constraints**: CARLA requires full-screen rendering for driving realism. A separate client allows running the **ADAS Top-Down Radar and Telemetry on a secondary screen, tablet, or separate window**.

**The Solution:** CARLA Python client runs as an autonomous telemetry server, extracting relative 3D vectors and streaming them over a high-speed local WebSocket (`ws://127.0.0.1:8765`) to the dedicated Audio & HUD engine with sub-2ms network latency.

```
 ┌──────────────────────────────────────────────────────────────┐
 │                      CARLA SIMULATION                        │
 │  (Unreal Engine Physics World: Ego-Car + Surrounding Traffic) │
 └──────────────────────────────┬───────────────────────────────┘
                                │ Python API (world.tick())
                                ▼
 ┌──────────────────────────────────────────────────────────────┐
 │             carla_connector.py (Python Backend)             │
 │  - Queries ego_vehicle.get_transform()                       │
 │  - Queries nearby vehicles & calculates relative vectors     │
 │  - Reads Driver Gaze (MediaPipe webcam stream)               │
 │  - Broadcasts JSON frame at 30-60 Hz                         │
 └──────────────────────────────┬───────────────────────────────┘
                                │ WebSocket (ws://localhost:8765)
                                ▼
 ┌──────────────────────────────────────────────────────────────┐
 │             AUDIO & RADAR HUD ENGINE (Client)                │
 │  - Web Audio API HRTF Spatializer (Binaural PannerNode)      │
 │  - Dynamic Urgency & Pinna Spectral Shaper                   │
 │  - 60 FPS Top-Down Radar HUD & Mirror State Indicator        │
 │  - Closed-Loop Alert Cancellation Logic                      │
 └──────────────────────────────────────────────────────────────┘
```

---

### 4.2 Mathematical Coordinate Transformations (CARLA $\longrightarrow$ Audio Engine)

CARLA and 3D Audio spatializers use different coordinate conventions. The bridge applies the following transformation:

#### Coordinate System Definitions
1. **CARLA World / Ego Coordinate System (Unreal Engine: Left-Handed)**:
   - $+X$: **Forward**
   - $+Y$: **Right**
   - $+Z$: **Up**
2. **Web Audio / Binaural Listener Space (Standard: Right-Handed)**:
   - $+X$: **Right** (Interaural axis)
   - $+Y$: **Up** (Elevation axis)
   - $-Z$: **Forward** (Line of sight / front windshield)
   - $+Z$: **Rear** (Behind the driver's head)

#### Relative Vector Calculation
Given CARLA Ego-Vehicle transform $(X_e, Y_e, Z_e, \psi_e)$ where $\psi_e$ is yaw in radians:
For any obstacle actor $i$ at $(X_i, Y_i, Z_i)$:

1. **Global Delta**:
   $$\Delta X_g = X_i - X_e, \quad \Delta Y_g = Y_i - Y_e, \quad \Delta Z_g = Z_i - Z_e$$

2. **Rotation into Ego-Vehicle Heading**:
   $$\begin{bmatrix} X_{\text{ego}} \\ Y_{\text{ego}} \end{bmatrix} = \begin{bmatrix} \cos\psi_e & \sin\psi_e \\ -\sin\psi_e & \cos\psi_e \end{bmatrix} \begin{bmatrix} \Delta X_g \\ \Delta Y_g \end{bmatrix}$$
   $$Z_{\text{ego}} = \Delta Z_g$$

3. **Transformation to 3D Audio Coordinates**:
   $$X_{\text{audio}} = Y_{\text{ego}} \quad (\text{Right})$$
   $$Y_{\text{audio}} = Z_{\text{ego}} \quad (\text{Up})$$
   $$Z_{\text{audio}} = -X_{\text{ego}} \quad (\text{Forward is } -Z, \text{Rear is } +Z)$$

4. **Polar Azimuth Angle ($\theta$) & Euclidean Distance ($r$)**:
   $$r = \sqrt{X_{\text{ego}}^2 + Y_{\text{ego}}^2 + Z_{\text{ego}}^2}$$
   $$\theta = \operatorname{atan2}(Y_{\text{ego}}, X_{\text{ego}}) \times \frac{180^\circ}{\pi}$$
   - $\theta \approx 0^\circ$: Direct front
   - $\theta \approx -90^\circ$: Direct left
   - $\theta \approx +90^\circ$: Direct right
   - $|\theta| > 140^\circ$: Rear / behind

---

### 4.3 Proxy Target Mapping & Gaze Matching Table

The relative azimuth $\theta$ and distance $r$ are mapped directly into vehicle mirror targets:

| Threat Azimuth Range | Proxy Cabin Target | Mapped 3D Audio Vector $(X, Y, Z)$ | Expected Driver Gaze Zone |
| :--- | :--- | :--- | :--- |
| **$-60^\circ \text{ to } -125^\circ$** | **Left Side Mirror** | $(-3.5, 0.0, -0.5)$ | `GAZE_LEFT` |
| **$+60^\circ \text{ to } +125^\circ$** | **Right Side Mirror** | $(+3.5, 0.0, -0.5)$ | `GAZE_RIGHT` |
| **$|\theta| > 135^\circ$** | **Rear-View Mirror** | $(0.0, +0.6, +3.0)$ | `GAZE_REAR` |
| **$-30^\circ \text{ to } +30^\circ$** | **Forward Windshield** | $(0.0, 0.0, -5.0)$ | `GAZE_CENTER` |

#### Closed-Loop Cancellation Rule:
$$\text{If } \text{ActiveAlert}(\text{Target}) \text{ AND } \text{DriverGaze} == \text{Target} \text{ for } t \ge 0.35\text{ s}:$$
$$\implies \mathbf{MUTE\_ALERT(Target)}$$

---

### 4.4 Real-Time JSON Telemetry Contract

The Python CARLA client and MediaPipe module broadcast this standardized JSON payload over WebSocket:

```json
{
  "timestamp": 1727056800.124,
  "ego": {
    "speed_kmh": 64.2,
    "gear": 4,
    "gaze_zone": "CENTER",
    "gaze_confidence": 0.94
  },
  "threats": [
    {
      "id": 1042,
      "type": "vehicle.audi.etron",
      "rel_x": -3.2,
      "rel_y": -12.4,
      "rel_z": 0.1,
      "distance": 12.8,
      "azimuth_deg": -104.5,
      "rel_speed_kmh": 14.8,
      "target_proxy": "LEFT_MIRROR",
      "urgency_level": "WARNING"
    }
  ]
}
```

---

## 5. HCI Evaluation Framework & Usability Metrics

To satisfy the grading and research requirements specified in `HCI_evaluation.txt`, the system includes automated logging and evaluation capabilities.

### 5.1 Objective System-Performance Measures
1. **Direction Identification Accuracy (%)**:
   - In randomized trials, a threat is presented spatially via headphones.
   - Measures whether the participant correctly selects the target direction (Left Mirror, Right Mirror, Rear Mirror, Front).
   - Target benchmark: $\ge 92\%$ accuracy with HRTF (compared to $< 65\%$ with standard stereo).
2. **Reaction Time (ms)**:
   - Measured as the duration from alert onset $t_{\text{alert}}$ to initial head turn / keypress $t_{\text{response}}$.
   - Typical auditory reaction time: $180\text{ ms} - 280\text{ ms}$.
3. **Front-Back Confusion Rate (%)**:
   - The percentage of trials where a rear threat was misidentified as front, or vice versa.
   - Evaluates the effectiveness of our pinna spectral filter.
4. **Detection-to-Response Time**:
   - Total time elapsed between the hazard entering the critical threshold ($d \le 15\text{ m}$) in CARLA and complete gaze-contingent alert cancellation.

### 5.2 Subjective Usability Measures (Post-Trial Survey)
Evaluated across 15–30 participants using a 5-point Likert scale:
1. **System Usability Scale (SUS)** (Target score: $> 80$ / Excellent):
   - Satisfaction, Ease of Use, Learnability, Perceived Usefulness, and Trust.
2. **Comfort & Annoyance Rating**:
   - Specifically evaluates whether the dynamic tempo escalation is perceived as urgent without inducing panic or annoyance (preventing alarm fatigue).
3. **NASA-TLX (Task Load Index)**:
   - Assesses Mental Demand, Temporal Demand, Performance, Effort, and Frustration during complex urban navigation in CARLA.

### 5.3 Empirical A/B Comparison Experiment
For the final project report, the system includes a one-click **A/B Testing Switch**:
- **Condition A (Baseline)**: Conventional ADAS stereo panning (equal-power panning without HRTF or spectral shaping).
- **Condition B (Our System)**: 3D Binaural HRTF + Pinna Spectral Shaping + Distance Urgency + Gaze Cancellation.
- Automatically calculates and exports statistical graphs ($t$-test and ANOVA) comparing Accuracy, Reaction Latency, and Workload between Condition A and Condition B.

---

## 6. Implementation Roadmap & File Structure

```
d:\Desktop 30_10_24\KNU_ACADEMICS\Fall 2026\HCI\Project\
├── AUDIO_SYSTEM_ARCHITECTURE.md     <-- [This comprehensive specification]
├── index.html                       <-- Top-Down Cockpit Radar & Telemetry HUD
├── src/
│   ├── audio_engine.js              <-- Web Audio API 3D HRTF + Pinna Filter + Urgency Engine
│   ├── radar.js                     <-- 60 FPS Canvas Radar (Ego-car, Threats, Sound Waves, Range Rings)
│   ├── threats.js                   <-- ADAS Threat Scenarios (Blind spots, tailgater, orbit, drag-drop)
│   ├── evaluator.js                 <-- HCI Study Testbed (Randomized trials, reaction time logger, CSV export)
│   ├── style.css                    <-- Automotive HUD Glassmorphic Styling
│   └── app.js                       <-- Main Coordinator & WebSocket Client
└── carla_bridge/
    ├── carla_connector.py           <-- Drop-in CARLA Python Client (Actor extraction & WebSocket stream)
    └── mock_carla_streamer.py       <-- Standalone simulator for testing without launching CARLA
```

---

## 7. Summary of Deliverables & Next Action

This architecture provides:
1. **Immediate Headphone Testing**: You can immediately test the 3D HRTF audio with headphones using the interactive radar interface and scenario presets (blind spots, tailgater, orbit).
2. **Rigorous Academic Grounding**: All psychoacoustic choices (ITD/ILD, pinna notches, harmonic spectrum, urgency tempo) are backed by the literature in `HCI_review.docx`.
3. **Seamless CARLA Plug-and-Play**: The coordinate transformation and WebSocket schema are pre-built to connect directly to CARLA whenever you run your simulation scripts.
