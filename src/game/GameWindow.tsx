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
          setCollisionNotice(`💥 COLLISION IMPACT (${c.relativeSpeedKmh} KM/H ΔV)`);
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
            setClearedNotice(`✓ CLOSED-LOOP GAZE VERIFIED IN ${stats.lastReactionMs}ms (+SCORE)`);
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
      const isAlert = hud.activeAlert === side;
      const isFocused = driverGaze === zone;

      const borderColor = isFocused
        ? '#10b981'
        : isAlert
        ? '#ef4444'
        : 'rgba(148, 163, 184, 0.45)';

      const boxShadow = isFocused
        ? '0 0 22px rgba(16, 185, 129, 0.7), inset 0 0 12px rgba(16, 185, 129, 0.35)'
        : isAlert
        ? '0 0 26px rgba(239, 68, 68, 0.85), inset 0 0 16px rgba(239, 68, 68, 0.45)'
        : '0 8px 24px rgba(0, 0, 0, 0.75), inset 0 0 0 1px rgba(255, 255, 255, 0.12)';

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
            borderRadius: isRear ? '10px 10px 16px 16px' : side === 'left' ? '14px 8px 8px 14px' : '8px 14px 14px 8px',
            border: `2.5px solid ${borderColor}`,
            boxShadow,
            cursor: 'pointer',
            zIndex: 6,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '4px 8px',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            background: 'linear-gradient(180deg, rgba(15,23,42,0.28) 0%, transparent 30%, transparent 72%, rgba(9,13,22,0.55) 100%)'
          }}
        >
          {/* Top Mirror Bezel Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '9px',
                fontWeight: 800,
                letterSpacing: '0.06em',
                color: isFocused ? '#34d399' : isAlert ? '#fca5a5' : '#cbd5e1',
                background: 'rgba(9, 13, 22, 0.78)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)'
              }}
            >
              {label} [{keyHint}]
            </span>

            {/* BSM Triangle Indicator */}
            <span
              style={{
                fontSize: '10px',
                fontWeight: 800,
                color: isFocused ? '#10b981' : isAlert ? '#ef4444' : 'rgba(255,255,255,0.25)',
                background: 'rgba(9, 13, 22, 0.78)',
                padding: '1px 5px',
                borderRadius: '4px'
              }}
            >
              ▲ BSM
            </span>
          </div>

          {/* Bottom Mirror Status Pill */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '9px',
                fontWeight: 700,
                color: isFocused ? '#10b981' : isAlert ? '#ffffff' : '#94a3b8',
                background: isAlert
                  ? 'rgba(239, 68, 68, 0.88)'
                  : isFocused
                  ? 'rgba(6, 78, 59, 0.88)'
                  : 'rgba(9, 13, 22, 0.72)',
                padding: '1px 6px',
                borderRadius: '4px'
              }}
            >
              {isFocused && (isAlert || isSilenced)
                ? '✓ GAZE VERIFIED • MUTED'
                : isAlert
                ? '⚠ BLIND SPOT HAZARD'
                : isFocused
                ? '👁 DRIVER GAZE LOCKED'
                : 'CLEAR'}
            </span>

            {isAlert && hud.threatDistanceM !== null && (
              <span
                style={{
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 800,
                  color: '#fde047',
                  background: 'rgba(9, 13, 22, 0.85)',
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

        {/* Top Telemetry & Controls HUD Bar (Cleanly above Rear-View Mirror) */}
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
            background: 'linear-gradient(180deg, rgba(6, 10, 20, 0.85) 0%, rgba(6, 10, 20, 0) 100%)'
          }}
        >
          {/* Left: Speedometer, RPM, Gear & Lane */}
          <div
            style={{
              background: 'rgba(9, 13, 22, 0.86)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(0, 240, 255, 0.32)',
              borderRadius: '10px',
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
              <span
                style={{
                  fontSize: '26px',
                  fontWeight: 900,
                  fontFamily: 'var(--font-mono)',
                  color: hud.speedKmh > 130 ? '#ef4444' : hud.speedKmh > 110 ? '#f59e0b' : '#00f0ff',
                  lineHeight: 1
                }}
              >
                {hud.speedKmh}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>KM/H</span>
            </div>

            <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.12)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(0, 240, 255, 0.15)',
                    border: '1px solid rgba(0, 240, 255, 0.35)',
                    fontSize: '10px',
                    fontWeight: 800,
                    color: '#00f0ff',
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  {hud.gear}
                </span>
                <span style={{ fontSize: '10px', color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
                  LANE {hud.currentLane}/4
                </span>
              </div>
              <div
                style={{
                  width: '72px',
                  height: '4px',
                  background: 'rgba(255,255,255,0.12)',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (hud.rpm / 7500) * 100)}%`,
                    height: '100%',
                    background: hud.rpm > 6500 ? '#ef4444' : hud.rpm > 4800 ? '#f59e0b' : '#10b981',
                    transition: 'width 0.1s linear'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Center Gaze Focus Pill */}
          <div
            style={{
              background: 'rgba(9, 13, 22, 0.85)',
              backdropFilter: 'blur(10px)',
              border: `1px solid ${driverGaze !== 'CENTER' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(255, 255, 255, 0.12)'}`,
              borderRadius: '20px',
              padding: '5px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
              fontWeight: 700,
              color: driverGaze !== 'CENTER' ? '#34d399' : '#cbd5e1'
            }}
          >
            <Eye size={13} color={driverGaze !== 'CENTER' ? '#10b981' : '#38bdf8'} />
            <span>GAZE FOCUS: {driverGaze}</span>
            {isSilenced && (
              <span
                style={{
                  background: 'rgba(16, 185, 129, 0.25)',
                  color: '#10b981',
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontSize: '10px'
                }}
              >
                ✓ SILENCED
              </span>
            )}
          </div>

          {/* Right: Score, AutoPilot, Camera Mode, Reset & Fullscreen */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', pointerEvents: 'auto' }}>
            <div
              style={{
                background: 'rgba(9, 13, 22, 0.86)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                padding: '5px 11px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <ShieldCheck size={14} color="#10b981" />
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                  {hud.score}
                </span>
              </div>

              {hud.streak > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Flame size={14} color="#f59e0b" />
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#f59e0b' }}>x{hud.streak}</span>
                </div>
              )}

              {hud.damage > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Activity size={13} color={hud.damage > 50 ? '#ef4444' : '#f59e0b'} />
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: hud.damage > 50 ? '#ef4444' : '#f59e0b'
                    }}
                  >
                    {hud.damage}%
                  </span>
                </div>
              )}
            </div>

            {/* LKA Auto-Steer Toggle Button */}
            <button
              onClick={handleAutoPilotToggle}
              className="btn"
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                background: hud.autoPilot ? 'rgba(16, 185, 129, 0.22)' : 'rgba(9, 13, 22, 0.86)',
                border: `1px solid ${hud.autoPilot ? '#10b981' : 'rgba(255, 255, 255, 0.16)'}`,
                color: hud.autoPilot ? '#34d399' : '#94a3b8',
                fontSize: '11px',
                fontWeight: 700
              }}
              title="Toggle ADAS Lane-Keep Assist Auto-Steer (Spacebar)"
            >
              <Navigation size={13} />
              <span>{hud.autoPilot ? 'LKA: ON' : 'LKA: OFF'}</span>
            </button>

            {/* Camera View Switcher Button */}
            <button
              onClick={handleCameraToggle}
              className="btn"
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                background: 'rgba(9, 13, 22, 0.86)',
                border: '1px solid rgba(0, 240, 255, 0.35)',
                color: '#00f0ff',
                fontSize: '11px',
                fontWeight: 700
              }}
              title="Cycle Camera View: Cockpit / Chase / Hood (Key C)"
            >
              <Camera size={13} />
              <span>
                {hud.cameraMode === 'cockpit'
                  ? 'Cockpit'
                  : hud.cameraMode === 'chase'
                  ? 'Chase 360°'
                  : 'Hood Cam'}
              </span>
            </button>

            {/* Reset Traffic Button */}
            <button
              onClick={() => engineRef.current?.reset()}
              className="btn"
              style={{
                padding: '6px 8px',
                borderRadius: '8px',
                background: 'rgba(9, 13, 22, 0.86)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1'
              }}
              title="Reset Highway Traffic & Score"
            >
              <RotateCcw size={13} />
            </button>

            {/* Fullscreen Toggle */}
            {onToggleFullscreen && (
              <button
                onClick={onToggleFullscreen}
                className="btn"
                style={{
                  padding: '6px 8px',
                  borderRadius: '8px',
                  background: 'rgba(9, 13, 22, 0.86)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}
                title={isFullscreenMode ? 'Exit Fullscreen (Esc)' : 'Expand Fullscreen Driving Mode'}
              >
                {isFullscreenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            )}
          </div>
        </div>

        {/* Center AR-HUD Alert / Reaction Banner (Positioned cleanly below Rear-View Mirror at top: 28%) */}
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
                background: 'rgba(220, 38, 38, 0.92)',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                boxShadow: '0 0 28px rgba(239, 68, 68, 0.85)',
                backdropFilter: 'blur(8px)',
                color: '#fff',
                padding: '7px 16px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              <AlertTriangle size={16} />
              <span>
                {hud.activeAlert === 'left' && '⚠ LEFT BLIND SPOT HAZARD! LOOK LEFT (KEY 1 OR CLICK MIRROR)'}
                {hud.activeAlert === 'right' && '⚠ RIGHT BLIND SPOT HAZARD! LOOK RIGHT (KEY 3 OR CLICK MIRROR)'}
                {hud.activeAlert === 'rear' && '⚠ FAST TAILGATER BEHIND! CHECK REAR MIRROR (KEY 4 OR CLICK)'}
              </span>
            </div>
          ) : collisionNotice ? (
            <div
              style={{
                background: 'rgba(220, 38, 38, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                boxShadow: '0 0 20px rgba(220, 38, 38, 0.8)',
                color: '#fff',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '7px'
              }}
            >
              <Zap size={15} color="#fbbf24" />
              <span>{collisionNotice}</span>
            </div>
          ) : clearedNotice ? (
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.92)',
                border: '1px solid rgba(16, 185, 129, 0.7)',
                boxShadow: '0 0 20px rgba(16, 185, 129, 0.6)',
                color: '#fff',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '7px'
              }}
            >
              <CheckCircle2 size={15} />
              <span>{clearedNotice}</span>
            </div>
          ) : null}
        </div>

        {/* Bottom Driving & Gaze Controls Bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(9, 13, 22, 0.86)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '20px',
            padding: '5px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '10px',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10
          }}
        >
          <span>
            <strong style={{ color: '#00f0ff' }}>W/A/S/D</strong> or <strong style={{ color: '#00f0ff' }}>Arrows</strong> Drive
          </span>
          <span>•</span>
          <span>
            <strong style={{ color: '#38bdf8' }}>Space</strong> LKA Auto-Steer
          </span>
          <span>•</span>
          <span>
            <strong style={{ color: '#38bdf8' }}>C</strong> Camera ({hud.cameraMode.toUpperCase()})
          </span>
          <span>•</span>
          <span style={{ color: '#10b981' }}>
            <strong>Keys 1 / 2 / 3 / 4</strong> or <strong>Click Mirror</strong> Simulate Gaze
          </span>
        </div>
      </div>
    );
  }
);
