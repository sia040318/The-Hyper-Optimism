import { ThreatObstacle, ProxyTarget, ScenarioType } from '../types/threats';
import { UrgencyLevel } from '../types/audio';

export function calculateAzimuth(x: number, y: number): number {
  // ISO 8855: x = lateral (right +), y = longitudinal (forward +)
  // Azimuth: 0 = Front, 90 = Right, -90 = Left, 180 = Rear
  const angleRad = Math.atan2(x, y);
  return (angleRad * 180) / Math.PI;
}

export function calculateDistance(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function mapToProxyTarget(x: number, y: number, azimuth: number): ProxyTarget {
  // Check lateral blind spots first
  if (x < -1.5 && y < 2.5 && y > -8.0) {
    return 'LEFT_MIRROR';
  }
  if (x > 1.5 && y < 2.5 && y > -8.0) {
    return 'RIGHT_MIRROR';
  }

  // Angular partitioning
  if (azimuth > -45 && azimuth < 45 && y > 0) {
    return 'FRONT_WINDSHIELD';
  } else if (azimuth <= -45 && azimuth > -135) {
    return 'LEFT_MIRROR';
  } else if (azimuth >= 45 && azimuth < 135) {
    return 'RIGHT_MIRROR';
  } else {
    return 'REAR_MIRROR';
  }
}

export function calculateUrgency(distance: number): UrgencyLevel {
  if (distance > 30.0) return 'SAFE';
  if (distance > 16.0) return 'AWARENESS';
  if (distance > 8.0) return 'WARNING';
  return 'CRITICAL';
}

export function createThreat(
  id: string,
  name: string,
  x: number,
  y: number,
  speedX = 0,
  speedY = 0,
  isPrimary = true
): ThreatObstacle {
  const azimuth = calculateAzimuth(x, y);
  const distance = calculateDistance(x, y);
  const proxyTarget = mapToProxyTarget(x, y, azimuth);

  return {
    id,
    name,
    x,
    y,
    speedX,
    speedY,
    distance,
    azimuth,
    proxyTarget,
    isPrimary
  };
}

export function getScenarioThreats(scenario: ScenarioType): ThreatObstacle[] {
  switch (scenario) {
    case 'BLIND_SPOT_LEFT':
      return [
        createThreat('t1', 'Fast Overtaking Sedan', -3.2, -6.5, 0, 3.8, true)
      ];
    case 'BLIND_SPOT_RIGHT':
      return [
        createThreat('t2', 'Lingering SUV in Blind Spot', 3.4, -1.8, 0, 0.4, true)
      ];
    case 'REAR_TAILGATER':
      return [
        createThreat('t3', 'Approaching Tailgater', 0.2, -18.0, 0, 6.2, true)
      ];
    case 'FRONT_CUT_IN':
      return [
        createThreat('t4', 'Decelerating Truck', 0.8, 14.0, -0.4, -2.5, true)
      ];
    case 'ORBIT_360':
      return [
        createThreat('t5', 'Rotating Hazard Beacon', -12.0, 0.0, 0, 0, true)
      ];
    case 'MANUAL':
    default:
      return [
        createThreat('t_manual', 'Custom Threat Obstacle', -4.0, -2.0, 0, 0, true)
      ];
  }
}
