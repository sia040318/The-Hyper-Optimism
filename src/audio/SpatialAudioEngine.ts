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

  // Configuration
  private config: AudioEngineConfig = {
    panningModel: 'HRTF',
    soundType: 'chime',
    masterVolume: 0.8,
    isMuted: false
  };

  // State
  private isAudioActive = false;
  private pulseTimer: number | null = null;
  private currentThreat: ThreatObstacle | null = null;
  private isGazeCancelled = false;
  private currentGazeZone: GazeZone = 'CENTER';

  constructor() {}

  public async init(): Promise<boolean> {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      this.isAudioActive = true;
      return true;
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

    this.isAudioActive = true;
    this.startPulseScheduler();
    return true;
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
    this.earlyReflectionGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

    this.earlyDelay1 = this.ctx.createDelay(0.1);
    this.earlyDelay1.delayTime.setValueAtTime(0.013, this.ctx.currentTime); // 13ms reflection
    this.earlyDelay2 = this.ctx.createDelay(0.1);
    this.earlyDelay2.delayTime.setValueAtTime(0.019, this.ctx.currentTime); // 19ms reflection

    this.earlyDelay1.connect(this.earlyReflectionGain);
    this.earlyDelay2.connect(this.earlyReflectionGain);
    this.earlyReflectionGain.connect(this.masterGain);
  }

  public createPannerNode() {
    if (!this.ctx || !this.masterGain) return;

    if (this.panner) {
      try { this.panner.disconnect(); } catch {}
    }
    if (this.pinnaFilter) {
      try { this.pinnaFilter.disconnect(); } catch {}
    }

    this.panner = this.ctx.createPanner();
    this.panner.panningModel = this.config.panningModel;
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 2.0;
    this.panner.maxDistance = 60.0;
    this.panner.rolloffFactor = 0.8;
    this.panner.coneInnerAngle = 360;

    // Pinna spectral filter (shapes rear frequencies to eliminate front-back confusion)
    this.pinnaFilter = this.ctx.createBiquadFilter();
    this.pinnaFilter.type = 'highshelf';
    this.pinnaFilter.frequency.setValueAtTime(4500, this.ctx.currentTime);
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
    const audioY = 1.0;
    const audioZ = -yVeh;

    if (this.panner.positionX) {
      this.panner.positionX.setTargetAtTime(audioX, t, 0.04);
      this.panner.positionY.setTargetAtTime(audioY, t, 0.04);
      this.panner.positionZ.setTargetAtTime(audioZ, t, 0.04);
    } else {
      this.panner.setPosition(audioX, audioY, audioZ);
    }

    // Rear Pinna Spectral Notch Filter:
    // Attenuate highs (>4.5 kHz) by -4dB when threat is in rear hemisphere (|azimuth| > 105°)
    if (this.pinnaFilter) {
      const isRear = Math.abs(azimuthDeg) > 105;
      const targetGain = isRear ? -4.5 : 0.0;
      this.pinnaFilter.gain.setTargetAtTime(targetGain, t, 0.05);
    }
  }

  public setThreat(threat: ThreatObstacle | null) {
    this.currentThreat = threat;
    if (threat) {
      this.updateSpatialPosition(threat.x, threat.y, threat.azimuth);
      this.evaluateGazeCancellation();
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

    const target = this.currentThreat.proxyTarget;
    const matches = 
      (target === 'LEFT_MIRROR' && this.currentGazeZone === 'LEFT_MIRROR') ||
      (target === 'RIGHT_MIRROR' && this.currentGazeZone === 'RIGHT_MIRROR') ||
      (target === 'REAR_MIRROR' && this.currentGazeZone === 'REAR_MIRROR') ||
      (target === 'FRONT_WINDSHIELD' && this.currentGazeZone === 'CENTER');

    this.isGazeCancelled = matches;
  }

  private startPulseScheduler() {
    const loop = () => {
      if (this.isAudioActive && this.ctx && !this.isGazeCancelled && this.currentThreat) {
        const dist = this.currentThreat.distance;
        if (dist <= 30.0) {
          this.playAlertPulse();
        }
      }

      // Compute dynamic delay based on threat distance (ISO 15006 urgency)
      let nextDelayMs = 1000;
      if (this.currentThreat) {
        const d = Math.max(2.0, Math.min(30.0, this.currentThreat.distance));
        // Exponential urgency curve: 30m -> 800ms; 4m -> 150ms
        const ratio = (d - 2.0) / 28.0;
        nextDelayMs = 150 + Math.pow(ratio, 1.4) * 650;
      }

      this.pulseTimer = window.setTimeout(loop, nextDelayMs);
    };

    loop();
  }

  public playAlertPulse() {
    if (!this.ctx || !this.pinnaFilter || this.config.isMuted) return;

    const t = this.ctx.currentTime;
    const sound = this.config.soundType;

    if (sound === 'chime') {
      this.synthesizeChime(t);
    } else if (sound === 'click_train') {
      this.synthesizeClickTrain(t);
    } else {
      this.synthesizeSine(t);
    }
  }

  private synthesizeChime(t: number) {
    if (!this.ctx || !this.pinnaFilter) return;

    // Harmonic blend: 880Hz (A5) fundamental + 1320Hz + 2200Hz
    const freqs = [880, 1320, 2200];
    const gains = [0.28, 0.16, 0.08];

    freqs.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      // Fast transient attack (3ms), exponential decay (120ms)
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(gains[idx], t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);

      osc.connect(gain);
      gain.connect(this.pinnaFilter!);

      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  private synthesizeClickTrain(t: number) {
    if (!this.ctx || !this.pinnaFilter) return;

    // 3 rapid clicks 25ms apart
    for (let i = 0; i < 3; i++) {
      const clickTime = t + i * 0.025;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(1400, clickTime);

      gain.gain.setValueAtTime(0.001, clickTime);
      gain.gain.exponentialRampToValueAtTime(0.24, clickTime + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.015);

      osc.connect(gain);
      gain.connect(this.pinnaFilter);

      osc.start(clickTime);
      osc.stop(clickTime + 0.018);
    }
  }

  private synthesizeSine(t: number) {
    if (!this.ctx || !this.pinnaFilter) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, t);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(this.pinnaFilter);

    osc.start(t);
    osc.stop(t + 0.17);
  }

  /**
   * Plays an immediate single spatial cue toward a specific proxy direction (for direction test buttons)
   */
  public testDirection(target: ProxyTarget) {
    if (!this.ctx) return;
    let x = 0, y = 10, az = 0;
    switch (target) {
      case 'LEFT_MIRROR':
        x = -6.0; y = 0.0; az = -90;
        break;
      case 'RIGHT_MIRROR':
        x = 6.0; y = 0.0; az = 90;
        break;
      case 'REAR_MIRROR':
        x = 0.0; y = -12.0; az = 180;
        break;
      case 'FRONT_WINDSHIELD':
        x = 0.0; y = 12.0; az = 0;
        break;
    }

    this.updateSpatialPosition(x, y, az);
    this.playAlertPulse();
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
    if (this.masterGain && this.ctx) {
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
    if (this.pulseTimer) {
      clearTimeout(this.pulseTimer);
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
  }
}
