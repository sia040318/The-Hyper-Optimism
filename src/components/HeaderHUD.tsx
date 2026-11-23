import React from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Eye, Radio, Activity, Maximize2 } from 'lucide-react';
import { InputMode } from '../types/gaze';

interface HeaderHUDProps {
  isAudioActive: boolean;
  onToggleAudio: () => void;
  cvMode: InputMode;
  isCvConnected: boolean;
  isCarlaConnected: boolean;
  onOpenStudy: () => void;
  onLaunchGame: () => void;
}

export const HeaderHUD: React.FC<HeaderHUDProps> = ({
  isAudioActive,
  onToggleAudio,
  cvMode,
  isCvConnected,
  isCarlaConnected,
  onOpenStudy,
  onLaunchGame
}) => {
  const visionLive = cvMode === 'IN_BROWSER_WEBCAM' || (cvMode === 'CV_WEBSOCKET' && isCvConnected);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex h-7 items-center rounded-md border border-border bg-secondary px-2.5 font-mono text-[11px] font-semibold tracking-[0.08em] text-[#38bdf8]">
          AURA
        </div>
        <div>
          <h1 className="font-heading text-base font-semibold tracking-[-0.02em] text-foreground">
            AURA Drive Cockpit
          </h1>
          <p className="text-xs text-muted-foreground">
            Gaze-Contingent 3D Spatial Audio ADAS
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Audio Engine Toggle Pill */}
        <button
          type="button"
          onClick={onToggleAudio}
          className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${isAudioActive
              ? 'border-[#34d399]/35 bg-[#34d399]/10 text-foreground'
              : 'border-border bg-popover text-muted-foreground hover:text-foreground'
            }`}
          title={isAudioActive ? 'Mute 3D Spatial Audio' : 'Enable 3D HRTF Spatial Audio'}
        >
          {isAudioActive ? (
            <Volume2 size={14} strokeWidth={1.75} className="text-[#34d399]" />
          ) : (
            <VolumeX size={14} strokeWidth={1.75} className="text-[#f87171]" />
          )}
          <span>{isAudioActive ? '3D Audio: On' : '3D Audio: Muted'}</span>
        </button>

        {/* Vision Status Pill */}
        <div className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-popover px-3 text-xs text-muted-foreground">
          <Eye
            size={14}
            strokeWidth={1.75}
            className={visionLive ? 'text-[#34d399]' : 'text-[#38bdf8]'}
          />
          <span>
            {cvMode === 'IN_BROWSER_WEBCAM'
              ? 'Webcam (MediaPipe)'
              : cvMode === 'CV_WEBSOCKET' && isCvConnected
                ? 'Python CV'
                : 'Sim Keys 1–4'}
          </span>
          <span
            className={`size-1.5 rounded-full ${visionLive ? 'bg-[#34d399]' : 'bg-[#71717a]'
              }`}
          />
        </div>

        {/* CARLA / Built-in 3D Engine Status Pill */}
        <div className="hidden h-8 items-center gap-2 rounded-full border border-border bg-popover px-3 text-xs text-muted-foreground sm:inline-flex">
          <Radio
            size={14}
            strokeWidth={1.75}
            className={isCarlaConnected ? 'text-[#34d399]' : 'text-muted-foreground'}
          />
          <span>{isCarlaConnected ? 'CARLA Linked' : 'Built-in 3D'}</span>
        </div>

        {/* Secondary CTA: Fullscreen Cockpit */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onLaunchGame}
          className="h-8 gap-1.5 text-xs"
          title="Expand 3D Driving Simulator to Fullscreen Mode"
        >
          <Maximize2 size={13} strokeWidth={1.75} />
          <span>Fullscreen</span>
        </Button>

        {/* Single Primary CTA per viewport: Run User Study */}
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onOpenStudy}
          className="h-8 gap-1.5 px-3.5 text-xs font-medium"
        >
          <Activity size={13} strokeWidth={1.75} />
          <span>Run User Study</span>
        </Button>
      </div>
    </header>
  );
};
