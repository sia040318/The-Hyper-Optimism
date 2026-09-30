import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { GameEngine, GameEngineOptions, MirrorSide, TrafficEvent } from './GameEngine';

export interface GameWindowHandle {
  start: () => void;
  pause: () => void;
  reset: () => void;
  notifyMirrorCheck: (side: MirrorSide) => void;
  getMirrorRegions: () => Record<MirrorSide, {x: number, y: number, width: number, height: number}>;
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
      <div 
        ref={containerRef} 
        className={className} 
        style={{ width: '100%', height: '100%', overflow: 'hidden', ...style }} 
      />
    );
  }
);
