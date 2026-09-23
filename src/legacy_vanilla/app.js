/**
 * Main Application Orchestrator
 * Integrates SpatialAudioEngine, ThreatManager, RadarDisplay, and HCIEvaluator.
 * Connects to local CARLA WebSocket bridge when available.
 */

import { SpatialAudioEngine } from './audio_engine.js';
import { ThreatManager } from './threats.js';
import { RadarDisplay } from './radar.js';
import { HCIEvaluator } from './evaluator.js';

class ADASCockpitApp {
  constructor() {
    this.audio = new SpatialAudioEngine();
    this.threats = new ThreatManager();
    this.radar = null;
    this.evaluator = null;

    // Simulation & State
    this.lastFrameTime = performance.now();
    this.driverGaze = 'CENTER'; // 'CENTER', 'LEFT_MIRROR', 'RIGHT_MIRROR', 'REAR_MIRROR'
    this.gazeTimer = null;
    this.carlaWs = null;
    this.isCarlaConnected = false;

    // DOM Elements
    this.dom = {
      canvas: document.getElementById('radarCanvas'),
      btnStartAudio: document.getElementById('btnStartAudio'),
      audioStatusDot: document.getElementById('audioStatusDot'),
      audioStatusText: document.getElementById('audioStatusText'),
      carlaStatusDot: document.getElementById('carlaStatusDot'),
      carlaStatusText: document.getElementById('carlaStatusText'),
      volumeSlider: document.getElementById('volumeSlider'),
      volValue: document.getElementById('volValue'),
      panningSelector: document.getElementById('panningSelector'),
      soundSelector: document.getElementById('soundSelector'),
      scenarioBtns: document.querySelectorAll('.scenario-btn'),
      
      // Mirror Cards
      mirrorLeft: document.getElementById('mirrorLeft'),
      mirrorRear: document.getElementById('mirrorRear'),
      mirrorRight: document.getElementById('mirrorRight'),
      statusLeft: document.getElementById('statusLeft'),
      statusRear: document.getElementById('statusRear'),
      statusRight: document.getElementById('statusRight'),

      // Telemetry
      telemAzimuth: document.getElementById('telemAzimuth'),
      telemDistance: document.getElementById('telemDistance'),
      telemProxy: document.getElementById('telemProxy'),
      telemUrgency: document.getElementById('telemUrgency'),
      gazeState: document.getElementById('gazeState'),
      btnSimulateGaze: document.getElementById('btnSimulateGaze'),

      // Direction test buttons
      btnTestLeft: document.getElementById('btnTestLeft'),
      btnTestRight: document.getElementById('btnTestRight'),
      btnTestRear: document.getElementById('btnTestRear'),
      btnTestFront: document.getElementById('btnTestFront'),

      // Study & Evaluation
      btnStartStudy: document.getElementById('btnStartStudy'),
      btnExportCSV: document.getElementById('btnExportCSV'),
      statCondition: document.getElementById('statCondition'),
      statProgress: document.getElementById('statProgress'),
      statAccuracy: document.getElementById('statAccuracy'),
      statReactionTime: document.getElementById('statReactionTime'),
      statFrontBack: document.getElementById('statFrontBack')
    };

    this.init();
  }

  init() {
    // 1. Initialize Radar Display
    this.radar = new RadarDisplay(this.dom.canvas, this.threats, (movedThreat) => {
      this.audio.updateThreatSpatialPosition(movedThreat);
      this.updateTelemetry(movedThreat);
    });

    // 2. Initialize HCI Evaluator
    this.evaluator = new HCIEvaluator(
      this.audio,
      this.threats,
      (trialResult, current, total) => this.onTrialComplete(trialResult, current, total),
      (summary, allTrials) => this.onStudyFinished(summary, allTrials)
    );

    // 3. Setup UI & Keyboard Listeners
    this.setupEventListeners();

    // 4. Load Initial Scenario
    this.threats.loadScenario('BLIND_SPOT_LEFT');
    const primary = this.threats.getPrimaryThreat();
    if (primary) {
      this.audio.updateThreatSpatialPosition(primary);
      this.updateTelemetry(primary);
    }

    // 5. Connect to CARLA WebSocket Bridge
    this.connectCarlaWebSocket();

    // 6. Start Main 60 FPS Render & Simulation Loop
    requestAnimationFrame((t) => this.mainLoop(t));
  }

