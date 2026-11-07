import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { HeaderHUD } from './components/HeaderHUD';
import { CockpitHUD } from './components/CockpitHUD';
import { RadarCanvas } from './components/RadarCanvas';
import { AudioControlPanel } from './components/AudioControlPanel';
import { ScenarioPanel } from './components/ScenarioPanel';
import { TelemetryPanel } from './components/TelemetryPanel';
import { DriverCameraPIP } from './components/DriverCameraPIP';
import { EvaluationModal } from './components/evaluation/EvaluationModal';

import { SpatialAudioEngine } from './audio/SpatialAudioEngine';
import { CVBridgeService } from './services/CVBridgeService';
import { CarlaBridgeService } from './services/CarlaBridgeService';
import { inBrowserVision } from './services/InBrowserVisionService';
import { GameWindow, GameWindowHandle, TrafficEvent, HUDStats } from './game';

import { ThreatObstacle, ScenarioType, ProxyTarget } from './types/threats';
import { GazeZone, HeadPose, InputMode } from './types/gaze';
import { PanningModel, SoundType } from './types/audio';
import { getScenarioThreats, createThreat } from './utils/threatScenarios';

export const App: React.FC = () => {
  // Services (singletons stored in useMemo)
  const audioEngine = useMemo(() => new SpatialAudioEngine(), []);
  const cvBridge = useMemo(() => new CVBridgeService('ws://127.0.0.1:8765/gaze'), []);
  const carlaBridge = useMemo(() => new CarlaBridgeService('ws://127.0.0.1:8765/carla'), []);

  // State
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [currentScenario, setCurrentScenario] = useState<ScenarioType>('BLIND_SPOT_LEFT');
  const [threats, setThreats] = useState<ThreatObstacle[]>(() => getScenarioThreats('BLIND_SPOT_LEFT'));
  const [currentGaze, setCurrentGaze] = useState<GazeZone>('CENTER');
  const [dwellTimeMs, setDwellTimeMs] = useState(0);
  const [headPose, setHeadPose] = useState<HeadPose>({ pitch: 0, yaw: 0, roll: 0 });
  const [inputMode, setInputMode] = useState<InputMode>('SIMULATION');
  const [irisRatio, setIrisRatio] = useState<number | null>(null);
  const [isCvConnected, setIsCvConnected] = useState(false);
  const [isCarlaConnected, setIsCarlaConnected] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [panningModel, setPanningModel] = useState<PanningModel>('HRTF');
  const [soundType, setSoundType] = useState<SoundType>('chime');
  const [isStudyModalOpen, setIsStudyModalOpen] = useState(false);
  const [stageView, setStageView] = useState<'3D_GAME' | '2D_RADAR' | 'SPLIT'>('3D_GAME');
  const [isGameFullscreen, setIsGameFullscreen] = useState(false);
  const gameWindowRef = useRef<GameWindowHandle>(null);

  // Primary threat is first threat in list
  const primaryThreat = threats[0] || null;

  // Initialize CV & CARLA Bridges and Audio
  useEffect(() => {
    cvBridge.start();
    carlaBridge.start();

    const unsubscribeInBrowser = inBrowserVision.subscribe((msg) => {
      setCurrentGaze(msg.gaze_zone);
      setDwellTimeMs(msg.dwell_time_ms);
      setHeadPose(msg.head_pose);
      setInputMode('IN_BROWSER_WEBCAM');
      setIrisRatio(msg.iris_ratio ?? null);

      audioEngine.updateHeadOrientation(msg.head_pose);
      audioEngine.setGazeZone(msg.gaze_zone);
    });

    const unsubscribeCv = cvBridge.subscribe((msg, mode) => {
      if (inBrowserVision.getIsRunning()) return;

      setCurrentGaze(msg.gaze_zone);
      setDwellTimeMs(msg.dwell_time_ms);
      setHeadPose(msg.head_pose);
      setInputMode(mode);
      setIsCvConnected(cvBridge.getIsConnected());
      setIrisRatio(msg.iris_ratio ?? null);

      audioEngine.updateHeadOrientation(msg.head_pose);
      audioEngine.setGazeZone(msg.gaze_zone);
    });

    const unsubscribeCarla = carlaBridge.subscribe((telemetry) => {
      setIsCarlaConnected(carlaBridge.getIsConnected());
      if (telemetry.threats && telemetry.threats.length > 0) {
        const carlaThreats = telemetry.threats.map((t, idx) =>
          createThreat(t.id, t.type, t.x, t.y, t.vx, t.vy, idx === 0)
        );
        setThreats(carlaThreats);
      }
    });

    return () => {
      unsubscribeInBrowser();
      unsubscribeCv();
      unsubscribeCarla();
      cvBridge.cleanup();
      carlaBridge.cleanup();
      inBrowserVision.stop();
      audioEngine.cleanup();
    };
  }, [cvBridge, carlaBridge, audioEngine]);

  const handleCameraActiveChange = (active: boolean) => {
    if (!active) {
      setInputMode(cvBridge.getMode());
      setIrisRatio(null);
    } else {
      setInputMode('IN_BROWSER_WEBCAM');
    }
  };

  // Update audio engine when primary threat changes
  useEffect(() => {
    audioEngine.setThreat(primaryThreat);
  }, [primaryThreat, audioEngine]);

  // Traffic Event Handler from Three.js Game Engine
  const handleTrafficEvent = useCallback(
    (event: TrafficEvent) => {
      let target: ProxyTarget = 'FRONT_WINDSHIELD';
      if (event.side === 'left') target = 'LEFT_MIRROR';
      else if (event.side === 'right') target = 'RIGHT_MIRROR';
      else if (event.side === 'rear') target = 'REAR_MIRROR';

      if (isAudioActive) {
        audioEngine.testDirection(target);
      }
    },
    [isAudioActive, audioEngine]
  );

  // Live Threats Stream from 3D GameEngine (keeps 2D Radar & 3D HRTF Audio synced with 3D Traffic!)
  const handleGameThreatsUpdate = useCallback(
    (gameThreats: ThreatObstacle[]) => {
      if (stageView === '3D_GAME' || stageView === 'SPLIT' || isGameFullscreen) {
        setThreats(gameThreats);
      }
    },
    [stageView, isGameFullscreen]
  );

  const handleHUDUpdate = useCallback(
    (stats: HUDStats) => {
      audioEngine.setAmbientSpeed(stats.speedKmh);
    },
    [audioEngine]
  );

  // Synchronize gaze with game window mirror check acknowledgment
  useEffect(() => {
    if (currentGaze === 'LEFT_MIRROR') {
      gameWindowRef.current?.notifyMirrorCheck('left');
    } else if (currentGaze === 'RIGHT_MIRROR') {
      gameWindowRef.current?.notifyMirrorCheck('right');
    } else if (currentGaze === 'REAR_MIRROR') {
      gameWindowRef.current?.notifyMirrorCheck('rear');
    }
  }, [currentGaze]);

  // Synchronize driver head pose with 3D cockpit camera
  useEffect(() => {
    gameWindowRef.current?.updateDriverHeadPose(headPose.yaw, headPose.pitch);
  }, [headPose]);

  // Global Keyboard Shortcuts (1, 2, 3, 4 for Gaze, C for Camera, Esc for Fullscreen exit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
        return;
      }

      if (e.key === 'Escape' && isGameFullscreen) {
        setIsGameFullscreen(false);
        return;
      }

      if (isStudyModalOpen) return;

      if (e.key === '1') {
        e.preventDefault();
        cvBridge.simulateGaze('LEFT_MIRROR');
      } else if (e.key === '3') {
        e.preventDefault();
        cvBridge.simulateGaze('RIGHT_MIRROR');
      } else if (e.key === '4') {
        e.preventDefault();
        cvBridge.simulateGaze('REAR_MIRROR');
      } else if (e.key === '2' || e.key === '0') {
        e.preventDefault();
        cvBridge.simulateGaze('CENTER');
      } else if (e.key === 'c' || e.key === 'C') {
        gameWindowRef.current?.toggleCameraMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cvBridge, isGameFullscreen, isStudyModalOpen]);

  // Continuous physics animation loop ONLY when in standalone 2D_RADAR mode
  useEffect(() => {
    if (stageView !== '2D_RADAR' || isGameFullscreen) return;
    if (currentScenario === 'MANUAL') return;

    let animId: number;
    let lastTime = performance.now();
    let orbitAngle = -Math.PI / 2;

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      setThreats((prev) => {
        if (!prev.length) return getScenarioThreats(currentScenario);
        const copy = [...prev];
        const primary = { ...copy[0] };

        if (currentScenario === 'BLIND_SPOT_LEFT') {
          primary.y += 3.4 * dt;
          if (primary.y > 6.0) primary.y = -14.0;
        } else if (currentScenario === 'REAR_TAILGATER') {
          primary.y += 5.5 * dt;
          if (primary.y > -4.0) primary.y = -26.0;
        } else if (currentScenario === 'FRONT_CUT_IN') {
          primary.y -= 3.0 * dt;
          if (primary.y < 5.0) primary.y = 24.0;
        } else if (currentScenario === 'ORBIT_360') {
          orbitAngle += 0.8 * dt;
          primary.x = Math.sin(orbitAngle) * 12.0;
          primary.y = Math.cos(orbitAngle) * 12.0;
        }

        const az = (Math.atan2(primary.x, primary.y) * 180) / Math.PI;
        const dist = Math.sqrt(primary.x * primary.x + primary.y * primary.y);
        let proxy: ProxyTarget = 'FRONT_WINDSHIELD';
        if (az <= -45 && az > -135) proxy = 'LEFT_MIRROR';
        else if (az >= 45 && az < 135) proxy = 'RIGHT_MIRROR';
        else if (Math.abs(az) >= 135) proxy = 'REAR_MIRROR';

        primary.azimuth = parseFloat(az.toFixed(1));
        primary.distance = parseFloat(dist.toFixed(1));
        primary.proxyTarget = proxy;

        copy[0] = primary;
        return copy;
      });

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [currentScenario, stageView, isGameFullscreen]);

  // Handler for user moving threat on radar
  const handleThreatMoved = (updatedThreat: ThreatObstacle) => {
    audioEngine.resetAcknowledgments();
    setCurrentScenario('MANUAL');
    setThreats([updatedThreat]);
  };

  // Scenario change handler (triggers in BOTH 3D Game and 2D Radar!)
  const handleSelectScenario = (sc: ScenarioType) => {
    audioEngine.resetAcknowledgments();
    setCurrentScenario(sc);
    setThreats(getScenarioThreats(sc));
    gameWindowRef.current?.triggerScenario(sc);
  };

  // Audio Toggle
  const handleToggleAudio = async () => {
    if (isAudioActive) {
      audioEngine.stop();
      setIsAudioActive(false);
    } else {
      const success = await audioEngine.start();
      if (success) {
        setIsAudioActive(true);
      }
    }
  };

  const handleVolumeChange = (vol: number) => {
    setVolume(vol);
    audioEngine.setMasterVolume(vol);
  };

  const handlePanningChange = (model: PanningModel) => {
    setPanningModel(model);
    audioEngine.setPanningModel(model);
  };

  const handleSoundTypeChange = (st: SoundType) => {
    setSoundType(st);
    audioEngine.setSoundType(st);
  };

  const handleTestDirection = (target: ProxyTarget) => {
    audioEngine.resetAcknowledgments();
    if (!isAudioActive) {
      audioEngine.start().then(() => {
        setIsAudioActive(true);
        audioEngine.testDirection(target);
      });
    } else {
      audioEngine.testDirection(target);
    }
  };

  const handleSimulateGaze = useCallback(
    (zone: GazeZone) => {
      if (!inBrowserVision.getIsRunning()) {
        cvBridge.simulateGaze(zone);
      }
    },
    [cvBridge]
  );

  const isSilenced = audioEngine.getIsCancelled();
  const showGameView = stageView === '3D_GAME' || stageView === 'SPLIT' || isGameFullscreen;

  return (
    <div className="app-container">
      {/* Top Header HUD */}
      <HeaderHUD
        isAudioActive={isAudioActive}
        onToggleAudio={handleToggleAudio}
        cvMode={inputMode}
        isCvConnected={isCvConnected}
        isCarlaConnected={isCarlaConnected}
        onOpenStudy={() => setIsStudyModalOpen(true)}
        onLaunchGame={() => setIsGameFullscreen(true)}
      />

      {/* 3-Column Cockpit Workspace */}
      <main className="cockpit-main">
        {/* Column 1: Audio Engine & Traffic Scenarios */}
        <aside className="side-column">
          <AudioControlPanel
            isAudioActive={isAudioActive}
            onToggleAudio={handleToggleAudio}
            volume={volume}
            onVolumeChange={handleVolumeChange}
            panningModel={panningModel}
            onPanningChange={handlePanningChange}
            soundType={soundType}
            onSoundTypeChange={handleSoundTypeChange}
            onTestDirection={handleTestDirection}
          />

          <div className="glass-panel">
            <ScenarioPanel
              currentScenario={currentScenario}
              onSelectScenario={handleSelectScenario}
            />
          </div>
        </aside>

        {/* Column 2: Center Cockpit Stage (Cabin Mirrors + 3D Game / 2D Radar) */}
        <section className="radar-stage">
          {/* Stage View Switcher Header */}
          <div className="stage-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#00f0ff',
                  boxShadow: '0 0 8px #00f0ff'
                }}
              />
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--text-main)',
                  letterSpacing: '0.06em'
                }}
              >
                VIRTUAL COCKPIT & SPATIAL PROXY VIEWPORT
              </span>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className={`btn ${stageView === '3D_GAME' ? 'btn-primary' : ''}`}
                onClick={() => setStageView('3D_GAME')}
                style={{ fontSize: '11px', padding: '5px 12px' }}
              >
                🎮 3D Highway Cockpit
              </button>
              <button
                className={`btn ${stageView === 'SPLIT' ? 'btn-primary' : ''}`}
                onClick={() => setStageView('SPLIT')}
                style={{ fontSize: '11px', padding: '5px 12px' }}
              >
                ⚡ Split 3D + Radar
              </button>
              <button
                className={`btn ${stageView === '2D_RADAR' ? 'btn-primary' : ''}`}
                onClick={() => {
                  setStageView('2D_RADAR');
                  setThreats(getScenarioThreats(currentScenario));
                }}
                style={{ fontSize: '11px', padding: '5px 12px' }}
              >
                📡 2D Tactical Radar
              </button>
            </div>
          </div>

          {/* Interactive Cabin Mirror Status Bar */}
          <CockpitHUD
            currentGaze={currentGaze}
            activeTarget={primaryThreat ? primaryThreat.proxyTarget : null}
            isSilenced={isSilenced}
            onSelectGaze={handleSimulateGaze}
          />

          {/* Single Persistent 3D Game Window (Expands seamlessly to Fullscreen when toggled!) */}
          <div
            style={
              isGameFullscreen
                ? {
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    background: '#060a14',
                    display: 'flex',
                    flexDirection: 'column'
                  }
                : {
                    display: showGameView ? 'flex' : 'none',
                    flex: stageView === 'SPLIT' ? 1.25 : 1,
                    minHeight: stageView === 'SPLIT' ? '220px' : '300px',
                    width: '100%',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    position: 'relative',
                    border: '1px solid rgba(0, 240, 255, 0.35)',
                    boxShadow: '0 6px 28px rgba(0, 0, 0, 0.65)'
                  }
            }
          >
            {/* Floating Quick-Scenario Bar when in Fullscreen Mode */}
            {isGameFullscreen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '44px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 25,
                  background: 'rgba(9, 13, 22, 0.88)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(0, 240, 255, 0.3)',
                  borderRadius: '20px',
                  padding: '5px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.75)'
                }}
              >
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)' }}>
                  INJECT SCENARIO:
                </span>
                <button
                  className="btn"
                  style={{ fontSize: '10px', padding: '3px 8px' }}
                  onClick={() => handleSelectScenario('BLIND_SPOT_LEFT')}
                >
                  Left Blind Spot
                </button>
                <button
                  className="btn"
                  style={{ fontSize: '10px', padding: '3px 8px' }}
                  onClick={() => handleSelectScenario('BLIND_SPOT_RIGHT')}
                >
                  Right Blind Spot
                </button>
                <button
                  className="btn"
                  style={{ fontSize: '10px', padding: '3px 8px' }}
                  onClick={() => handleSelectScenario('REAR_TAILGATER')}
                >
                  Rear Tailgater
                </button>
                <button
                  className="btn"
                  style={{ fontSize: '10px', padding: '3px 8px' }}
                  onClick={() => handleSelectScenario('FRONT_CUT_IN')}
                >
                  Front Cut-In
                </button>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)' }} />
                <button
                  className={`btn ${isAudioActive ? 'btn-primary' : 'btn-danger'}`}
                  style={{ fontSize: '10px', padding: '3px 10px' }}
                  onClick={handleToggleAudio}
                >
                  {isAudioActive ? '🔊 3D Audio ON' : '🔇 Enable 3D Audio'}
                </button>
              </div>
            )}

            <GameWindow
              ref={gameWindowRef}
              onTrafficEvent={handleTrafficEvent}
              onThreatsUpdate={handleGameThreatsUpdate}
              onHUDUpdate={handleHUDUpdate}
              driverGaze={currentGaze}
              isSilenced={isSilenced}
              isFullscreenMode={isGameFullscreen}
              onToggleFullscreen={() => setIsGameFullscreen((prev) => !prev)}
              onSelectGaze={handleSimulateGaze}
            />
          </div>

          {/* 2D Tactical Radar */}
          {(stageView === '2D_RADAR' || stageView === 'SPLIT') && (
            <div style={{ flex: 1, minHeight: '180px', display: 'flex', width: '100%' }}>
              <RadarCanvas
                threats={threats}
                currentGaze={currentGaze}
                isSilenced={isSilenced}
                onThreatMoved={handleThreatMoved}
              />
            </div>
          )}
        </section>

        {/* Column 3: Telemetry, Gaze, and In-Browser Vision */}
        <aside className="side-column">
          <DriverCameraPIP
            currentGaze={currentGaze}
            headPose={headPose}
            activeThreatTarget={primaryThreat ? primaryThreat.proxyTarget : null}
            isSilenced={isSilenced}
            onCameraActiveChange={handleCameraActiveChange}
          />

          <TelemetryPanel
            primaryThreat={primaryThreat}
            currentGaze={currentGaze}
            dwellTimeMs={dwellTimeMs}
            headPose={headPose}
            inputMode={inputMode}
            isCvConnected={isCvConnected}
            irisRatio={irisRatio}
            onSimulateGaze={handleSimulateGaze}
          />
        </aside>
      </main>

      {/* HCI Evaluation Suite Modal */}
      <EvaluationModal
        isOpen={isStudyModalOpen}
        onClose={() => setIsStudyModalOpen(false)}
        audioEngine={audioEngine}
        isAudioActive={isAudioActive}
        onAudioActiveChange={setIsAudioActive}
      />
    </div>
  );
};
