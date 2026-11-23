import React from 'react';
import { ScenarioType } from '../types/threats';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUpLeft,
  ArrowUpRight,
  Compass,
  Crosshair,
  RefreshCw
} from 'lucide-react';

interface ScenarioPanelProps {
  currentScenario: ScenarioType;
  onSelectScenario: (scenario: ScenarioType) => void;
}

export const ScenarioPanel: React.FC<ScenarioPanelProps> = ({
  currentScenario,
  onSelectScenario
}) => {
  const scenarios: Array<{
    type: ScenarioType;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }> = [
    { type: 'BLIND_SPOT_LEFT', label: 'Left Blind Spot Overtake', icon: ArrowUpLeft },
    { type: 'BLIND_SPOT_RIGHT', label: 'Right Blind Spot Lingering', icon: ArrowUpRight },
    { type: 'REAR_TAILGATER', label: 'Fast Rear Tailgater', icon: ArrowDown },
    { type: 'FRONT_CUT_IN', label: 'Lead Vehicle Deceleration', icon: AlertTriangle },
    { type: 'ORBIT_360', label: '360° Continuous Orbit', icon: RefreshCw },
    { type: 'MANUAL', label: 'Free Radar Drag Mode', icon: Crosshair }
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="border-b border-border pb-2.5">
        <h2 className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Compass size={14} strokeWidth={1.75} className="text-[#38bdf8]" />
          ADAS Threat Scenarios
        </h2>
      </div>

      <div className="flex flex-col gap-1.5">
        {scenarios.map((sc) => {
          const Icon = sc.icon;
          const active = currentScenario === sc.type;
          return (
            <button
              key={sc.type}
              type="button"
              onClick={() => onSelectScenario(sc.type)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                active
                  ? 'border-[#38bdf8]/40 bg-[#38bdf8]/10 text-foreground'
                  : 'border-border bg-popover/60 text-muted-foreground hover:border-white/[0.14] hover:text-foreground'
              }`}
            >
              <Icon
                size={13}
                className={active ? 'shrink-0 text-[#38bdf8]' : 'shrink-0 text-muted-foreground'}
              />
              <span>{sc.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
