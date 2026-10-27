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
  const isLeftAlert = activeTarget === 'LEFT_MIRROR' && !isSilenced;
  const isRightAlert = activeTarget === 'RIGHT_MIRROR' && !isSilenced;
  const isRearAlert = activeTarget === 'REAR_MIRROR' && !isSilenced;

  const isLeftSilenced = activeTarget === 'LEFT_MIRROR' && isSilenced;
  const isRightSilenced = activeTarget === 'RIGHT_MIRROR' && isSilenced;
  const isRearSilenced = activeTarget === 'REAR_MIRROR' && isSilenced;

  const isLeftFocused = currentGaze === 'LEFT_MIRROR';
  const isRightFocused = currentGaze === 'RIGHT_MIRROR';
  const isRearFocused = currentGaze === 'REAR_MIRROR';

  return (
    <div className="mirrors-hud">
      {/* Left Side Mirror */}
      <div
        className={`mirror-card ${isLeftAlert ? 'alert-active' : ''} ${
          isLeftFocused || isLeftSilenced ? 'gaze-focused' : ''
        }`}
        onClick={() => onSelectGaze('LEFT_MIRROR')}
        style={{ cursor: 'pointer' }}
      >
        <span className="mirror-label">◀ LEFT WING MIRROR (-90°)</span>
        <span className="mirror-status">
          {isLeftSilenced
            ? '✓ CLOSED-LOOP MUTED'
            : isLeftFocused && isLeftAlert
            ? '✓ ACKNOWLEDGED'
            : isLeftAlert
            ? '⚠ BLIND SPOT ALERT'
            : isLeftFocused
            ? '👁 GAZE LOCKED'
            : 'CLEAR'}
        </span>
        <span className="mirror-hint">Press [1] or Click Mirror</span>
      </div>

      {/* Rear-View Mirror */}
      <div
        className={`mirror-card ${isRearAlert ? 'alert-active' : ''} ${
          isRearFocused || isRearSilenced ? 'gaze-focused' : ''
        }`}
        onClick={() => onSelectGaze('REAR_MIRROR')}
        style={{ cursor: 'pointer' }}
      >
        <span className="mirror-label">▼ REAR-VIEW MIRROR (180°)</span>
        <span className="mirror-status">
          {isRearSilenced
            ? '✓ CLOSED-LOOP MUTED'
            : isRearFocused && isRearAlert
            ? '✓ ACKNOWLEDGED'
            : isRearAlert
            ? '⚠ TAILGATER ALERT'
            : isRearFocused
            ? '👁 GAZE LOCKED'
            : 'CLEAR'}
        </span>
        <span className="mirror-hint">Press [4] or Click Mirror</span>
      </div>

      {/* Right Side Mirror */}
      <div
        className={`mirror-card ${isRightAlert ? 'alert-active' : ''} ${
          isRightFocused || isRightSilenced ? 'gaze-focused' : ''
        }`}
        onClick={() => onSelectGaze('RIGHT_MIRROR')}
        style={{ cursor: 'pointer' }}
      >
        <span className="mirror-label">RIGHT WING MIRROR (+90°) ▶</span>
        <span className="mirror-status">
          {isRightSilenced
            ? '✓ CLOSED-LOOP MUTED'
            : isRightFocused && isRightAlert
            ? '✓ ACKNOWLEDGED'
            : isRightAlert
            ? '⚠ BLIND SPOT ALERT'
            : isRightFocused
            ? '👁 GAZE LOCKED'
            : 'CLEAR'}
        </span>
        <span className="mirror-hint">Press [3] or Click Mirror</span>
      </div>
    </div>
  );
};
