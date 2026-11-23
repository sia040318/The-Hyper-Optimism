import React from 'react';
import { PanningModel, SoundType } from '../types/audio';
import { ProxyTarget } from '../types/threats';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Headphones, SlidersHorizontal } from 'lucide-react';

interface AudioControlPanelProps {
  isAudioActive: boolean;
  onToggleAudio: () => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  panningModel: PanningModel;
  onPanningChange: (model: PanningModel) => void;
  soundType: SoundType;
  onSoundTypeChange: (sound: SoundType) => void;
  onTestDirection: (target: ProxyTarget) => void;
}

export const AudioControlPanel: React.FC<AudioControlPanelProps> = ({
  isAudioActive,
  onToggleAudio,
  volume,
  onVolumeChange,
  panningModel,
  onPanningChange,
  soundType,
  onSoundTypeChange,
  onTestDirection
}) => {
  return (
    <div className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-card p-4">
      <div className="flex items-center justify-between border-b border-border pb-2.5">
        <h2 className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Headphones size={14} strokeWidth={1.75} className="text-[#38bdf8]" />
          HRTF Audio Engine
        </h2>
        <Badge
          variant="outline"
          className={`font-mono text-[10px] ${
            isAudioActive
              ? 'border-[#34d399]/35 bg-[#34d399]/10 text-[#34d399]'
              : 'border-border text-muted-foreground'
          }`}
        >
          {isAudioActive ? 'ACTIVE' : 'MUTED'}
        </Badge>
      </div>

      {/* Sound On / Off Switch */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <span className="text-xs font-medium text-foreground">Spatial Audio Output</span>
        <button
          onClick={onToggleAudio}
          type="button"
          aria-label="Toggle Sound"
          className={`relative flex h-6 w-11 cursor-pointer items-center rounded-full border p-0.5 transition-colors ${
            isAudioActive
              ? 'border-[#34d399]/60 bg-[#34d399]/25'
              : 'border-border bg-secondary'
          }`}
        >
          <span
            className={`size-4 rounded-full transition-transform ${
              isAudioActive ? 'translate-x-5 bg-[#34d399]' : 'translate-x-0 bg-[#a1a1aa]'
            }`}
          />
        </button>
      </div>

      {/* Master Volume */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Master Volume</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {Math.round(volume * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value) / 100)}
          className="h-1.5 w-full cursor-pointer accent-[#38bdf8]"
        />
      </div>

      {/* Panning Model */}
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Spatial Panning Engine</div>
        <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => onPanningChange('HRTF')}
            className={`rounded-[4px] px-2 py-1.5 text-[11px] font-medium transition-colors ${
              panningModel === 'HRTF'
                ? 'bg-secondary text-[#38bdf8]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            3D HRTF
          </button>
          <button
            type="button"
            onClick={() => onPanningChange('equalpower')}
            className={`rounded-[4px] px-2 py-1.5 text-[11px] font-medium transition-colors ${
              panningModel === 'equalpower'
                ? 'bg-secondary text-[#38bdf8]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Stereo ILD
          </button>
        </div>
      </div>

      {/* Waveform */}
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Acoustic Waveform</div>
        <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-background p-0.5">
          {[
            { id: 'chime' as const, label: 'Chime' },
            { id: 'click_train' as const, label: 'Clicks' },
            { id: 'sine' as const, label: 'Sine' }
          ].map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onSoundTypeChange(w.id)}
              className={`rounded-[4px] px-2 py-1.5 text-[11px] font-medium transition-colors ${
                soundType === w.id
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Instant Direction Cues */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          <SlidersHorizontal size={13} strokeWidth={1.75} className="text-[#fbbf24]" />
          Instant Direction Cues
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onTestDirection('LEFT_MIRROR')}
            className="h-7 font-mono text-[11px]"
          >
            Left (-90°)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onTestDirection('RIGHT_MIRROR')}
            className="h-7 font-mono text-[11px]"
          >
            Right (+90°)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onTestDirection('REAR_MIRROR')}
            className="h-7 font-mono text-[11px]"
          >
            Rear (180°)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onTestDirection('FRONT_WINDSHIELD')}
            className="h-7 font-mono text-[11px]"
          >
            Front (0°)
          </Button>
        </div>
      </div>

      <p className="pt-1 text-center text-[11px] text-[#71717a]">
        Stereo headphones recommended for HRTF pinna cues.
      </p>
    </div>
  );
};
