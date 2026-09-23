# Human-Computer Interaction (HCI) Evaluation Protocol & Benchmark Guide

**Project:** Gaze-Contingent 3D Spatial Audio ADAS ("The Hyper Optimism")  
**Target Sample Size:** 15–30 Participants (ISO 9241-11 Benchmark)

---

## 1. Research Questions & Hypotheses

* **RQ1 (Objective Spatial Acuity):** Does spatial-to-visual proxy mapping over binaural 3D HRTF significantly decrease auditory reaction time (ms) and direction identification error rate compared to conventional mono/stereo alerts?
* **RQ2 (Cone of Confusion Elimination):** Does the pinna spectral notch filter (>4.5 kHz) and multi-harmonic chime design reduce front-back reversal rates to below 10%?
* **RQ3 (Cognitive Workload & Usability):** Does closed-loop gaze cancellation significantly lower driver annoyance, frustration, and cognitive workload (NASA-TLX) while achieving an above-average System Usability Scale (SUS > 70)?

---

## 2. Experimental Design (Counterbalanced Within-Subject)

Each participant completes two counterbalanced experimental blocks (Latin Square order: Group 1 = A then B; Group 2 = B then A):

| Condition | Panning Model | Waveform | Urgency Scaling | Closed-Loop Cancellation |
| :--- | :--- | :--- | :--- | :--- |
| **Condition A (Baseline)** | Stereo / Equal-Power (ILD only) | Monofrequency 1000 Hz tone | Fixed frequency | None (Manual button dismissal) |
| **Condition B (Proposed)** | 3D HRTF + Pinna Notch (ITD + ILD) | Harmonic Chime (880 + 1320 + 2200 Hz) | ISO 15006 dynamic pulse rate | Automatic upon mirror gaze dwell (>= 300 ms) |

---

## 3. Measured Metrics

### A. Objective Performance Metrics
1. **Auditory Reaction Time (RT):** Time in milliseconds from audio onset to the moment the driver initiates head/gaze movement or confirms the direction.
2. **Direction Identification Accuracy (%):** Percentage of trials in which the participant correctly orientates toward the target mirror.
3. **Front-Back Reversal Rate (%):** Frequency of confusing a Rear hazard for a Front hazard (or vice versa).
4. **Gaze Dwell Duration (ms):** Stability of visual attention on the threat mirror before resuming forward road monitoring.

### B. Subjective UX Questionnaires (In-App)
1. **System Usability Scale (SUS):** 10 standardized 5-point Likert questions scored from 0 to 100.
   - $> 68$: Above average usability.
   - $> 80$: Excellent / Grade A usability.
2. **NASA Task Load Index (NASA-TLX):** 6 continuous dimensions (Mental Demand, Physical Demand, Temporal Demand, Performance, Effort, Frustration) scored 0–100.

---

## 4. Participant Protocol Step-by-Step

1. **Intake & Calibration (2 minutes):**
   - Seat participant comfortably in front of screen.
   - Put on stereo headphones and verify left/right channel orientation.
   - Run **Instant Direction Tests** in the Cockpit HUD (Left, Right, Rear, Front) to calibrate volume.
2. **Running the 10-Trial Benchmark (5 minutes):**
   - Click **Run HCI Study** in the top HUD header.
   - Enter Participant ID (e.g. `P_01`).
   - Select condition (`3D_HRTF` or `STEREO_BASELINE`).
   - Participant listens for acoustic cues and presses corresponding key (`A`, `S`, `D`, `W`) or looks at the mirror if camera tracking is active.
3. **Questionnaires (3 minutes):**
   - Click **Fill SUS Survey** upon trial completion.
   - Click **Fill NASA-TLX**.
4. **Data Export:**
   - Click **Export Dataset to CSV**.
   - Raw trial timestamps, reaction times, error classifications, and survey scores are exported into a tidy CSV file for statistical analysis (ANOVA, paired t-tests) in SPSS, R, or Python Pandas.
