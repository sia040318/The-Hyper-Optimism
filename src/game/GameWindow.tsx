import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { GameEngine, GameEngineOptions, MirrorSide, TrafficEvent, HUDStats } from './GameEngine';
import { Maximize2, Minimize2, AlertTriangle, CheckCircle2, ShieldCheck, Flame } from 'lucide-react';

export type { TrafficEvent, HUDStats };

export interface GameWindowHandle {
  start: () => void;
  pause: () => void;
  reset: () => void;
  notifyMirrorCheck: (side: MirrorSide) => void;
  updateDriverHeadPose: (yawDeg: number, pitchDeg: number) => void;
  getMirrorRegions: () => Record<MirrorSide, { x: number; y: number; width: number; height: number }>;
}

export interface GameWindowProps extends GameEngineOptions {
  className?: string;
  style?: React.CSSProperties;
  driverGaze?: string;
  isFullscreenMode?: boolean;
  onToggleFullscreen?: () => void;
}

export const GameWindow = forwardRef<GameWindowHandle, GameWindowProps>(
  (
    {
      onTrafficEvent,
      onHUDUpdate,
      className,
      style,
      driverGaze,
      isFullscreenMode = false,
      onToggleFullscreen
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<GameEngine | null>(null);

    const [hud, setHud] = useState<HUDStats>({
      speedKmh: 94,
      score: 0,
      streak: 0,
      distanceM: 0,
      gear: 'D4',
      activeAlert: null,
      lastReactionMs: null
    });

    const [clearedNotice, setClearedNotice] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      start: () => engineRef.current?.start(),
      pause: () => engineRef.current?.pause(),
      reset: () => engineRef.current?.reset(),
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
          left: { x: 0, y: 0.4, width: 0.26, height: 0.26 },
          right: { x: 0.74, y: 0.4, width: 0.26, height: 0.26 },
          rear: { x: 0.37, y: 0, width: 0.26, height: 0.26 }
        };
      }
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const engine = new GameEngine({
        onTrafficEvent: (e) => {
          if (onTrafficEvent) onTrafficEvent(e);
        },
        onHUDUpdate: (stats) => {
          setHud(stats);
          if (onHUDUpdate) onHUDUpdate(stats);

          // If a reaction time was recently recorded, display brief celebratory banner
          if (stats.lastReactionMs && stats.lastReactionMs > 0 && !stats.activeAlert) {
            setClearedNotice(`✓ THREAT CLEARED IN ${stats.lastReactionMs}ms (+150 PTS)`);
          }
        }
      });

      engine.mount(containerRef.current);
      engine.start();
      engineRef.current = engine;

      return () => {
        engine.pause();
        engine.unmount();
        engineRef.current = null;
      };
    }, [onTrafficEvent, onHUDUpdate]);

    // Clear the reaction toast after 3 seconds
    useEffect(() => {
      if (!clearedNotice) return;
      const t = setTimeout(() => setClearedNotice(null), 3200);
      return () => clearTimeout(t);
    }, [clearedNotice]);

    return (
      <div
        className={className}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          background: '#0a0f1d',
          ...style
        }}
      >
        {/* Three.js Canvas Container */}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Arcade HUD Overlay: Top Status Bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '12px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          {/* Speedometer & Gear */}
          <div
            style={{
              background: 'rgba(9, 13, 22, 0.75)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(0, 240, 255, 0.3)',
              borderRadius: '8px',
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '8px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>SPEED</span>
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: 800,
                  fontFamily: 'JetBrains Mono, monospace',
                  color: hud.speedKmh > 115 ? '#ef4444' : '#00f0ff',
                  lineHeight: 1
                }}
              >
                {hud.speedKmh}
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600 }}>KM/H</span>
            <div
              style={{
                marginLeft: '6px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.1)',
                fontSize: '11px',
                fontWeight: 700,
                color: '#fff'
              }}
            >
              {hud.gear}
            </div>
          </div>

          {/* Center Hazard Notice or Cleared Toast */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            {hud.activeAlert ? (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.9)',
                  border: '1px solid rgba(255, 255, 255, 0.4)',
                  boxShadow: '0 0 20px rgba(239, 68, 68, 0.8)',
                  backdropFilter: 'blur(6px)',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  animation: 'pulse 1s infinite'
                }}
              >
                <AlertTriangle size={16} />
                <span>
                  {hud.activeAlert === 'left' && '⚠ BLIND SPOT LEFT! CHECK LEFT MIRROR'}
                  {hud.activeAlert === 'right' && '⚠ BLIND SPOT RIGHT! CHECK RIGHT MIRROR'}
                  {hud.activeAlert === 'rear' && '⚠ TAILGATER BEHIND! CHECK REAR MIRROR'}
                </span>
              </div>
            ) : clearedNotice ? (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.9)',
                  border: '1px solid rgba(16, 185, 129, 0.5)',
                  boxShadow: '0 0 15px rgba(16, 185, 129, 0.5)',
                  backdropFilter: 'blur(6px)',
                  color: '#fff',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <CheckCircle2 size={15} />
                <span>{clearedNotice}</span>
              </div>
            ) : null}

            {driverGaze && driverGaze !== 'CENTER' && (
              <span
                style={{
                  fontSize: '10px',
                  background: 'rgba(0, 0, 0, 0.6)',
                  color: '#10b981',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  fontWeight: 600
                }}
              >
                👁 LOOKING AT: {driverGaze}
              </span>
            )}
          </div>

          {/* Right Stats & Fullscreen Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'auto' }}>
            <div
              style={{
                background: 'rgba(9, 13, 22, 0.75)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={14} color="#10b981" />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>SCORE</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>{hud.score}</span>
                </div>
              </div>

              {hud.streak > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Flame size={14} color="#f59e0b" />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b' }}>
                    x{hud.streak}
                  </span>
                </div>
              )}
            </div>

            {onToggleFullscreen && (
              <button
                onClick={onToggleFullscreen}
                className="btn btn-secondary"
                style={{
                  padding: '8px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(9, 13, 22, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}
                title={isFullscreenMode ? 'Exit Fullscreen' : 'Fullscreen Driving Mode'}
              >
                {isFullscreenMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            )}
          </div>
        </div>

        {/* Bottom Driving Controls Bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(9, 13, 22, 0.75)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '20px',
            padding: '5px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '11px',
            color: 'var(--text-dim)',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <span>
            <strong style={{ color: '#fff' }}>A / ←</strong> Steer Left
          </span>
          <span>•</span>
          <span>
            <strong style={{ color: '#fff' }}>D / →</strong> Steer Right
          </span>
          <span>•</span>
          <span>
            <strong style={{ color: '#fff' }}>W / ↑</strong> Throttle
          </span>
          <span>•</span>
          <span>
            <strong style={{ color: '#fff' }}>S / ↓</strong> Brake
          </span>
          <span>•</span>
          <span style={{ color: '#10b981' }}>
            <strong>Head Turn</strong> Checks Mirrors
          </span>
        </div>
      </div>
    );
  }
);
