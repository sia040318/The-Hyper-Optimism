/**
 * 3D HRTF Spatial Audio Engine for ADAS Warning System
 * Implements binaural HRTF convolution, pinna spectral shaping, cabin early reflections,
 * and distance-based urgency modulation.
 */

export class SpatialAudioEngine {
  constructor() {
    this.ctx = null;
    this.listener = null;
    this.masterGain = null;
    this.earlyReflectionGain = null;
    this.earlyDelay1 = null;
    this.earlyDelay2 = null;
    
    // Spatial Panner & Filters
    this.panner = null;
    this.pinnaFilter = null;
    this.threatGain = null;
    
    // Audio Configuration
    this.panningModel = 'HRTF'; // 'HRTF' or 'equalpower' (for A/B testing)
    this.soundType = 'chime';   // 'chime', 'click_train', 'sine'
    this.isMuted = false;
    this.masterVolume = 0.8;
    
    // Urgency & Pulse Scheduler
    this.pulseTimer = null;
    this.currentThreat = null;
    this.isAudioActive = false;
    this.gazeCancelled = false;
    this.lastPulseTime = 0;
  }

  /**
   * Initializes the Web Audio Context (must be triggered by user gesture)
   */
  async init() {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass({ latencyHint: 'interactive' });

    // Master Output Chain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // Setup Listener at Driver's Head: Facing forward (-Z in Web Audio coordinates)
    this.listener = this.ctx.listener;
    if (this.listener.positionX) {
      this.listener.positionX.setValueAtTime(0, this.ctx.currentTime);
      this.listener.positionY.setValueAtTime(1.2, this.ctx.currentTime); // Eye level
      this.listener.positionZ.setValueAtTime(0, this.ctx.currentTime);
      this.listener.forwardX.setValueAtTime(0, this.ctx.currentTime);
      this.listener.forwardY.setValueAtTime(0, this.ctx.currentTime);
      this.listener.forwardZ.setValueAtTime(-1, this.ctx.currentTime);
      this.listener.upX.setValueAtTime(0, this.ctx.currentTime);
      this.listener.upY.setValueAtTime(1, this.ctx.currentTime);
      this.listener.upZ.setValueAtTime(0, this.ctx.currentTime);
    } else {
      // Legacy fallback
      this.listener.setPosition(0, 1.2, 0);
      this.listener.setOrientation(0, 0, -1, 0, 1, 0);
    }

    // Cabin Early Reflections Bus (anchors sound outside the skull / prevents lateralization)
    this.earlyReflectionGain = this.ctx.createGain();
    this.earlyReflectionGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

    this.earlyDelay1 = this.ctx.createDelay(0.1);
    this.earlyDelay1.delayTime.setValueAtTime(0.013, this.ctx.currentTime); // 13ms reflection (windshield/window)
    this.earlyDelay2 = this.ctx.createDelay(0.1);
    this.earlyDelay2.delayTime.setValueAtTime(0.019, this.ctx.currentTime); // 19ms reflection (rear/door)

    this.earlyDelay1.connect(this.earlyReflectionGain);
    this.earlyDelay2.connect(this.earlyReflectionGain);
    this.earlyReflectionGain.connect(this.masterGain);

    // Create Main HRTF Panner Node
    this.createPannerNode();

    // Start Urgency Pulse Loop
    this.startPulseLoop();
  }

