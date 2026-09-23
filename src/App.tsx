import React, { useState, useEffect, useMemo } from 'react';
import { HeaderHUD } from './components/HeaderHUD';
import { CockpitHUD } from './components/CockpitHUD';
import { RadarCanvas } from './components/RadarCanvas';
import { AudioControlPanel } from './components/AudioControlPanel';
import { ScenarioPanel } from './components/ScenarioPanel';
import { TelemetryPanel } from './components/TelemetryPanel';
import { EvaluationModal } from './components/evaluation/EvaluationModal';

import { SpatialAudioEngine } from './audio/SpatialAudioEngine';
import { CVBridgeService } from './services/CVBridgeService';
import { CarlaBridgeService } from './services/CarlaBridgeService';

import { ThreatObstacle, ScenarioType, ProxyTarget } from './types/threats';
import { GazeZone, HeadPose, InputMode } from './types/gaze';
import { PanningModel, SoundType } from './types/audio';
import { getScenarioThreats, createThreat } from './utils/threatScenarios';

export const App: React.FC = () => {
  // Services (singletons stored in refs)
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
  const [isCvConnected, setIsCvConnected] = useState(false);
  const [isCarlaConnected, setIsCarlaConnected] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [panningModel, setPanningModel] = useState<PanningModel>('HRTF');
  const [soundType, setSoundType] = useState<SoundType>('chime');
  const [isStudyModalOpen, setIsStudyModalOpen] = useState(false);

  // Primary threat is first threat in list
  const primaryThreat = threats[0] || null;

  // Initialize CV & CARLA Bridges and Audio
  useEffect(() => {
    cvBridge.start();
    carlaBridge.start();

    const unsubscribeCv = cvBridge.subscribe((msg, mode) => {
      setCurrentGaze(msg.gaze_zone);
      setDwellTimeMs(msg.dwell_time_ms);
      setHeadPose(msg.head_pose);
      setInputMode(mode);
      setIsCvConnected(cvBridge.getIsConnected());

      // Update audio engine listener orientation
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
      unsubscribeCv();
      unsubscribeCarla();
      cvBridge.cleanup();
      carlaBridge.cleanup();
      audioEngine.cleanup();
    };
  }, [cvBridge, carlaBridge, audioEngine]);

  // Update audio engine when primary threat changes
  useEffect(() => {
    audioEngine.setThreat(primaryThreat);
  }, [primaryThreat, audioEngine]);

  // Global Keyboard Shortcuts for simulation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input field or modal
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
        return;
      }

      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        e.preventDefault();
        cvBridge.simulateGaze('LEFT_MIRROR');
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        e.preventDefault();
        cvBridge.simulateGaze('RIGHT_MIRROR');
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        e.preventDefault();
        cvBridge.simulateGaze('REAR_MIRROR');
      } else if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        e.preventDefault();
        cvBridge.simulateGaze('CENTER');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cvBridge]);

  // Continuous physics animation loop for moving scenarios (e.g. orbit, overtake)
  useEffect(() => {
    if (currentScenario === 'MANUAL') return;

    let animId: number;
    let lastTime = performance.now();
    let orbitAngle = -Math.PI / 2;

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      setThreats((prev) => {
        if (!prev.length) return prev;
        const copy = [...prev];
        const primary = { ...copy[0] };

        if (currentScenario === 'BLIND_SPOT_LEFT') {
          // Overtaking car moving forward from behind
          primary.y += 3.4 * dt;
          if (primary.y > 6.0) primary.y = -14.0;
        } else if (currentScenario === 'REAR_TAILGATER') {
          // Rapidly closing in from rear
          primary.y += 5.5 * dt;
          if (primary.y > -4.0) primary.y = -26.0;
        } else if (currentScenario === 'FRONT_CUT_IN') {
          // Decelerating lead vehicle coming closer
          primary.y -= 3.0 * dt;
          if (primary.y < 5.0) primary.y = 24.0;
        } else if (currentScenario === 'ORBIT_360') {
          orbitAngle += 0.8 * dt;
          primary.x = Math.sin(orbitAngle) * 12.0;
          primary.y = Math.cos(orbitAngle) * 12.0;
        }

        // Recalculate azimuth and distance
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
  }, [currentScenario]);

  // Handler for user moving threat on radar
  const handleThreatMoved = (updatedThreat: ThreatObstacle) => {
    setCurrentScenario('MANUAL');
    setThreats([updatedThreat]);
  };

  // Scenario change handler
  const handleSelectScenario = (sc: ScenarioType) => {
    setCurrentScenario(sc);
    setThreats(getScenarioThreats(sc));
  };

  // Audio Toggle
  const handleToggleAudio = async () => {
    const success = await audioEngine.init();
    if (success) {
      setIsAudioActive(audioEngine.getIsActive());
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
    if (!isAudioActive) {
      audioEngine.init().then(() => {
        setIsAudioActive(true);
        audioEngine.testDirection(target);
      });
    } else {
      audioEngine.testDirection(target);
    }
  };

  const isSilenced = audioEngine.getIsCancelled();

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
      />

      {/* 3-Column Cockpit Workspace */}
      <main className="cockpit-main">
        {/* Column 1: Audio Engine & Traffic Scenarios */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AudioControlPanel
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

        {/* Column 2: Center Cockpit Stage (Cabin Mirrors + Radar) */}
        <section className="radar-stage">
          <CockpitHUD
            currentGaze={currentGaze}
            activeTarget={primaryThreat ? primaryThreat.proxyTarget : null}
            isSilenced={isSilenced}
            onSelectGaze={(zone) => cvBridge.simulateGaze(zone)}
          />

          <RadarCanvas
            threats={threats}
            onThreatMoved={handleThreatMoved}
          />
        </section>

        {/* Column 3: Telemetry, Gaze, and HCI Suite */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TelemetryPanel
            primaryThreat={primaryThreat}
            currentGaze={currentGaze}
            dwellTimeMs={dwellTimeMs}
            headPose={headPose}
            inputMode={inputMode}
            isCvConnected={isCvConnected}
            onSimulateGaze={(zone) => cvBridge.simulateGaze(zone)}
          />
        </aside>
      </main>

      {/* HCI Evaluation Suite Modal */}
      <EvaluationModal
        isOpen={isStudyModalOpen}
        onClose={() => setIsStudyModalOpen(false)}
        audioEngine={audioEngine}
      />
    </div>
  );
};
