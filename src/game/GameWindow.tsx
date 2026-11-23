import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
  GameEngine,
  GameEngineOptions,
  MirrorSide,
  CameraMode,
  TrafficEvent,
  CollisionEvent,
  HUDStats
} from './GameEngine';
import { ScenarioType } from '../types/threats';
import { GazeZone } from '../types/gaze';
import {
  Maximize2,
  Minimize2,
  AlertTriangle,
  CheckCircle2,
  Check,
  ShieldCheck,
  Flame,
  Camera,
  Activity,
  Zap,
  Navigation,
  RotateCcw,
  Eye
} from 'lucide-react';

export type { TrafficEvent, CollisionEvent, HUDStats, CameraMode };

export interface GameWindowHandle {
  start: () => void;
  pause: () => void;
  reset: () => void;
  toggleCameraMode: () => CameraMode;
  toggleAutoPilot: () => boolean;
  setStudyAutopilotMode: (enabled: boolean, suppressVisualAlerts?: boolean) => void;
  spawnStudyHazardCar: (target: import('../types/threats').ProxyTarget, seedIndex?: number) => void;
  clearStudyHazards: (acknowledgeOnly?: boolean) => void;
  triggerScenario: (scenario: ScenarioType) => void;
  notifyMirrorCheck: (side: MirrorSide) => void;
  updateDriverHeadPose: (yawDeg: number, pitchDeg: number) => void;
  getMirrorRegions: () => Record<MirrorSide, { x: number; y: number; width: number; height: number }>;
}

export interface GameWindowProps extends GameEngineOptions {
  className?: string;
  style?: React.CSSProperties;
  driverGaze?: GazeZone;
  isSilenced?: boolean;
  isFullscreenMode?: boolean;
  hideStudySpoilers?: boolean;
  onToggleFullscreen?: () => void;
  onSelectGaze?: (zone: GazeZone) => void;
}

