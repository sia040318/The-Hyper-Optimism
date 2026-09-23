import React from 'react';
import { ScenarioType } from '../types/threats';
import { Compass } from 'lucide-react';

interface ScenarioPanelProps {
  currentScenario: ScenarioType;
  onSelectScenario: (scenario: ScenarioType) => void;
}

export const ScenarioPanel: React.FC<ScenarioPanelProps> = ({
  currentScenario,
  onSelectScenario
}) => {
  const scenarios: Array<{ type: ScenarioType; label: string }> = [
    { type: 'BLIND_SPOT_LEFT', label: '🚗 Left Blind Spot Overtake' },
    { type: 'BLIND_SPOT_RIGHT', label: '🚙 Right Blind Spot Lingering' },
    { type: 'REAR_TAILGATER', label: '🏎 Fast Rear Approaching Tailgater' },
    { type: 'FRONT_CUT_IN', label: '🚚 Lead Vehicle Sharp Deceleration' },
    { type: 'ORBIT_360', label: '🔄 360° Continuous Orbit' },
    { type: 'MANUAL', label: '🎯 Free Drag & Drop Mode' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="panel-header">
        <h2 className="panel-title">
          <Compass size={14} color="var(--accent-violet)" />
          ADAS Threat Scenarios
        </h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {scenarios.map((sc) => (
          <button
            key={sc.type}
            className={`btn ${currentScenario === sc.type ? 'btn-accent' : ''}`}
            onClick={() => onSelectScenario(sc.type)}
            style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 11 }}
          >
            {sc.label}
          </button>
        ))}
      </div>
    </div>
  );
};
