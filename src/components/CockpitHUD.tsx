import React from 'react';
import { GazeZone } from '../types/gaze';
import { ProxyTarget } from '../types/threats';

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
  const isLeftAlert = activeTarget === 'LEFT_MIRROR';
  const isRightAlert = activeTarget === 'RIGHT_MIRROR';
  const isRearAlert = activeTarget === 'REAR_MIRROR';

  const isLeftFocused = currentGaze === 'LEFT_MIRROR';
  const isRightFocused = currentGaze === 'RIGHT_MIRROR';
  const isRearFocused = currentGaze === 'REAR_MIRROR';

  return (
    <div className="mirrors-hud">
      {/* Left Side Mirror */}
      <div
        className={`mirror-card ${isLeftAlert ? 'alert-active' : ''} ${isLeftFocused ? 'gaze-focused' : ''}`}
        onClick={() => onSelectGaze('LEFT_MIRROR')}
        style={{ cursor: 'pointer' }}
      >
        <span className="mirror-label">LEFT SIDE MIRROR</span>
        <span className="mirror-status">
          {isLeftFocused && isLeftAlert
            ? (isSilenced ? '✓ CLOSED-LOOP MUTED' : '✓ ACKNOWLEDGED')
            : isLeftAlert
            ? '⚠ WARNING'
            : isLeftFocused
            ? '👁 FOCUSED'
            : 'CLEAR'}
        </span>
        <span className="mirror-hint">Press A or ←</span>
      </div>

      {/* Rear-View Mirror */}
      <div
        className={`mirror-card ${isRearAlert ? 'alert-active' : ''} ${isRearFocused ? 'gaze-focused' : ''}`}
        onClick={() => onSelectGaze('REAR_MIRROR')}
        style={{ cursor: 'pointer' }}
      >
        <span className="mirror-label">REAR-VIEW MIRROR</span>
        <span className="mirror-status">
          {isRearFocused && isRearAlert
            ? '✓ ACKNOWLEDGED'
            : isRearAlert
            ? '⚠ WARNING'
            : isRearFocused
            ? '👁 FOCUSED'
            : 'CLEAR'}
        </span>
        <span className="mirror-hint">Press S or ↓</span>
      </div>

      {/* Right Side Mirror */}
      <div
        className={`mirror-card ${isRightAlert ? 'alert-active' : ''} ${isRightFocused ? 'gaze-focused' : ''}`}
        onClick={() => onSelectGaze('RIGHT_MIRROR')}
        style={{ cursor: 'pointer' }}
      >
        <span className="mirror-label">RIGHT SIDE MIRROR</span>
        <span className="mirror-status">
          {isRightFocused && isRightAlert
            ? '✓ ACKNOWLEDGED'
            : isRightAlert
            ? '⚠ WARNING'
            : isRightFocused
            ? '👁 FOCUSED'
            : 'CLEAR'}
        </span>
        <span className="mirror-hint">Press D or →</span>
      </div>
    </div>
  );
};
