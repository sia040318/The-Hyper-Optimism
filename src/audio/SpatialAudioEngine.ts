import { PanningModel, SoundType, AudioEngineConfig } from '../types/audio';
import { ThreatObstacle, ProxyTarget } from '../types/threats';
import { GazeZone, HeadPose } from '../types/gaze';

export class SpatialAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private panner: PannerNode | null = null;
  private pinnaFilter: BiquadFilterNode | null = null;
  private earlyDelay1: DelayNode | null = null;
  private earlyDelay2: DelayNode | null = null;
  private earlyReflectionGain: GainNode | null = null;

  // Ambient nodes
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;

  // Configuration
  private config: AudioEngineConfig = {
    panningModel: 'HRTF',
    soundType: 'chime',
    masterVolume: 0.8,
    isMuted: false
  };

  // State
  private isAudioActive = false;
  private isThreatAlertsSuspended = false;
  private pulseTimer: number | null = null;
  private currentThreat: ThreatObstacle | null = null;
  private isGazeCancelled = false;
  private currentGazeZone: GazeZone = 'CENTER';

  // Closed-loop latch state so checking a mirror silences that threat even after returning gaze to road
  private acknowledgedThreatIds: Set<string> = new Set();
  private latchedTarget: ProxyTarget | null = null;
  private latchedUntilTimestamp = 0;

  constructor() {}

  public async init(): Promise<boolean> {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return true;
    }

    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass({ latencyHint: 'interactive' });

    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.config.masterVolume, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // Setup Listener at Driver's Head
    this.setupListener();

    // Setup Early Reflections Bus (anchors sound outside the skull)
    this.setupEarlyReflections();

    // Create main HRTF spatial panner
    this.createPannerNode();

    return true;
  }

  public async start(): Promise<boolean> {
    const initialized = await this.init();
    if (!initialized) return false;

    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.config.masterVolume, this.ctx.currentTime);
    }
    this.isAudioActive = true;
    this.startAmbient();
    this.startPulseScheduler();
    return true;
  }

  public stop() {
    this.isAudioActive = false;
    this.stopPulseScheduler();
    this.stopAmbient();
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  public startAmbient() {
    if (!this.ctx || !this.masterGain) return;
    this.stopAmbient();

    const t = this.ctx.currentTime;

    // Engine: two sawtooth oscillators (base 38 Hz and double that) through a lowpass filter at 220 Hz, with gain 0.05
    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.setValueAtTime(38, t);

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.frequency.setValueAtTime(76, t);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(220, t);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.05, t);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start(t);
    this.engineOsc2.start(t);

    // Road/wind noise: looping white noise from a 2-second buffer through a lowpass filter starting at 400 Hz, with gain 0.02
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;

    this.noiseFilter = this.ctx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.setValueAtTime(400, t);

    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.setValueAtTime(0.02, t);

    this.noiseSource.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);

    this.noiseSource.start(t);
  }

  public setAmbientSpeed(kmh: number) {
    if (!this.ctx) return;
    const speed = Math.max(0, Math.min(180, kmh));
    const t = this.ctx.currentTime;
    const enginePitch = 38 + speed * 0.45;

    if (this.engineOsc1) {
      this.engineOsc1.frequency.setTargetAtTime(enginePitch, t, 0.05);
    }
    if (this.engineOsc2) {
      this.engineOsc2.frequency.setTargetAtTime(enginePitch * 2, t, 0.05);
    }
    if (this.noiseFilter) {
      this.noiseFilter.frequency.setTargetAtTime(400 + speed * 8, t, 0.05);
    }
    if (this.noiseGain) {
      this.noiseGain.gain.setTargetAtTime(0.02 + speed * 0.0005, t, 0.05);
    }
  }

  public stopAmbient() {
    if (this.engineOsc1) {
      try {
        this.engineOsc1.stop();
        this.engineOsc1.disconnect();
      } catch {}
      this.engineOsc1 = null;
    }
    if (this.engineOsc2) {
      try {
        this.engineOsc2.stop();
        this.engineOsc2.disconnect();
      } catch {}
      this.engineOsc2 = null;
    }
    if (this.engineFilter) {
      try {
        this.engineFilter.disconnect();
      } catch {}
      this.engineFilter = null;
    }
    if (this.engineGain) {
      try {
        this.engineGain.disconnect();
      } catch {}
      this.engineGain = null;
    }
    if (this.noiseSource) {
      try {
        this.noiseSource.stop();
        this.noiseSource.disconnect();
      } catch {}
      this.noiseSource = null;
    }
    if (this.noiseFilter) {
      try {
        this.noiseFilter.disconnect();
      } catch {}
      this.noiseFilter = null;
    }
    if (this.noiseGain) {
      try {
        this.noiseGain.disconnect();
      } catch {}
      this.noiseGain = null;
    }
  }

  public toggleAudio(): boolean {
    if (this.isAudioActive) {
      this.stop();
      return false;
    } else {
      this.start();
      return true;
    }
  }

  public setThreatAlertsSuspended(suspended: boolean) {
    this.isThreatAlertsSuspended = suspended;
  }

  public getThreatAlertsSuspended(): boolean {
    return this.isThreatAlertsSuspended;
  }

  public resetAcknowledgments() {
    this.acknowledgedThreatIds.clear();
    this.latchedTarget = null;
    this.latchedUntilTimestamp = 0;
    this.isGazeCancelled = false;
    this.evaluateGazeCancellation();
  }

  private setupListener() {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;

    if (l.positionX) {
      l.positionX.setValueAtTime(0, t);
      l.positionY.setValueAtTime(1.2, t);
      l.positionZ.setValueAtTime(0, t);
      l.forwardX.setValueAtTime(0, t);
      l.forwardY.setValueAtTime(0, t);
      l.forwardZ.setValueAtTime(-1, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(0, 1.2, 0);
      l.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  /**
   * Dynamically compensates listener orientation based on driver's head yaw and pitch.
   * This anchors the virtual cockpit sound sources in world space!
   */
  public updateHeadOrientation(headPose: HeadPose) {
    if (!this.ctx || !this.isAudioActive) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;

    // Convert yaw to radians (yaw: right is +, left is -)
    const yawRad = (headPose.yaw * Math.PI) / 180.0;
    const pitchRad = (headPose.pitch * Math.PI) / 180.0;

    // Compute rotated forward vector in Web Audio (Facing -Z initially)
    const fx = Math.sin(yawRad) * Math.cos(pitchRad);
    const fy = Math.sin(pitchRad);
    const fz = -Math.cos(yawRad) * Math.cos(pitchRad);

    if (l.forwardX) {
      l.forwardX.setTargetAtTime(fx, t, 0.05);
      l.forwardY.setTargetAtTime(fy, t, 0.05);
      l.forwardZ.setTargetAtTime(fz, t, 0.05);
    } else {
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  private setupEarlyReflections() {
    if (!this.ctx || !this.masterGain) return;
    this.earlyReflectionGain = this.ctx.createGain();
    this.earlyReflectionGain.gain.setValueAtTime(0.14, this.ctx.currentTime);

    this.earlyDelay1 = this.ctx.createDelay(0.1);
    this.earlyDelay1.delayTime.setValueAtTime(0.013, this.ctx.currentTime); // 13ms cabin reflection
    this.earlyDelay2 = this.ctx.createDelay(0.1);
    this.earlyDelay2.delayTime.setValueAtTime(0.019, this.ctx.currentTime); // 19ms cabin reflection

    this.earlyDelay1.connect(this.earlyReflectionGain);
    this.earlyDelay2.connect(this.earlyReflectionGain);
    this.earlyReflectionGain.connect(this.masterGain);
  }

  public createPannerNode() {
    if (!this.ctx || !this.masterGain) return;

    if (this.panner) {
      try {
        this.panner.disconnect();
      } catch {}
    }
    if (this.pinnaFilter) {
      try {
        this.pinnaFilter.disconnect();
      } catch {}
    }

    this.panner = this.ctx.createPanner();
    this.panner.panningModel = this.config.panningModel;
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 2.5;
    this.panner.maxDistance = 60.0;
    this.panner.rolloffFactor = 0.75;
    this.panner.coneInnerAngle = 360;

    // Pinna spectral filter (shapes rear frequencies to eliminate front-back confusion)
    this.pinnaFilter = this.ctx.createBiquadFilter();
    this.pinnaFilter.type = 'highshelf';
    this.pinnaFilter.frequency.setValueAtTime(4200, this.ctx.currentTime);
    this.pinnaFilter.gain.setValueAtTime(0, this.ctx.currentTime);

    // Connect: Pinna -> Panner -> Master + Early Reflections
    this.pinnaFilter.connect(this.panner);
    this.panner.connect(this.masterGain);

    if (this.earlyDelay1 && this.earlyDelay2) {
      this.panner.connect(this.earlyDelay1);
      this.panner.connect(this.earlyDelay2);
    }
  }

  public updateSpatialPosition(xVeh: number, yVeh: number, azimuthDeg: number) {
    if (!this.panner || !this.ctx) return;
    const t = this.ctx.currentTime;

    // Transform Vehicle Coordinates to Web Audio Listener Coordinates:
    // Vehicle: X=Lateral (Right+), Y=Longitudinal (Forward+)
    // Audio:   X=Right(+), Y=Up(+), Z=Behind(+) / Forward(-)
    const audioX = xVeh;
    const audioY = 1.1;
    const audioZ = -yVeh;

    if (this.panner.positionX) {
      this.panner.positionX.setTargetAtTime(audioX, t, 0.035);
      this.panner.positionY.setTargetAtTime(audioY, t, 0.035);
      this.panner.positionZ.setTargetAtTime(audioZ, t, 0.035);
    } else {
      this.panner.setPosition(audioX, audioY, audioZ);
    }

    // Rear Pinna Spectral Notch Filter:
    // Attenuate highs (>4.2 kHz) by -5.0dB when threat is in rear hemisphere (|azimuth| > 105°)
    if (this.pinnaFilter) {
      const isRear = Math.abs(azimuthDeg) > 105;
      const targetGain = isRear ? -5.0 : 1.0;
      this.pinnaFilter.gain.setTargetAtTime(targetGain, t, 0.04);
    }
  }

  public setThreat(threat: ThreatObstacle | null) {
    this.currentThreat = threat;
    if (threat) {
      this.updateSpatialPosition(threat.x, threat.y, threat.azimuth);
      this.evaluateGazeCancellation();
    } else {
      this.isGazeCancelled = false;
    }
  }

  public setGazeZone(zone: GazeZone) {
    this.currentGazeZone = zone;
    this.evaluateGazeCancellation();
  }

  private evaluateGazeCancellation() {
    if (!this.currentThreat) {
      this.isGazeCancelled = false;
      return;
    }

    const now = performance.now();
    const target = this.currentThreat.proxyTarget;
    const directMatch =
      (target === 'LEFT_MIRROR' && this.currentGazeZone === 'LEFT_MIRROR') ||
      (target === 'RIGHT_MIRROR' && this.currentGazeZone === 'RIGHT_MIRROR') ||
      (target === 'REAR_MIRROR' && this.currentGazeZone === 'REAR_MIRROR');

    if (directMatch) {
      const wasCancelled = this.isGazeCancelled;
      this.isGazeCancelled = true;
      // Latch acknowledgment for this specific vehicle ID (or 4.5s for looping scenario)
      if (this.currentThreat.id.startsWith('car_')) {
        this.acknowledgedThreatIds.add(this.currentThreat.id);
      }
      this.latchedTarget = target;
      this.latchedUntilTimestamp = now + 4500;

      if (!wasCancelled && this.isAudioActive && !this.isThreatAlertsSuspended) {
        this.playAcknowledgeEarcon();
      }
      return;
    }

    // Check if already latched for this vehicle or recent mirror check
    if (
      (this.currentThreat.id.startsWith('car_') && this.acknowledgedThreatIds.has(this.currentThreat.id)) ||
      (this.latchedTarget === target && now < this.latchedUntilTimestamp)
    ) {
      this.isGazeCancelled = true;
      return;
    }

    this.isGazeCancelled = false;
  }

  /**
   * Subtle 2-note ascending confirmation chime when closed-loop gaze mutes an active threat
   */
  public playAcknowledgeEarcon() {
    if (!this.ctx || !this.masterGain || this.config.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const notes = [1046.5, 1567.98]; // C6 -> G6 pleasant confirmation
      notes.forEach((freq, idx) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + idx * 0.055);

        gain.gain.setValueAtTime(0.0001, t + idx * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.12, t + idx * 0.055 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.055 + 0.14);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t + idx * 0.055);
        osc.stop(t + idx * 0.055 + 0.15);
      });
    } catch {}
  }

  private startPulseScheduler() {
    this.stopPulseScheduler();

    const loop = () => {
      if (!this.isAudioActive) {
        this.pulseTimer = null;
        return;
      }

      this.evaluateGazeCancellation();

      if (
        this.ctx &&
        !this.isThreatAlertsSuspended &&
        !this.isGazeCancelled &&
        this.currentThreat
      ) {
        const dist = this.currentThreat.distance;
        if (dist <= 32.0) {
          this.playAlertPulse(dist);
        }
      }

      // Compute dynamic delay based on threat distance (ISO 15006 urgency)
      let nextDelayMs = 900;
      if (this.currentThreat) {
        const d = Math.max(2.0, Math.min(32.0, this.currentThreat.distance));
        // Exponential urgency curve: 32m -> 780ms; 3m -> 135ms
        const ratio = (d - 2.0) / 30.0;
        nextDelayMs = 135 + Math.pow(ratio, 1.45) * 645;
      }

      if (this.isAudioActive) {
        this.pulseTimer = window.setTimeout(loop, nextDelayMs);
      } else {
        this.pulseTimer = null;
      }
    };

    loop();
  }

  public stopPulseScheduler() {
    if (this.pulseTimer !== null) {
      clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
  }

  public playAlertPulse(distanceMeters = 10.0) {
    if (!this.ctx || !this.pinnaFilter || this.config.isMuted) return;

    const t = this.ctx.currentTime;
    const sound = this.config.soundType;

    // ISO 15006 Pitch Escalation: closer threats shift pitch upward up to +25%
    const clampedDist = Math.max(2.0, Math.min(30.0, distanceMeters));
    const urgencyRatio = 1.0 - (clampedDist - 2.0) / 28.0; // 0.0 (far) to 1.0 (critical)
    const pitchMultiplier = 1.0 + urgencyRatio * 0.25;

    if (sound === 'chime') {
      this.synthesizeChime(t, pitchMultiplier);
    } else if (sound === 'click_train') {
      this.synthesizeClickTrain(t, pitchMultiplier);
    } else {
      this.synthesizeSine(t, pitchMultiplier);
    }
  }

  private synthesizeChime(t: number, pitchMult = 1.0) {
    if (!this.ctx || !this.pinnaFilter) return;

    // Harmonic blend: 880Hz (A5) fundamental + 1320Hz + 2200Hz + 3520Hz (for pinna cues)
    const freqs = [880 * pitchMult, 1320 * pitchMult, 2200 * pitchMult, 3520 * pitchMult];
    const gains = [0.28, 0.16, 0.09, 0.05];

    freqs.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = idx === 3 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      // Fast transient attack (3ms), exponential decay (120ms)
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(gains[idx], t + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

      osc.connect(gain);
      gain.connect(this.pinnaFilter!);

      osc.start(t);
      osc.stop(t + 0.14);
    });
  }

  private synthesizeClickTrain(t: number, pitchMult = 1.0) {
    if (!this.ctx || !this.pinnaFilter) return;

    // 3 rapid broadband clicks 22ms apart
    for (let i = 0; i < 3; i++) {
      const clickTime = t + i * 0.022;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(1400 * pitchMult, clickTime);

      gain.gain.setValueAtTime(0.001, clickTime);
      gain.gain.exponentialRampToValueAtTime(0.24, clickTime + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.015);

      osc.connect(gain);
      gain.connect(this.pinnaFilter);

      osc.start(clickTime);
      osc.stop(clickTime + 0.018);
    }
  }

  private synthesizeSine(t: number, pitchMult = 1.0) {
    if (!this.ctx || !this.pinnaFilter) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000 * pitchMult, t);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(this.pinnaFilter);

    osc.start(t);
    osc.stop(t + 0.16);
  }

  /**
   * Plays an immediate single spatial cue toward a specific proxy direction (for direction test buttons)
   */
  public testDirection(target: ProxyTarget) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.config.masterVolume, this.ctx.currentTime);
    }
    let x = 0,
      y = 10,
      az = 0;
    switch (target) {
      case 'LEFT_MIRROR':
        x = -5.0;
        y = -1.5;
        az = -95;
        break;
      case 'RIGHT_MIRROR':
        x = 5.0;
        y = -1.5;
        az = 95;
        break;
      case 'REAR_MIRROR':
        x = 0.0;
        y = -10.0;
        az = 180;
        break;
      case 'FRONT_WINDSHIELD':
        x = 0.0;
        y = 12.0;
        az = 0;
        break;
    }

    this.updateSpatialPosition(x, y, az);
    this.playAlertPulse(8.0);
  }

  public setPanningModel(model: PanningModel) {
    this.config.panningModel = model;
    this.createPannerNode();
  }

  public setSoundType(type: SoundType) {
    this.config.soundType = type;
  }

  public setMasterVolume(vol: number) {
    this.config.masterVolume = vol;
    if (this.masterGain && this.ctx && this.isAudioActive) {
      this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    }
  }

  public getConfig(): AudioEngineConfig {
    return { ...this.config };
  }

  public getIsActive(): boolean {
    return this.isAudioActive;
  }

  public getIsCancelled(): boolean {
    return this.isGazeCancelled;
  }

  public cleanup() {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
  }
}