  createPannerNode() {
    if (!this.ctx) return;

    if (this.panner) {
      try { this.panner.disconnect(); } catch (e) {}
    }
    if (this.pinnaFilter) {
      try { this.pinnaFilter.disconnect(); } catch (e) {}
    }
    if (this.threatGain) {
      try { this.threatGain.disconnect(); } catch (e) {}
    }

    // HRTF Panner
    this.panner = this.ctx.createPanner();
    this.panner.panningModel = this.panningModel; // 'HRTF' or 'equalpower'
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 3.0; // Distance where gain is 1.0
    this.panner.maxDistance = 60.0;
    this.panner.rolloffFactor = 0.85;
    this.panner.coneInnerAngle = 360;
    this.panner.coneOuterAngle = 360;

    // Pinna Spectral Shaper (High-Shelf Filter)
    // Front sounds remain crisp; Rear sounds receive subtle high-frequency attenuation
    // simulating the pinna and head shadow to eliminate front-back confusion.
    this.pinnaFilter = this.ctx.createBiquadFilter();
    this.pinnaFilter.type = 'highshelf';
    this.pinnaFilter.frequency.setValueAtTime(4500, this.ctx.currentTime);
    this.pinnaFilter.gain.setValueAtTime(0, this.ctx.currentTime); // Dynamic based on azimuth

    // Threat Audio Gain
    this.threatGain = this.ctx.createGain();
    this.threatGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

    // Audio Graph: [Synth Source] -> threatGain -> pinnaFilter -> panner -> masterGain
    //                                         └-> earlyDelay1 & earlyDelay2
    this.threatGain.connect(this.pinnaFilter);
    this.pinnaFilter.connect(this.panner);
    this.panner.connect(this.masterGain);

    // Send subtle tap to early reflections
    this.threatGain.connect(this.earlyDelay1);
    this.threatGain.connect(this.earlyDelay2);
  }

  setPanningModel(model) {
    this.panningModel = model;
    if (this.panner) {
      this.panner.panningModel = model;
    }
  }

  setSoundType(type) {
    this.soundType = type;
  }

  setMasterVolume(val) {
    this.masterVolume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Updates threat spatial coordinates and applies psychoacoustic filters
   * @param {Object} threat - { x, y, z, distance, azimuthDeg, targetProxy, urgencyLevel }
   */
  updateThreatSpatialPosition(threat) {
    this.currentThreat = threat;
    if (!this.ctx || !this.panner || !threat) return;

    // Coordinate Mapping (Audio Coordinates):
    // X = Right (+X), Left (-X)
    // Y = Elevation (+Y up)
    // Z = Rear (+Z), Front (-Z)
    const audioX = threat.audioX !== undefined ? threat.audioX : threat.x;
    const audioY = threat.audioY !== undefined ? threat.audioY : (threat.z || 0.2);
    const audioZ = threat.audioZ !== undefined ? threat.audioZ : -threat.y;

    const t = this.ctx.currentTime;
    if (this.panner.positionX) {
      this.panner.positionX.setTargetAtTime(audioX, t, 0.04);
      this.panner.positionY.setTargetAtTime(audioY, t, 0.04);
      this.panner.positionZ.setTargetAtTime(audioZ, t, 0.04);
    } else {
      this.panner.setPosition(audioX, audioY, audioZ);
    }

    // Pinna Spectral Shaping:
    // If the threat is in the rear hemisphere (|azimuth| > 105°),
    // apply a -4.5dB shelf above 4.5kHz to mimic outer-ear concha shadowing.
    if (this.pinnaFilter) {
      const absAzimuth = Math.abs(threat.azimuthDeg || 0);
      if (this.panningModel === 'HRTF' && absAzimuth > 100) {
        // Smooth transition to shadowed rear profile
        const rearRatio = Math.min(1, (absAzimuth - 100) / 45); // 0 at 100°, 1 at 145°+
        const shelfAttenuation = -4.5 * rearRatio;
        this.pinnaFilter.gain.setTargetAtTime(shelfAttenuation, t, 0.05);
      } else {
        // Front hemisphere: clear and unfiltered
        this.pinnaFilter.gain.setTargetAtTime(0, t, 0.05);
      }
    }
  }

  /**
   * Continuous pulse scheduler: plays alerts with dynamic tempo based on urgency
   */
  startPulseLoop() {
    const checkAndPulse = () => {
      if (this.ctx && this.currentThreat && !this.gazeCancelled && !this.isMuted) {
        const dist = this.currentThreat.distance || 15;
        
        // Calculate dynamic pulse interval (Urgency Model):
        // 30m+ -> 1.0s interval (1.0 Hz)
        // 15m  -> 0.45s interval (2.2 Hz)
        // 5m   -> 0.16s interval (6.2 Hz)
        const dNorm = Math.max(0, Math.min(1, (dist - 4) / 26)); // 0 at 4m, 1 at 30m
        const intervalMs = 160 + Math.pow(dNorm, 1.4) * 840; // 160ms (critical) to 1000ms (far)

        const now = performance.now();
        if (now - this.lastPulseTime >= intervalMs) {
          this.lastPulseTime = now;
          this.triggerAlertChime(dist);
        }
      }
      this.pulseTimer = requestAnimationFrame(checkAndPulse);
    };

    if (this.pulseTimer) cancelAnimationFrame(this.pulseTimer);
    this.pulseTimer = requestAnimationFrame(checkAndPulse);
  }

  /**
   * Synthesizes a single alert pulse tailored for optimal localization
   * @param {number} distance - Current distance to threat in meters
   */
  triggerAlertChime(distance) {
    if (!this.ctx || !this.threatGain) return;

    // Pitch escalation on critical proximity
    const pitchMultiplier = distance < 7 ? 1.22 : (distance < 14 ? 1.10 : 1.0);
    const now = this.ctx.currentTime;

    switch (this.soundType) {
      case 'chime':
        this.synthADASChime(now, pitchMultiplier);
        break;
      case 'click_train':
        this.synthClickTrain(now, pitchMultiplier);
        break;
      case 'sine':
      default:
        this.synthPureSine(now, pitchMultiplier);
        break;
    }
  }

  /**
   * ADAS Dual Harmonic Chime (Recommended Default)
   * 880Hz + 1320Hz + 2200Hz with 5ms fast attack and rich harmonics.
   * Provides the brain with clear pinna spectral notches for front/back discrimination.
   */
  synthADASChime(now, pitchMult) {
    const f1 = 880 * pitchMult;
    const f2 = 1320 * pitchMult;
    const f3 = 2200 * pitchMult;
    const duration = 0.12; // 120ms burst

    // Oscillator 1 (Base fundamental)
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(f1, now);

    // Oscillator 2 (5th harmonic overtone)
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(f2, now);

    // Oscillator 3 (High overtone for pinna excitation)
    const osc3 = this.ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(f3, now);

    // Fast Attack Envelope (5ms attack, exponential decay)
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.7, now + 0.005); // 5ms attack
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc1.connect(env);
    osc2.connect(env);
    osc3.connect(env);
    env.connect(this.threatGain);

    osc1.start(now);
    osc2.start(now);
    osc3.start(now);

    osc1.stop(now + duration + 0.05);
    osc2.stop(now + duration + 0.05);
    osc3.stop(now + duration + 0.05);
  }

