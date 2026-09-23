# Gaze-Contingent 3D Spatial Audio ADAS ("The Hyper Optimism")

[![React 19](https://img.shields.io/badge/Frontend-React%2019%20%2B%20TypeScript-61dafb.svg)](https://react.dev/)
[![Vite 6](https://img.shields.io/badge/Bundler-Vite%206-646cff.svg)](https://vitejs.dev/)
[![Web Audio API](https://img.shields.io/badge/Audio-3D%20HRTF%20Binaural-10b981.svg)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![MediaPipe](https://img.shields.io/badge/Vision-MediaPipe%20Face%20Mesh-ff6f00.svg)](https://developers.google.com/mediapipe)
[![CARLA](https://img.shields.io/badge/Simulator-CARLA%20Autonomous-00f0ff.svg)](https://carla.org/)

An Advanced Human-Computer Interaction (HCI) research project developing a **closed-loop spatial-to-visual proxy mapping alert system** to eliminate ADAS acoustic alarm fatigue and cross-modal attention bottlenecks in vehicles.

---

## 🚗 Core Concept: Spatial-to-Visual Proxy Mapping

```
Threat Detected around Vehicle (360° Field)
            ↓
Map to Cabin Proxy Target (Left Mirror / Right Mirror / Rear Mirror / Windshield)
            ↓
Synthesize 3D Binaural HRTF Audio Alert (Sound physically originates at that mirror)
            ↓
Driver's Gaze Reflexively Turns Toward the Mirror (Cross-Modal Attention)
            ↓
Driver Monitoring System (MediaPipe / CV Bridge) Confirms Gaze
            ↓
Alert Instantly Silenced (Closed-Loop Cancellation)
```

Conventional ADAS alerts emit non-directional dashboard beeps that force the driver to look at instrument cluster displays, increasing Eyes-Off-Road (EOR) time. By positioning sound at the corresponding vehicle mirror and muting it as soon as the driver checks the mirror, this system eliminates alarm annoyance while maximizing situational awareness.

---

## 📂 Repository Structure & Team Role Division

```
The-Hyper-Optimism/
├── package.json                   # React 19, TypeScript 5.7, Vite 6, Lucide icons
├── tsconfig.json                  # Strict TypeScript configuration
├── vite.config.ts                 # Vite development & build setup
├── requirements.txt               # Root Python dependencies for all bridge servers
├── index.html                     # Vite entry point
├── AUDIO_SYSTEM_ARCHITECTURE.md   # Complete psychoacoustic, HRTF & CARLA spec
├── HCI_EVALUATION_GUIDE.md        # Experimental protocol for 15–30 participants
├── src/                           # Virtual Cockpit & Audio Engine (React + TypeScript)
│   ├── main.tsx                   # React root mount
│   ├── App.tsx                    # Main cockpit orchestrator & state manager
│   ├── index.css                  # Automotive dark glassmorphic design system
│   ├── types/                     # Shared TypeScript schemas (audio, threats, gaze, evaluation)
│   ├── audio/
│   │   └── SpatialAudioEngine.ts  # Web Audio HRTF engine with dynamic head compensation
│   ├── services/
│   │   ├── CVBridgeService.ts     # WebSocket client for CV team with simulation fallback
│   │   └── CarlaBridgeService.ts  # CARLA simulator telemetry connector
│   ├── utils/
│   │   └── threatScenarios.ts     # ISO 8855 vector math & threat presets
│   └── components/
│       ├── HeaderHUD.tsx          # Status pills (Audio, CV stream, CARLA, Study modal)
│       ├── CockpitHUD.tsx         # Cabin mirrors with directional warning flash & focus glow
│       ├── RadarCanvas.tsx        # 60 FPS HTML5 radar display with draggable threats
│       ├── AudioControlPanel.tsx  # HRTF vs Stereo A/B selector & direction cues
│       ├── ScenarioPanel.tsx      # Scenario presets (Blind spot overtake, tailgater, orbit)
│       ├── TelemetryPanel.tsx     # Vector telemetry & head pose Euler angles (yaw/pitch)
│       └── evaluation/
│           ├── EvaluationModal.tsx# Automated 10-trial reaction-time study runner
│           ├── SUSModal.tsx       # System Usability Scale (SUS) 10-item survey
│           ├── NasaTlxModal.tsx   # NASA-TLX 6-dimension workload survey
│           └── StudyResultsView.tsx # Statistical results & CSV exporter
├── cv_bridge/                     # Computer Vision / Driver Monitoring Team Folder
│   ├── README_CV_TEAM.md          # Integration guide and WebSocket protocol for CV team
│   ├── requirements.txt           # Python dependencies for CV team
│   ├── cv_mediapipe_template.py   # Complete OpenCV + MediaPipe head pose & gaze streamer
│   └── mock_cv_streamer.py        # Simulated CV stream for camera-less testing
├── carla_bridge/                  # CARLA Autonomous Simulator Integration Folder
│   ├── requirements.txt           # CARLA connector dependencies
│   ├── carla_connector.py         # Live CARLA client translating Unreal coords to Web Audio
│   └── mock_carla_streamer.py     # Standalone CARLA mock telemetry streamer
└── src/legacy_vanilla/            # Preserved original vanilla prototype files
```

---

## ⚡ Quickstart Guide

### Prerequisites
* **Node.js**: v18.0.0 or later (v20+ recommended)
* **Python**: 3.9+ (for CV or CARLA bridge scripts)

---

### Step 1: Launch the Cockpit Frontend
```bash
# 1. Install frontend dependencies
npm install

# 2. Start the Vite development server
npm run dev
```
Open **`http://localhost:5173/`** in your browser.

---

### Step 2: Running with Keyboard Simulation (No Camera Required)
You can develop, test, and conduct HCI evaluations immediately without a camera:
1. Click **Start Audio Engine** in the top HUD (stereo headphones required).
2. Use the keyboard shortcuts to simulate driver gaze:
   - `A` or `←` : Look at **Left Side Mirror**
   - `D` or `→` : Look at **Right Side Mirror**
   - `S` or `↓` : Look at **Rear-View Mirror**
   - `W` or `↑` : Look forward at **Center Road**
3. Notice that as soon as you check the mirror corresponding to an active threat, the warning is **instantly muted** (closed-loop cancellation).

---

### Step 3: Connecting the Live Driver Monitoring System (CV Team)
For collaborators working on the Computer Vision model:
1. Navigate to the `cv_bridge/` directory:
   ```bash
   pip install -r cv_bridge/requirements.txt
   ```
2. Start the MediaPipe Face Mesh gaze streamer:
   ```bash
   python cv_bridge/cv_mediapipe_template.py
   ```
   *(Or run `python cv_bridge/mock_cv_streamer.py` to test with simulated camera telemetry)*.
3. The Cockpit HUD will automatically switch from `Simulation Mode` to **`● Live MediaPipe`**, displaying live head yaw/pitch angles and muting alerts based on real driver head turns!
4. See **[cv_bridge/README_CV_TEAM.md](file:///d:/Desktop%2030_10_24/KNU_ACADEMICS/Fall%202026/HCI/Project/The-Hyper-Optimism/cv_bridge/README_CV_TEAM.md)** for full protocol specifications.

---

### Step 4: Connecting the CARLA Autonomous Simulator
1. Navigate to `carla_bridge/`:
   ```bash
   pip install -r carla_bridge/requirements.txt
   ```
2. Run the mock or live CARLA bridge:
   ```bash
   python carla_bridge/mock_carla_streamer.py
   ```
3. The Cockpit HUD status pill will turn **`CARLA: Linked`**, streaming real-time obstacle coordinates into the radar and audio engine.

---

### Step 5: Running HCI User Studies & Data Collection
To collect data for your paper / project report:
1. Click **Run HCI Study** in the top HUD.
2. Enter Participant ID (e.g. `P_01`) and select condition (`3D_HRTF` vs `STEREO_BASELINE`).
3. Have the participant identify the 10 randomized auditory hazard cues.
4. Fill the integrated **System Usability Scale (SUS)** and **NASA-TLX** questionnaires.
5. Click **Export Dataset to CSV** to download a formatted spreadsheet ready for statistical analysis in SPSS, R, or Python Pandas.

---

## 🎧 Psychoacoustics & 3D Spatial Audio Highlights
* **Binaural HRTF Convolution:** Combines Interaural Time Difference (ITD < 1.5 kHz) and Interaural Level Difference (ILD > 1.5 kHz) over standard headphones.
* **Pinna Spectral Notch (>4.5 kHz):** Resolves the "Cone of Confusion" to eliminate front-back reversals.
* **Cabin Early Reflections (13 ms & 19 ms):** Prevents in-head lateralization, anchoring sound externally at the mirrors.
* **Dynamic Head Orientation Compensation:** As the driver turns their head, Web Audio rotates the acoustic soundstage so mirror audio sources stay world-locked.
* **ISO 15006 Urgency Scaling:** Dynamic tempo escalation as threat distance decreases.

For complete mathematical derivations and acoustic physics, refer to **[AUDIO_SYSTEM_ARCHITECTURE.md](file:///d:/Desktop%2030_10_24/KNU_ACADEMICS/Fall%202026/HCI/Project/The-Hyper-Optimism/AUDIO_SYSTEM_ARCHITECTURE.md)**.