  setupEventListeners() {
    // Start Audio
    this.dom.btnStartAudio.addEventListener('click', async () => {
      await this.audio.init();
      this.dom.audioStatusDot.classList.add('active');
      this.dom.audioStatusText.textContent = `Audio: 3D ${this.audio.panningModel} Active`;
      this.dom.btnStartAudio.innerHTML = '<span>🔊 Audio Engine Running</span>';
      this.dom.btnStartAudio.classList.remove('btn-primary');
      this.dom.btnStartAudio.classList.add('btn-accent');

      // Update primary threat position
      const primary = this.threats.getPrimaryThreat();
      if (primary) this.audio.updateThreatSpatialPosition(primary);
    });

    // Volume Slider
    this.dom.volumeSlider.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10);
      this.dom.volValue.textContent = `${vol}%`;
      this.audio.setMasterVolume(vol / 100);
    });

    // Panning Model Selector (HRTF vs Stereo)
    this.dom.panningSelector.addEventListener('click', (e) => {
      if (e.target.classList.contains('segment-btn')) {
        this.dom.panningSelector.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const model = e.target.getAttribute('data-panning');
        this.audio.setPanningModel(model);
        this.dom.statCondition.textContent = model === 'HRTF' ? '3D HRTF' : 'Stereo';
        if (this.audio.ctx) {
          this.dom.audioStatusText.textContent = `Audio: ${model} Active`;
        }
      }
    });

    // Sound Waveform Selector
    this.dom.soundSelector.addEventListener('click', (e) => {
      if (e.target.classList.contains('segment-btn')) {
        this.dom.soundSelector.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const sound = e.target.getAttribute('data-sound');
        this.audio.setSoundType(sound);
      }
    });

    // Quick Test Buttons
    this.dom.btnTestLeft.addEventListener('click', () => this.playQuickTest(-90));
    this.dom.btnTestRight.addEventListener('click', () => this.playQuickTest(90));
    this.dom.btnTestRear.addEventListener('click', () => this.playQuickTest(180));
    this.dom.btnTestFront.addEventListener('click', () => this.playQuickTest(0));

    // Scenario Buttons
    this.dom.scenarioBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.scenarioBtns.forEach(b => {
          b.classList.remove('active', 'btn-accent');
        });
        btn.classList.add('active', 'btn-accent');
        const scenario = btn.getAttribute('data-scenario');
        this.threats.loadScenario(scenario);

        const primary = this.threats.getPrimaryThreat();
        if (primary) {
          this.audio.updateThreatSpatialPosition(primary);
          this.updateTelemetry(primary);
        }
      });
    });

    // Mirror Click Handlers (Respond in Study or Simulate Gaze)
    this.dom.mirrorLeft.addEventListener('click', () => this.handleDirectionInput('LEFT_MIRROR'));
    this.dom.mirrorRear.addEventListener('click', () => this.handleDirectionInput('REAR_MIRROR'));
    this.dom.mirrorRight.addEventListener('click', () => this.handleDirectionInput('RIGHT_MIRROR'));

    // Gaze Simulation Button
    this.dom.btnSimulateGaze.addEventListener('click', () => {
      const primary = this.threats.getPrimaryThreat();
      if (primary && primary.targetProxy !== 'NONE') {
        this.simulateGazeCheck(primary.targetProxy);
      }
    });

    // HCI Study Buttons
    this.dom.btnStartStudy.addEventListener('click', async () => {
      await this.audio.init();
      this.dom.btnStartStudy.textContent = '⏳ Study Running... Listen carefully!';
      this.dom.btnStartStudy.disabled = true;
      this.dom.statProgress.textContent = 'Trial 1 of 10...';
      this.evaluator.startStudy(10, this.audio.panningModel);
    });

    this.dom.btnExportCSV.addEventListener('click', () => {
      this.evaluator.exportToCSV();
    });

    // Keyboard Shortcuts (A/D/S/W or Arrows)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      const key = e.key.toLowerCase();
      if (key === 'a' || key === 'arrowleft') {
        this.handleDirectionInput('LEFT_MIRROR');
      } else if (key === 'd' || key === 'arrowright') {
        this.handleDirectionInput('RIGHT_MIRROR');
      } else if (key === 's' || key === 'arrowdown') {
        this.handleDirectionInput('REAR_MIRROR');
      } else if (key === 'w' || key === 'arrowup') {
        this.handleDirectionInput('FRONT_WINDSHIELD');
      } else if (key === 'g') {
        const primary = this.threats.getPrimaryThreat();
        if (primary && primary.targetProxy !== 'NONE') {
          this.simulateGazeCheck(primary.targetProxy);
        }
      }
    });

    window.addEventListener('resize', () => {
      if (this.radar) this.radar.resize();
    });
  }

  async playQuickTest(azimuthDeg) {
    await this.audio.init();
    this.audio.playTestChime(azimuthDeg, 7.5);
    const rad = (azimuthDeg * Math.PI) / 180;
    this.radar.emitSoundRipple({
      x: Math.sin(rad) * 7.5,
      y: Math.cos(rad) * 7.5,
      distance: 7.5,
      urgencyLevel: 'WARNING'
    });
  }

  handleDirectionInput(direction) {
    if (this.evaluator && this.evaluator.isRunning) {
      this.evaluator.recordResponse(direction);
    } else {
      this.simulateGazeCheck(direction);
    }
  }

  simulateGazeCheck(targetZone) {
    this.driverGaze = targetZone;
    this.radar.setGazeDirection(targetZone);
    this.dom.gazeState.textContent = `${targetZone.replace('_', ' ')} (Fixating)`;
    this.dom.gazeState.style.color = 'var(--accent-emerald)';

    // Closed-loop alert cancellation rule:
    // If gaze matches threat proxy mirror, mute alert!
    const primary = this.threats.getPrimaryThreat();
    if (primary && primary.targetProxy === targetZone) {
      this.audio.setGazeCancelled(true);
      this.highlightMirror(targetZone, 'gazed');
    }

    if (this.gazeTimer) clearTimeout(this.gazeTimer);
    // Return gaze to center road after 1.5s
    this.gazeTimer = setTimeout(() => {
      this.driverGaze = 'CENTER';
      this.radar.setGazeDirection('CENTER');
      this.dom.gazeState.textContent = 'CENTER (Road Ahead)';
      this.dom.gazeState.style.color = 'var(--text-main)';
      this.audio.setGazeCancelled(false);
      this.clearMirrorHighlights();
    }, 1500);
  }

  highlightMirror(zone, className) {
    this.clearMirrorHighlights();
    if (zone === 'LEFT_MIRROR') this.dom.mirrorLeft.classList.add(className);
    if (zone === 'REAR_MIRROR') this.dom.mirrorRear.classList.add(className);
    if (zone === 'RIGHT_MIRROR') this.dom.mirrorRight.classList.add(className);
  }

  clearMirrorHighlights() {
    this.dom.mirrorLeft.classList.remove('alerting', 'gazed');
    this.dom.mirrorRear.classList.remove('alerting', 'gazed');
    this.dom.mirrorRight.classList.remove('alerting', 'gazed');
  }

  onTrialComplete(trialResult, current, total) {
    this.dom.statProgress.textContent = `Trial ${current} of ${total} [${trialResult.isCorrect ? '✓ CORRECT' : '✗ INCORRECT'}]`;
    if (trialResult.isFrontBackConfusion) {
      this.dom.statProgress.textContent += ' (Front-Back Confusion!)';
    }
  }

  onStudyFinished(summary) {
    this.dom.btnStartStudy.disabled = false;
    this.dom.btnStartStudy.textContent = '▶ Run Another Reaction Study';
    this.dom.statProgress.textContent = 'Study Completed!';
    this.dom.statAccuracy.textContent = `${summary.accuracyPct}% (${summary.correctCount}/${summary.totalTrials})`;
    this.dom.statReactionTime.textContent = `${summary.avgReactionTimeMs} ms`;
    this.dom.statFrontBack.textContent = `${summary.frontBackErrorRatePct}%`;
  }

  updateTelemetry(threat) {
    if (!threat) {
      this.dom.telemAzimuth.textContent = '--';
      this.dom.telemDistance.textContent = '--';
      this.dom.telemProxy.textContent = 'NONE';
      this.dom.telemUrgency.textContent = 'SAFE';
      this.dom.telemUrgency.style.color = 'var(--accent-emerald)';
      return;
    }

    this.dom.telemAzimuth.textContent = `${threat.azimuthDeg > 0 ? '+' : ''}${threat.azimuthDeg}°`;
    this.dom.telemDistance.textContent = `${threat.distance} m`;
    this.dom.telemProxy.textContent = threat.targetProxy.replace('_', ' ');

    this.dom.telemUrgency.textContent = threat.urgencyLevel;
    if (threat.urgencyLevel === 'CRITICAL') {
      this.dom.telemUrgency.style.color = 'var(--accent-red)';
    } else if (threat.urgencyLevel === 'WARNING') {
      this.dom.telemUrgency.style.color = 'var(--accent-amber)';
    } else {
      this.dom.telemUrgency.style.color = 'var(--accent-cyan)';
    }

    // Update Mirror Statuses
    if (!this.audio.gazeCancelled) {
      this.dom.statusLeft.textContent = threat.targetProxy === 'LEFT_MIRROR' ? '⚠️ WARNING' : 'CLEAR';
      this.dom.statusRear.textContent = threat.targetProxy === 'REAR_MIRROR' ? '⚠️ WARNING' : 'CLEAR';
      this.dom.statusRight.textContent = threat.targetProxy === 'RIGHT_MIRROR' ? '⚠️ WARNING' : 'CLEAR';

      if (threat.targetProxy === 'LEFT_MIRROR') this.highlightMirror('LEFT_MIRROR', 'alerting');
      else if (threat.targetProxy === 'REAR_MIRROR') this.highlightMirror('REAR_MIRROR', 'alerting');
      else if (threat.targetProxy === 'RIGHT_MIRROR') this.highlightMirror('RIGHT_MIRROR', 'alerting');
      else this.clearMirrorHighlights();
    }
  }

  connectCarlaWebSocket() {
    const wsUrl = 'ws://127.0.0.1:8765';
    try {
      this.carlaWs = new WebSocket(wsUrl);

      this.carlaWs.onopen = () => {
        this.isCarlaConnected = true;
        this.dom.carlaStatusDot.classList.add('active');
        this.dom.carlaStatusText.textContent = 'CARLA Bridge: Connected (Live Stream)';
      };

      this.carlaWs.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.processCarlaPayload(payload);
        } catch (e) {
          console.error('Error parsing CARLA payload:', e);
        }
      };

      this.carlaWs.onclose = () => {
        this.isCarlaConnected = false;
        this.dom.carlaStatusDot.classList.remove('active');
        this.dom.carlaStatusText.textContent = 'CARLA Bridge: Standalone';
        // Retry connection every 4s
        setTimeout(() => this.connectCarlaWebSocket(), 4000);
      };

      this.carlaWs.onerror = () => {
        // Silent failure if CARLA is not running
      };
    } catch (e) {
      // WebSocket not running
    }
  }

  processCarlaPayload(payload) {
    if (!payload.threats || payload.threats.length === 0) return;

    // Load CARLA threats into ThreatManager
    this.threats.clearThreats();
    payload.threats.forEach(t => {
      // Convert CARLA relative coordinates (+X forward, +Y right, +Z up)
      // into our Threat coordinates (x: right, y: forward, z: up):
      const threatX = t.rel_y;
      const threatY = t.rel_x;
      const threatZ = t.rel_z || 0.2;

      this.threats.upsertThreat({
        id: t.id,
        label: t.type || 'Vehicle',
        x: threatX,
        y: threatY,
        z: threatZ,
        active: true
      });
    });

    if (payload.ego && payload.ego.gaze_zone) {
      if (payload.ego.gaze_zone !== 'CENTER') {
        this.simulateGazeCheck(payload.ego.gaze_zone);
      }
    }

    const primary = this.threats.getPrimaryThreat();
    if (primary) {
      this.audio.updateThreatSpatialPosition(primary);
      this.updateTelemetry(primary);
    }
  }

  mainLoop(timestamp) {
    const dt = Math.min(0.1, (timestamp - this.lastFrameTime) / 1000);
    this.lastFrameTime = timestamp;

    // 1. Update simulation physics if in standalone mode
    if (!this.isCarlaConnected && !this.evaluator.isRunning) {
      this.threats.tick(dt);
    }

    const primary = this.threats.getPrimaryThreat();
    if (primary) {
      this.audio.updateThreatSpatialPosition(primary);
      this.updateTelemetry(primary);

      // Periodically trigger visual sound ripple on radar matching audio pulse
      if (performance.now() - this.radar.lastRippleTime > 400 && !this.audio.gazeCancelled) {
        this.radar.emitSoundRipple(primary);
        this.radar.lastRippleTime = performance.now();
      }
    }

    // 2. Render 60 FPS Radar
    this.radar.render(timestamp);

    requestAnimationFrame((t) => this.mainLoop(t));
  }
}

// Bootstrap on DOM loaded
window.addEventListener('DOMContentLoaded', () => {
  window.app = new ADASCockpitApp();
});
