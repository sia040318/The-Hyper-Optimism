import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { HeaderHUD } from './components/HeaderHUD';
import { CockpitHUD } from './components/CockpitHUD';
import { RadarCanvas } from './components/RadarCanvas';
import { AudioControlPanel } from './components/AudioControlPanel';
import { ScenarioPanel } from './components/ScenarioPanel';
import { TelemetryPanel } from './components/TelemetryPanel';
import { DriverCameraPIP } from './components/DriverCameraPIP';
import { StudyOrchestrator, StudyVisualMode } from './components/evaluation/StudyOrchestrator';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { Button } from '@/components/ui/button';

import { SpatialAudioEngine } from './audio/SpatialAudioEngine';
import { CVBridgeService } from './services/CVBridgeService';
import { CarlaBridgeService } from './services/CarlaBridgeService';
import { inBrowserVision } from './services/InBrowserVisionService';
import { GameWindow, GameWindowHandle, TrafficEvent, HUDStats } from './game';

import { ThreatObstacle, ScenarioType, ProxyTarget } from './types/threats';
import { GazeZone, HeadPose, InputMode } from './types/gaze';
import { PanningModel, SoundType } from './types/audio';
import { getScenarioThreats, createThreat } from './utils/threatScenarios';
import { Car, Columns2, Radar, Volume2, VolumeX } from 'lucide-react';

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

  // Empirical Study Orchestrator & Hidden Admin Portal Routing
  const initialQuery = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const studyParam = params.get('study');
    const pidParam = params.get('pid');
    const adminParam = params.get('admin');
    return {
      openStudy: Boolean(studyParam),
      passcode: studyParam || undefined,
      pid: pidParam || undefined,
      openAdmin: adminParam === '1' || adminParam === 'true'
    };
  }, []);

  const [isOrchestratorOpen, setIsOrchestratorOpen] = useState(initialQuery.openStudy);
  const [isAdminOpen, setIsAdminOpen] = useState(initialQuery.openAdmin);
  const [studyVisualMode, setStudyVisualMode] = useState<StudyVisualMode>('OFF');
  const [stageView, setStageView] = useState<'3D_GAME' | '2D_RADAR' | 'SPLIT'>('3D_GAME');
  const [isGameFullscreen, setIsGameFullscreen] = useState(false);
  const gameWindowRef = useRef<GameWindowHandle>(null);

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

  useEffect(() => {
    if (isOrchestratorOpen) return;
    audioEngine.setThreat(primaryThreat);
  }, [primaryThreat, audioEngine, isOrchestratorOpen]);

  const handleTrafficEvent = useCallback(
    (event: TrafficEvent) => {
      if (isOrchestratorOpen) return;
      let target: ProxyTarget = 'FRONT_WINDSHIELD';
      if (event.side === 'left') target = 'LEFT_MIRROR';
      else if (event.side === 'right') target = 'RIGHT_MIRROR';
      else if (event.side === 'rear') target = 'REAR_MIRROR';

      if (isAudioActive) {
        audioEngine.testDirection(target);
      }
    },
    [isAudioActive, audioEngine, isOrchestratorOpen]
  );

  const handleGameThreatsUpdate = useCallback(
    (gameThreats: ThreatObstacle[]) => {
      if (isOrchestratorOpen) return;
      if (stageView === '3D_GAME' || stageView === 'SPLIT' || isGameFullscreen) {
        setThreats(gameThreats);
      }
    },
    [stageView, isGameFullscreen, isOrchestratorOpen]
  );

  const handleHUDUpdate = useCallback(
    (stats: HUDStats) => {
      audioEngine.setAmbientSpeed(stats.speedKmh);
    },
    [audioEngine]
  );

  useEffect(() => {
    if (currentGaze === 'LEFT_MIRROR') {
      gameWindowRef.current?.notifyMirrorCheck('left');
    } else if (currentGaze === 'RIGHT_MIRROR') {
      gameWindowRef.current?.notifyMirrorCheck('right');
    } else if (currentGaze === 'REAR_MIRROR') {
      gameWindowRef.current?.notifyMirrorCheck('rear');
    }
  }, [currentGaze]);

  useEffect(() => {
    gameWindowRef.current?.updateDriverHeadPose(headPose.yaw, headPose.pitch);
  }, [headPose]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        setIsAdminOpen((prev) => !prev);
        return;
      }

      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
        return;
      }

      if (e.key === 'Escape' && isGameFullscreen && !isOrchestratorOpen) {
        setIsGameFullscreen(false);
        return;
      }

      if (isOrchestratorOpen || isAdminOpen) return;

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
  }, [cvBridge, isGameFullscreen, isOrchestratorOpen, isAdminOpen]);

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

  const handleThreatMoved = (updatedThreat: ThreatObstacle) => {
    audioEngine.resetAcknowledgments();
    setCurrentScenario('MANUAL');
    setThreats([updatedThreat]);
  };

  const handleSelectScenario = (sc: ScenarioType) => {
    audioEngine.resetAcknowledgments();
    setCurrentScenario(sc);
    setThreats(getScenarioThreats(sc));
    gameWindowRef.current?.triggerScenario(sc);
  };

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
    (zone: GazeZone, force = false) => {
      if (!inBrowserVision.getIsRunning()) {
        cvBridge.simulateGaze(zone);
      } else if (force) {
        setCurrentGaze(zone);
        audioEngine.setGazeZone(zone);
      }
    },
    [cvBridge, audioEngine]
  );

  const isSilenced = audioEngine.getIsCancelled();
  const isStudyHighwayActive = isOrchestratorOpen && studyVisualMode !== 'OFF';
  const showGameView = stageView === '3D_GAME' || stageView === 'SPLIT' || isGameFullscreen || isStudyHighwayActive;

  return (
    <div className="app-container">
      <HeaderHUD
        isAudioActive={isAudioActive}
        onToggleAudio={handleToggleAudio}
        cvMode={inputMode}
        isCvConnected={isCvConnected}
        isCarlaConnected={isCarlaConnected}
        onOpenStudy={() => setIsOrchestratorOpen(true)}
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

          <div className="rounded-[10px] border border-border bg-card p-4">
            <ScenarioPanel
              currentScenario={currentScenario}
              onSelectScenario={handleSelectScenario}
            />
          </div>
        </aside>

        {/* Column 2: Center Cockpit Stage */}
        <section className="flex min-h-[420px] flex-col gap-2.5 overflow-hidden rounded-[10px] border border-border bg-card p-3">
          {/* Stage View Switcher Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-popover/60 px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#38bdf8]" />
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Virtual Cockpit Viewport
              </span>
            </div>

            <div className="inline-flex gap-1 rounded-md border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setStageView('3D_GAME')}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  stageView === '3D_GAME'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Car size={12} /> 3D Cockpit
              </button>
              <button
                type="button"
                onClick={() => setStageView('SPLIT')}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  stageView === 'SPLIT'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Columns2 size={12} /> Split
              </button>
              <button
                type="button"
                onClick={() => {
                  setStageView('2D_RADAR');
                  setThreats(getScenarioThreats(currentScenario));
                }}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  stageView === '2D_RADAR'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Radar size={12} /> 2D Radar
              </button>
            </div>
          </div>

          <CockpitHUD
            currentGaze={currentGaze}
            activeTarget={primaryThreat ? primaryThreat.proxyTarget : null}
            isSilenced={isSilenced}
            onSelectGaze={handleSimulateGaze}
          />

          {/* Single Persistent 3D Game Window */}
          <div
            className={
              isGameFullscreen || isStudyHighwayActive
                ? 'fixed inset-0 z-[9998] flex flex-col bg-background'
                : 'relative w-full overflow-hidden rounded-[10px] border border-border bg-background'
            }
            style={
              isGameFullscreen || isStudyHighwayActive
                ? undefined
                : {
                    display: showGameView ? 'flex' : 'none',
                    flex: stageView === 'SPLIT' ? 1.25 : 1,
                    minHeight: stageView === 'SPLIT' ? '220px' : '300px'
                  }
            }
          >
            {isGameFullscreen && !isStudyHighwayActive && (
              <div className="absolute bottom-11 left-1/2 z-[25] flex -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.10] bg-[#111114]/92 px-3 py-1.5 backdrop-blur-md">
                <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                  Scenario:
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleSelectScenario('BLIND_SPOT_LEFT')}
                >
                  Left Blind Spot
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleSelectScenario('BLIND_SPOT_RIGHT')}
                >
                  Right Blind Spot
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleSelectScenario('REAR_TAILGATER')}
                >
                  Rear Tailgater
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleSelectScenario('FRONT_CUT_IN')}
                >
                  Front Cut-In
                </Button>
                <div className="mx-1 h-4 w-px bg-white/[0.10]" />
                <Button
                  type="button"
                  variant={isAudioActive ? 'outline' : 'destructive'}
                  size="xs"
                  onClick={handleToggleAudio}
                  className={isAudioActive ? 'border-[#34d399]/40 text-[#34d399]' : ''}
                >
                  {isAudioActive ? <Volume2 size={12} /> : <VolumeX size={12} />}
                  {isAudioActive ? 'Audio On' : 'Enable Audio'}
                </Button>
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
              hideStudySpoilers={isStudyHighwayActive}
              onToggleFullscreen={() => setIsGameFullscreen((prev) => !prev)}
              onSelectGaze={(z) => handleSimulateGaze(z, isStudyHighwayActive)}
            />
          </div>

          {(stageView === '2D_RADAR' || stageView === 'SPLIT') && (
            <div className="flex min-h-[200px] w-full flex-1">
              <RadarCanvas
                threats={threats}
                currentGaze={currentGaze}
                isSilenced={isSilenced}
                onThreatMoved={handleThreatMoved}
              />
            </div>
          )}
        </section>

        {/* Column 3: Telemetry & Driver Vision */}
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

      {/* Empirical HCI Study Suite Orchestrator */}
      <StudyOrchestrator
        isOpen={isOrchestratorOpen}
        onClose={() => {
          setIsOrchestratorOpen(false);
          setStudyVisualMode('OFF');
        }}
        initialPasscode={initialQuery.passcode}
        initialParticipantId={initialQuery.pid}
        audioEngine={audioEngine}
        gameWindowRef={gameWindowRef}
        currentGaze={currentGaze}
        volume={volume}
        onVolumeChange={handleVolumeChange}
        onSimulateGaze={handleSimulateGaze}
        onAudioActiveChange={setIsAudioActive}
        onStudyVisualModeChange={setStudyVisualMode}
      />

      {/* Hidden Researcher Admin Portal (?admin=1 or Ctrl+Shift+A) */}
      <AdminDashboard
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
      />
    </div>
  );
};
