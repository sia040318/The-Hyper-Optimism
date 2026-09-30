import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { GameEngine, GameEngineOptions, MirrorSide } from './GameEngine';

export interface GameWindowHandle {
  start: () => void;
  pause: () => void;
  reset: () => void;
  notifyMirrorCheck: (side: MirrorSide) => void;
  getMirrorRegions: () => Record<MirrorSide, {x: number, y: number, width: number, height: number}>;
  setControlsEnabled: (enabled: boolean) => void;
}

export interface GameWindowProps extends GameEngineOptions {
  className?: string;
  style?: React.CSSProperties;
}

export const GameWindow = forwardRef<GameWindowHandle, GameWindowProps>(
  ({ onTrafficEvent, className, style }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<GameEngine | null>(null);

    useImperativeHandle(ref, () => ({
      start: () => engineRef.current?.start(),
      pause: () => engineRef.current?.pause(),
      reset: () => engineRef.current?.reset(),
      setControlsEnabled: (enabled: boolean) => engineRef.current?.setControlsEnabled(enabled),
      notifyMirrorCheck: (side: MirrorSide) => engineRef.current?.notifyMirrorCheck(side),
      getMirrorRegions: () => {
        if (engineRef.current) {
          return engineRef.current.getMirrorRegions();
        }
        return {
          left: { x: 0, y: 0, width: 0, height: 0 },
          right: { x: 0, y: 0, width: 0, height: 0 },
          rear: { x: 0, y: 0, width: 0, height: 0 }
        };
      }
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const engine = new GameEngine({
        onTrafficEvent
      });
      
      engine.mount(containerRef.current);
      engine.start(); // Auto-start for simplicity
      engineRef.current = engine;

      return () => {
        engine.pause();
        engine.unmount();
        engineRef.current = null;
      };
    }, [onTrafficEvent]);

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
        <div 
          ref={containerRef} 
          className={className} 
          style={{ width: '100%', height: '100%', overflow: 'hidden' }} 
        />
        <div style={{
          position: 'absolute',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '6px 12px',
          borderRadius: '4px',
          fontFamily: 'monospace',
          fontSize: '14px',
          pointerEvents: 'none',
          userSelect: 'none'
        }}>
          [J] Left &nbsp;&bull;&nbsp; [L] Right &nbsp;&bull;&nbsp; or mouse
        </div>
      </div>
    );
  }
);
