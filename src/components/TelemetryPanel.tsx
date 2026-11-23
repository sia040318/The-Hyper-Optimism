import React from 'react';
import { ThreatObstacle } from '../types/threats';
import { GazeZone, HeadPose, InputMode } from '../types/gaze';
import { calculateUrgency } from '../utils/threatScenarios';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, Gauge } from 'lucide-react';

interface TelemetryPanelProps {
  primaryThreat: ThreatObstacle | null;
  currentGaze: GazeZone;
  dwellTimeMs: number;
  headPose: HeadPose;
  inputMode: InputMode;
  isCvConnected: boolean;
  irisRatio?: number | null;
  onSimulateGaze: (zone: GazeZone) => void;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({
  primaryThreat,
  currentGaze,
  dwellTimeMs,
  headPose,
  inputMode,
  isCvConnected,
  irisRatio,
  onSimulateGaze
}) => {
  const urgency = primaryThreat ? calculateUrgency(primaryThreat.distance) : 'SAFE';

  const getUrgencyColor = () => {
    switch (urgency) {
      case 'CRITICAL':
        return '#f87171';
      case 'WARNING':
        return '#fbbf24';
      case 'AWARENESS':
        return '#38bdf8';
      default:
        return '#34d399';
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4">
      <div className="flex items-center justify-between border-b border-border pb-2.5">
        <h2 className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Gauge size={14} strokeWidth={1.75} className="text-[#38bdf8]" />
          Threat Telemetry
        </h2>
        {primaryThreat && (
          <span className="max-w-[130px] truncate font-mono text-[10px] text-muted-foreground">
            {primaryThreat.name}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border bg-popover px-3 py-2">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
            Azimuth
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
            {primaryThreat
              ? `${primaryThreat.azimuth > 0 ? '+' : ''}${primaryThreat.azimuth.toFixed(1)}°`
              : '--'}
          </div>
        </div>

        <div className="rounded-md border border-border bg-popover px-3 py-2">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
            Distance
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
            {primaryThreat ? `${primaryThreat.distance.toFixed(1)} m` : '--'}
          </div>
        </div>

        <div className="rounded-md border border-border bg-popover px-3 py-2">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
            Proxy Target
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-[#38bdf8]">
            {primaryThreat ? primaryThreat.proxyTarget : 'NONE'}
          </div>
        </div>

        <div className="rounded-md border border-border bg-popover px-3 py-2">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
            Urgency
          </div>
          <div
            className="mt-0.5 font-mono text-xs font-semibold"
            style={{ color: getUrgencyColor() }}
          >
            {urgency}
          </div>
        </div>
      </div>

      {/* Gaze & Head Pose Section */}
      <div className="flex items-center justify-between border-b border-border pt-1 pb-2">
        <h2 className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Eye size={14} strokeWidth={1.75} className="text-[#38bdf8]" />
          Driver Gaze
        </h2>
        <span
          className={`font-mono text-[10px] ${
            inputMode === 'IN_BROWSER_WEBCAM' || (isCvConnected && inputMode === 'CV_WEBSOCKET')
              ? 'text-[#34d399]'
              : 'text-muted-foreground'
          }`}
        >
          {inputMode === 'IN_BROWSER_WEBCAM'
            ? 'MediaPipe'
            : isCvConnected && inputMode === 'CV_WEBSOCKET'
              ? 'Python WS'
              : 'Simulation'}
        </span>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-popover px-3 py-2">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
            Active Focus
          </div>
          <div
            className={`mt-0.5 font-mono text-xs font-semibold ${
              currentGaze !== 'CENTER' ? 'text-[#34d399]' : 'text-foreground'
            }`}
          >
            {currentGaze}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
            Dwell
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#34d399]">
            {dwellTimeMs} ms
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border bg-popover px-3 py-2">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
            Head Yaw
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-foreground">
            {headPose.yaw > 0 ? `+${headPose.yaw.toFixed(1)}` : headPose.yaw.toFixed(1)}°
          </div>
        </div>
        <div className="rounded-md border border-border bg-popover px-3 py-2">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
            Head Pitch
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-foreground">
            {headPose.pitch > 0 ? `+${headPose.pitch.toFixed(1)}` : headPose.pitch.toFixed(1)}°
          </div>
        </div>
        {irisRatio !== undefined && irisRatio !== null && (
          <div className="col-span-2 rounded-md border border-border bg-popover px-3 py-2">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#71717a]">
              Iris Ratio (L 0.0 ← 0.5 → 1.0 R)
            </div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#34d399]">
              {irisRatio.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Quick Gaze Simulation */}
      <div className="space-y-1.5 border-t border-border pt-2.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#71717a]">
          Gaze Simulation (Keys 1–4)
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onSimulateGaze('LEFT_MIRROR')}
            className={`h-7 gap-1 font-mono text-[11px] ${
              currentGaze === 'LEFT_MIRROR' ? 'border-[#38bdf8]/50 bg-[#38bdf8]/10 text-foreground' : ''
            }`}
          >
            <ArrowLeft size={11} /> Left [1]
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onSimulateGaze('RIGHT_MIRROR')}
            className={`h-7 gap-1 font-mono text-[11px] ${
              currentGaze === 'RIGHT_MIRROR' ? 'border-[#38bdf8]/50 bg-[#38bdf8]/10 text-foreground' : ''
            }`}
          >
            Right [3] <ArrowRight size={11} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onSimulateGaze('REAR_MIRROR')}
            className={`h-7 gap-1 font-mono text-[11px] ${
              currentGaze === 'REAR_MIRROR' ? 'border-[#38bdf8]/50 bg-[#38bdf8]/10 text-foreground' : ''
            }`}
          >
            <ArrowDown size={11} /> Rear [4]
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onSimulateGaze('CENTER')}
            className={`h-7 gap-1 font-mono text-[11px] ${
              currentGaze === 'CENTER' ? 'border-[#38bdf8]/50 bg-[#38bdf8]/10 text-foreground' : ''
            }`}
          >
            <ArrowUp size={11} /> Road [2]
          </Button>
        </div>
      </div>
    </div>
  );
};
