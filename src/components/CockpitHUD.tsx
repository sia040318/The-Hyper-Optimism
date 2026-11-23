import React from 'react';
import { GazeZone } from '../types/gaze';
import { ProxyTarget } from '../types/threats';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, Check, Eye } from 'lucide-react';

interface CockpitHUDProps {
  currentGaze: GazeZone;
  activeTarget: ProxyTarget | null;
  isSilenced: boolean;
  onSelectGaze: (zone: GazeZone) => void;
}

export const CockpitHUD: React.FC<CockpitHUDProps> = ({
  currentGaze,
  activeTarget,
  isSilenced,
  onSelectGaze
}) => {
  const mirrors: Array<{
    zone: GazeZone;
    target: ProxyTarget;
    title: string;
    hint: string;
    alertLabel: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }> = [
    {
      zone: 'LEFT_MIRROR',
      target: 'LEFT_MIRROR',
      title: 'Left Mirror (-90°)',
      hint: 'Key [1] or Click',
      alertLabel: 'Blind Spot Alert',
      icon: ArrowLeft
    },
    {
      zone: 'REAR_MIRROR',
      target: 'REAR_MIRROR',
      title: 'Rear-View (180°)',
      hint: 'Key [4] or Click',
      alertLabel: 'Tailgater Alert',
      icon: ArrowDown
    },
    {
      zone: 'RIGHT_MIRROR',
      target: 'RIGHT_MIRROR',
      title: 'Right Mirror (+90°)',
      hint: 'Key [3] or Click',
      alertLabel: 'Blind Spot Alert',
      icon: ArrowRight
    }
  ];

  return (
    <div className="grid shrink-0 grid-cols-3 gap-2">
      {mirrors.map((m) => {
        const Icon = m.icon;
        const isAlert = activeTarget === m.target && !isSilenced;
        const isSilencedTarget = activeTarget === m.target && isSilenced;
        const isFocused = currentGaze === m.zone;
        const verified = isFocused || isSilencedTarget;

        return (
          <button
            key={m.zone}
            type="button"
            onClick={() => onSelectGaze(m.zone)}
            className={`flex cursor-pointer flex-col items-center rounded-lg border px-2.5 py-2 text-center transition-colors ${
              verified
                ? 'border-[#34d399]/50 bg-[#34d399]/10'
                : isAlert
                  ? 'border-[#f87171]/60 bg-[#f87171]/12'
                  : 'border-border bg-popover hover:border-white/[0.14]'
            }`}
          >
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              <Icon size={10} />
              {m.title}
            </span>

            <span
              className={`mt-1 inline-flex items-center gap-1 font-mono text-[11px] font-semibold ${
                verified
                  ? 'text-[#34d399]'
                  : isAlert
                    ? 'text-[#f87171]'
                    : 'text-foreground'
              }`}
            >
              {isSilencedTarget ? (
                <>
                  <Check size={11} /> Closed-Loop Muted
                </>
              ) : isFocused && isAlert ? (
                <>
                  <Check size={11} /> Acknowledged
                </>
              ) : isAlert ? (
                <>
                  <AlertTriangle size={11} /> {m.alertLabel}
                </>
              ) : isFocused ? (
                <>
                  <Eye size={11} /> Gaze Locked
                </>
              ) : (
                'Clear'
              )}
            </span>

            <span className="mt-0.5 font-mono text-[9.5px] text-[#71717a]">{m.hint}</span>
          </button>
        );
      })}
    </div>
  );
};