export const GameWindow = forwardRef<GameWindowHandle, GameWindowProps>(
  (
    {
      onTrafficEvent,
      onCollisionEvent,
      onHUDUpdate,
      onThreatsUpdate,
      className,
      style,
      driverGaze = 'CENTER',
      isSilenced = false,
      isFullscreenMode = false,
      hideStudySpoilers = false,
      onToggleFullscreen,
      onSelectGaze
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<GameEngine | null>(null);

    const [hud, setHud] = useState<HUDStats>({
      speedKmh: 100,
      rpm: 2700,
      score: 0,
      streak: 0,
      distanceM: 0,
      gear: 'D5',
      activeAlert: null,
      activeFrontWarning: false,
      lastReactionMs: null,
      collisionWarning: false,
      damage: 0,
      cameraMode: 'cockpit',
      autoPilot: false,
      currentLane: 2,
      threatDistanceM: null,
      threatClosingKmh: null
    });

    const [clearedNotice, setClearedNotice] = useState<string | null>(null);
    const [collisionNotice, setCollisionNotice] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      start: () => engineRef.current?.start(),
      pause: () => engineRef.current?.pause(),
      reset: () => {
        engineRef.current?.reset();
        setClearedNotice(null);
        setCollisionNotice(null);
      },
      toggleCameraMode: () => {
        if (engineRef.current) {
          const mode = engineRef.current.toggleCameraMode();
          setHud((prev) => ({ ...prev, cameraMode: mode }));
          return mode;
        }
        return 'cockpit';
      },
      toggleAutoPilot: () => {
        if (engineRef.current) {
          const ap = engineRef.current.toggleAutoPilot();
          setHud((prev) => ({ ...prev, autoPilot: ap }));
          return ap;
        }
        return false;
      },
      setStudyAutopilotMode: (enabled: boolean, suppressVisualAlerts = false) => {
        engineRef.current?.setStudyAutopilotMode(enabled, suppressVisualAlerts);
        setHud((prev) => ({ ...prev, autoPilot: enabled }));
      },
      spawnStudyHazardCar: (target, seedIndex) => {
        engineRef.current?.spawnStudyHazardCar(target, seedIndex);
      },
      clearStudyHazards: (acknowledgeOnly) => {
        engineRef.current?.clearStudyHazards(acknowledgeOnly);
      },
      triggerScenario: (scenario: ScenarioType) => {
        engineRef.current?.triggerScenario(scenario);
      },
      notifyMirrorCheck: (side: MirrorSide) => {
        engineRef.current?.notifyMirrorCheck(side);
      },
      updateDriverHeadPose: (yaw: number, pitch: number) => {
        engineRef.current?.updateDriverHeadPose(yaw, pitch);
      },
      getMirrorRegions: () => {
        if (engineRef.current) {
          return engineRef.current.getMirrorRegions();
        }
        return {
          left: { x: 0.016, y: 0.67, width: 0.21, height: 0.18 },
          right: { x: 0.774, y: 0.67, width: 0.21, height: 0.18 },
          rear: { x: 0.34, y: 0.135, width: 0.32, height: 0.13 }
        };
      }
    }));

    // Stable reference for callbacks to prevent remounting GameEngine
    const callbacksRef = useRef({ onTrafficEvent, onCollisionEvent, onHUDUpdate, onThreatsUpdate });
    useEffect(() => {
      callbacksRef.current = { onTrafficEvent, onCollisionEvent, onHUDUpdate, onThreatsUpdate };
    });

    const lastReactionShownRef = useRef<number | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      const engine = new GameEngine({
        onTrafficEvent: (e) => {
          callbacksRef.current.onTrafficEvent?.(e);
        },
        onCollisionEvent: (c) => {
          setCollisionNotice(`Collision Impact (${c.relativeSpeedKmh} km/h Δv)`);
          callbacksRef.current.onCollisionEvent?.(c);
        },
        onThreatsUpdate: (threats) => {
          callbacksRef.current.onThreatsUpdate?.(threats);
        },
        onHUDUpdate: (stats) => {
          setHud(stats);
          callbacksRef.current.onHUDUpdate?.(stats);

          if (
            stats.lastReactionMs &&
            stats.lastReactionMs > 0 &&
            !stats.activeAlert &&
            stats.lastReactionMs !== lastReactionShownRef.current
          ) {
            lastReactionShownRef.current = stats.lastReactionMs;
            setClearedNotice(`Closed-loop gaze verified in ${stats.lastReactionMs} ms`);
          }
        }
      });

      engine.mount(containerRef.current);
      engine.start();
      engineRef.current = engine;

      // Observe container size changes (e.g., Split View, Fullscreen toggle)
      const resizeObserver = new ResizeObserver(() => {
        engine.handleResize();
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        engine.pause();
        engine.unmount();
        engineRef.current = null;
      };
    }, []);

    // Clear notices after timeouts
    useEffect(() => {
      if (!clearedNotice) return;
      const t = setTimeout(() => setClearedNotice(null), 2800);
      return () => clearTimeout(t);
    }, [clearedNotice]);

    useEffect(() => {
      if (!collisionNotice) return;
      const t = setTimeout(() => setCollisionNotice(null), 2400);
      return () => clearTimeout(t);
    }, [collisionNotice]);

    const handleCameraToggle = () => {
      if (engineRef.current) {
        const mode = engineRef.current.toggleCameraMode();
        setHud((prev) => ({ ...prev, cameraMode: mode }));
      }
    };

    const handleAutoPilotToggle = () => {
      if (engineRef.current) {
        const ap = engineRef.current.toggleAutoPilot();
        setHud((prev) => ({ ...prev, autoPilot: ap }));
      }
    };

    const handleMirrorClick = (side: MirrorSide, zone: GazeZone) => {
      engineRef.current?.notifyMirrorCheck(side);
      onSelectGaze?.(zone);
    };

    const renderMirrorBezel = (
      side: MirrorSide,
      zone: GazeZone,
      label: string,
      keyHint: string,
      rect: { x: number; y: number; width: number; height: number },
      isRear = false
    ) => {
      // Suppress directional visual alerts during empirical study mode so participants
      // rely purely on 3D audio + visual mirror inspection (no flashing spoiler cues).
      const isAlert = !hideStudySpoilers && hud.activeAlert === side;
      const isFocused = driverGaze === zone;

      const borderColor = isFocused
        ? '#34d399'
        : isAlert
          ? '#f87171'
          : 'rgba(255, 255, 255, 0.16)';

      const boxShadow = isFocused
        ? '0 0 0 1px rgba(52, 211, 153, 0.45), inset 0 0 0 1px rgba(52, 211, 153, 0.25)'
        : isAlert
          ? '0 0 0 1px rgba(248, 113, 113, 0.55), inset 0 0 12px rgba(248, 113, 113, 0.22)'
          : 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)';

      return (
        <div
          key={side}
          onClick={() => handleMirrorClick(side, zone)}
          title={`Click or press Key ${keyHint} to look at ${label}`}
          style={{
            position: 'absolute',
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
            borderRadius: isRear ? '10px 10px 14px 14px' : side === 'left' ? '12px 8px 8px 12px' : '8px 12px 12px 8px',
            border: `1.5px solid ${borderColor}`,
            boxShadow,
            cursor: 'pointer',
            zIndex: 6,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '5px 8px',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            background: 'linear-gradient(180deg, rgba(9,9,11,0.34) 0%, transparent 28%, transparent 74%, rgba(9,9,11,0.62) 100%)'
          }}
        >
          {/* Top Mirror Bezel Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '9px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                color: isFocused ? '#34d399' : isAlert ? '#fca5a5' : '#e4e4e7',
                background: 'rgba(9, 9, 11, 0.82)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)'
              }}
            >
              {label} [{keyHint}]
            </span>

            {!hideStudySpoilers && (
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  color: isFocused ? '#34d399' : isAlert ? '#f87171' : 'rgba(255,255,255,0.35)',
                  background: 'rgba(9, 9, 11, 0.82)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                BSM
              </span>
            )}
          </div>

          {/* Bottom Mirror Status Pill */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '9px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: isFocused ? '#34d399' : isAlert ? '#fafafa' : '#a1a1aa',
                background: isAlert
                  ? 'rgba(248, 113, 113, 0.88)'
                  : isFocused
                    ? 'rgba(9, 9, 11, 0.88)'
                    : 'rgba(9, 9, 11, 0.78)',
                border: `1px solid ${isFocused ? 'rgba(52, 211, 153, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
                padding: '1px 6px',
                borderRadius: '4px'
              }}
            >
              {isFocused && (isAlert || isSilenced) ? (
                <>
                  <Check size={10} /> GAZE VERIFIED
                </>
              ) : isAlert ? (
                <>
                  <AlertTriangle size={10} /> BLIND SPOT HAZARD
                </>
              ) : isFocused ? (
                <>
                  <Eye size={10} /> GAZE ACTIVE
                </>
              ) : (
                'CLEAR'
              )}
            </span>

            {!hideStudySpoilers && isAlert && hud.threatDistanceM !== null && (
              <span
                style={{
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  color: '#fbbf24',
                  background: 'rgba(9, 9, 11, 0.88)',
                  border: '1px solid rgba(251, 191, 36, 0.25)',
                  padding: '1px 5px',
                  borderRadius: '4px'
                }}
              >
                {hud.threatDistanceM.toFixed(1)}m
              </span>
            )}
          </div>
        </div>
      );
    };

    const mirrorRects = {
      left: { x: 0.016, y: 0.67, width: 0.21, height: 0.18 },
      right: { x: 0.774, y: 0.67, width: 0.21, height: 0.18 },
      rear: { x: 0.34, y: 0.135, width: 0.32, height: 0.13 }
    };

    return (
      <div
        className={className}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          background: '#060a14',
          boxShadow: hud.collisionWarning
            ? 'inset 0 0 65px rgba(239, 68, 68, 0.9), inset 0 0 25px rgba(239, 68, 68, 0.6)'
            : 'none',
          transition: 'box-shadow 0.15s ease',
          ...style
        }}
      >
        {/* Three.js Canvas Container */}
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, overflow: 'hidden' }} />

        {/* Interactive Sculpted Automotive Mirror Frames matching WebGL Scissor Viewports */}
        {renderMirrorBezel('rear', 'REAR_MIRROR', 'REAR-VIEW MIRROR', '4', mirrorRects.rear, true)}
        {renderMirrorBezel('left', 'LEFT_MIRROR', 'LEFT MIRROR', '1', mirrorRects.left)}
        {renderMirrorBezel('right', 'RIGHT_MIRROR', 'RIGHT MIRROR', '3', mirrorRects.right)}

        {/* Red Collision Vignette Flash Overlay */}
        {hud.collisionWarning && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: 'radial-gradient(ellipse at center, transparent 45%, rgba(239, 68, 68, 0.45) 100%)',
              zIndex: 8
            }}
          />
        )}

        {/* Top Telemetry & Controls HUD Bar (Hidden during Empirical Study runs so StudyOrchestrator top bar sits cleanly above Rear-View Mirror) */}
        {!hideStudySpoilers && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            pointerEvents: 'none',
            zIndex: 12,
            background: 'linear-gradient(180deg, rgba(9, 9, 11, 0.82) 0%, rgba(9, 9, 11, 0) 100%)'
          }}
        >
          {/* Left: Speedometer, RPM, Gear & Lane */}
          <div
            style={{
              background: 'rgba(17, 17, 20, 0.90)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.10)',
              borderRadius: '8px',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
              <span
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  color: hud.speedKmh > 130 ? '#f87171' : hud.speedKmh > 110 ? '#fbbf24' : '#fafafa',
                  lineHeight: 1
                }}
              >
                {hud.speedKmh}
              </span>
              <span style={{ fontSize: '10px', color: '#a1a1aa', fontWeight: 600 }}>KM/H</span>
            </div>

            <div style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,0.08)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.28)',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: '#38bdf8',
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  {hud.gear}
                </span>
                <span style={{ fontSize: '10px', color: '#a1a1aa', fontFamily: 'var(--font-mono)' }}>
                  LANE {hud.currentLane}/4
                </span>
              </div>
              <div
                style={{
                  width: '72px',
                  height: '3px',
                  background: 'rgba(255,255,255,0.10)',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (hud.rpm / 7500) * 100)}%`,
                    height: '100%',
                    background: hud.rpm > 6500 ? '#f87171' : hud.rpm > 4800 ? '#fbbf24' : '#34d399',
                    transition: 'width 0.1s linear'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Center Gaze Focus Pill */}
          <div
            style={{
              background: 'rgba(17, 17, 20, 0.90)',
              backdropFilter: 'blur(10px)',
              border: `1px solid ${driverGaze !== 'CENTER' ? 'rgba(52, 211, 153, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
              borderRadius: '9999px',
              padding: '5px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              color: driverGaze !== 'CENTER' ? '#34d399' : '#fafafa'
            }}
          >
            <Eye size={13} color={driverGaze !== 'CENTER' ? '#34d399' : '#38bdf8'} />
            <span>GAZE: {driverGaze}</span>
            {isSilenced && (
              <span
                style={{
                  background: 'rgba(52, 211, 153, 0.14)',
                  color: '#34d399',
                  padding: '1px 6px',
                  borderRadius: '9999px',
                  fontSize: '10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
              >
                <Check size={10} /> SILENCED
              </span>
            )}
          </div>

          {/* Right: Score, AutoPilot, Camera Mode, Reset & Fullscreen */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', pointerEvents: 'auto' }}>
            <div
              style={{
                background: 'rgba(17, 17, 20, 0.90)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '5px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <ShieldCheck size={13} color="#34d399" />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#fafafa', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  {hud.score}
                </span>
              </div>

              {hud.streak > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Flame size={13} color="#fbbf24" />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#fbbf24', fontFamily: 'var(--font-mono)' }}>x{hud.streak}</span>
                </div>
              )}

              {hud.damage > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Activity size={13} color={hud.damage > 50 ? '#f87171' : '#fbbf24'} />
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      color: hud.damage > 50 ? '#f87171' : '#fbbf24'
                    }}
                  >
                    {hud.damage}%
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleAutoPilotToggle}
              className="btn"
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                background: hud.autoPilot ? 'rgba(52, 211, 153, 0.14)' : 'rgba(17, 17, 20, 0.90)',
                border: `1px solid ${hud.autoPilot ? 'rgba(52, 211, 153, 0.35)' : 'rgba(255, 255, 255, 0.10)'}`,
                color: hud.autoPilot ? '#34d399' : '#a1a1aa',
                fontSize: '11px',
                fontWeight: 500
              }}
              title="Toggle ADAS Lane-Keep Assist Auto-Steer (Spacebar)"
            >
              <Navigation size={13} />
              <span>{hud.autoPilot ? 'LKA: ON' : 'LKA: OFF'}</span>
            </button>

            <button
              onClick={handleCameraToggle}
              className="btn"
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'rgba(17, 17, 20, 0.90)',
                border: '1px solid rgba(255, 255, 255, 0.10)',
                color: '#fafafa',
                fontSize: '11px',
                fontWeight: 500
              }}
              title="Cycle Camera View: Cockpit / Chase / Hood (Key C)"
            >
              <Camera size={13} color="#38bdf8" />
              <span>
                {hud.cameraMode === 'cockpit'
                  ? 'Cockpit'
                  : hud.cameraMode === 'chase'
                    ? 'Chase'
                    : 'Hood'}
              </span>
            </button>

            <button
              onClick={() => engineRef.current?.reset()}
              className="btn"
              style={{
                padding: '6px 8px',
                borderRadius: '6px',
                background: 'rgba(17, 17, 20, 0.90)',
                border: '1px solid rgba(255, 255, 255, 0.10)',
                color: '#a1a1aa'
              }}
              title="Reset Highway Traffic & Score"
            >
              <RotateCcw size={13} />
            </button>

            {onToggleFullscreen && (
              <button
                onClick={onToggleFullscreen}
                className="btn"
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  background: 'rgba(17, 17, 20, 0.90)',
                  border: '1px solid rgba(255, 255, 255, 0.10)',
                  color: '#fafafa'
                }}
                title={isFullscreenMode ? 'Exit Fullscreen (Esc)' : 'Expand Fullscreen Driving Mode'}
              >
                {isFullscreenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            )}
          </div>
        </div>
        )}

        {/* Center AR-HUD Alert / Reaction Banner (Hidden during blind empirical study blocks to avoid directional spoilers) */}
        {!hideStudySpoilers && (
          <div
            style={{
              position: 'absolute',
              top: '28%',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: 'none',
              zIndex: 11
            }}
          >
            {hud.activeAlert ? (
              <div
                style={{
                  background: 'rgba(17, 17, 20, 0.94)',
                  border: '1px solid rgba(248, 113, 113, 0.45)',
                  backdropFilter: 'blur(8px)',
                  color: '#fafafa',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  whiteSpace: 'nowrap'
                }}
              >
                <AlertTriangle size={14} color="#f87171" />
                <span>
                  {hud.activeAlert === 'left' && 'Left Blind Spot Hazard — Look Left (Key 1 or Click Mirror)'}
                  {hud.activeAlert === 'right' && 'Right Blind Spot Hazard — Look Right (Key 3 or Click Mirror)'}
                  {hud.activeAlert === 'rear' && 'Fast Tailgater Behind — Check Rear Mirror (Key 4 or Click)'}
                </span>
              </div>
            ) : collisionNotice ? (
              <div
                style={{
                  background: 'rgba(17, 17, 20, 0.94)',
                  border: '1px solid rgba(248, 113, 113, 0.45)',
                  color: '#fafafa',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px'
                }}
              >
                <Zap size={14} color="#fbbf24" />
                <span>{collisionNotice}</span>
              </div>
            ) : clearedNotice ? (
              <div
                style={{
                  background: 'rgba(17, 17, 20, 0.94)',
                  border: '1px solid rgba(52, 211, 153, 0.4)',
                  color: '#fafafa',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px'
                }}
              >
                <CheckCircle2 size={14} color="#34d399" />
                <span>{clearedNotice}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Bottom Driving & Gaze Controls Bar (Hidden in Empirical Study Mode) */}
        {!hideStudySpoilers && (
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(17, 17, 20, 0.90)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '9999px',
              padding: '5px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: '#a1a1aa',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 10
            }}
          >
            <span>
              <strong style={{ color: '#fafafa' }}>W/A/S/D</strong> Drive
            </span>
            <span style={{ opacity: 0.35 }}>|</span>
            <span>
              <strong style={{ color: '#38bdf8' }}>Space</strong> LKA
            </span>
            <span style={{ opacity: 0.35 }}>|</span>
            <span>
              <strong style={{ color: '#38bdf8' }}>C</strong> {hud.cameraMode.toUpperCase()}
            </span>
            <span style={{ opacity: 0.35 }}>|</span>
            <span style={{ color: '#34d399' }}>
              <strong>1/2/3/4</strong> or <strong>Click Mirror</strong> Gaze Sim
            </span>
          </div>
        )}
      </div>
    );
  }
);