  /**
   * Directional Click Train: Broadband impulse burst
   * Gives maximum ITD onset acuity in the human brainstem
   */
  synthClickTrain(now, pitchMult) {
    const numPulses = 3;
    const pulseSpacing = 0.022; // 22ms pulse train

    for (let i = 0; i < numPulses; i++) {
      const pTime = now + (i * pulseSpacing);
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1400 * pitchMult, pTime);
      osc.frequency.exponentialRampToValueAtTime(450 * pitchMult, pTime + 0.012);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, pTime);
      env.gain.linearRampToValueAtTime(0.65, pTime + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, pTime + 0.015);

      osc.connect(env);
      env.connect(this.threatGain);

      osc.start(pTime);
      osc.stop(pTime + 0.02);
    }
  }

  /**
   * Standard Pure Sine Tone (Included for A/B demonstration)
   * Lacks harmonic content, illustrating why conventional ADAS fails front/back localization
   */
  synthPureSine(now, pitchMult) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(950 * pitchMult, now);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.7, now + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    osc.connect(env);
    env.connect(this.threatGain);

    osc.start(now);
    osc.stop(now + 0.14);
  }

  /**
   * Closed-loop alert cancellation (called when driver gaze confirms threat direction)
   */
  setGazeCancelled(cancelled) {
    this.gazeCancelled = cancelled;
  }

  /**
   * Plays a quick calibration chime in a specific test direction
   */
  playTestChime(azimuthDeg, distance = 8) {
    if (!this.ctx) return;
    const rad = (azimuthDeg * Math.PI) / 180;
    const audioX = Math.sin(rad) * distance;
    const audioZ = -Math.cos(rad) * distance;

    this.updateThreatSpatialPosition({
      x: audioX,
      y: -audioZ,
      z: 0.2,
      audioX,
      audioY: 0.2,
      audioZ,
      azimuthDeg,
      distance
    });

    this.triggerAlertChime(distance);
  }
}
