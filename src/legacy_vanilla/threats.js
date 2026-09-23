/**
 * Threat Management and ADAS Scenario Simulation
 * Handles 360-degree obstacle tracking, spatial mapping to cabin proxy mirrors,
 * and realistic traffic scenario trajectories.
 */

export class ThreatManager {
  constructor() {
    this.threats = [];
    this.activeScenario = 'NONE';
    this.scenarioTime = 0;
    this.selectedThreatId = null;

    // Callbacks
    this.onThreatUpdated = null;
  }

  /**
   * Calculates polar distance, azimuth, and proxy mirror target
   * @param {number} x - Relative X (meters, + right, - left)
   * @param {number} y - Relative Y (meters, + forward, - rear)
   * @param {number} z - Relative Z (meters, + up)
   */
  calculateThreatMetrics(x, y, z = 0.2) {
    const distance = Math.sqrt(x * x + y * y + z * z);
    
    // Azimuth in degrees:
    // 0° = straight ahead (Forward)
    // +90° = direct right
    // -90° = direct left
    // 180° / -180° = directly behind
    let azimuthDeg = Math.atan2(x, y) * (180 / Math.PI);

    // Map to cabin proxy targets based on documentation:
    let targetProxy = 'NONE';
    if (azimuthDeg >= -125 && azimuthDeg <= -55) {
      targetProxy = 'LEFT_MIRROR';
    } else if (azimuthDeg >= 55 && azimuthDeg <= 125) {
      targetProxy = 'RIGHT_MIRROR';
    } else if (Math.abs(azimuthDeg) >= 135) {
      targetProxy = 'REAR_MIRROR';
    } else if (Math.abs(azimuthDeg) <= 35) {
      targetProxy = 'FRONT_WINDSHIELD';
    } else if (azimuthDeg < -35 && azimuthDeg > -55) {
      targetProxy = 'LEFT_FORWARD';
    } else if (azimuthDeg > 35 && azimuthDeg < 55) {
      targetProxy = 'RIGHT_FORWARD';
    } else {
      targetProxy = 'PERIPHERAL';
    }

    // Urgency level
    let urgencyLevel = 'SAFE';
    if (distance <= 7.0) {
      urgencyLevel = 'CRITICAL';
    } else if (distance <= 15.0) {
      urgencyLevel = 'WARNING';
    } else if (distance <= 30.0) {
      urgencyLevel = 'AWARENESS';
    }

    // Audio coordinates (Web Audio listener space):
    // audioX = right (+X), left (-X)
    // audioY = up (+Y)
    // audioZ = rear (+Z), front (-Z)
    const audioX = x;
    const audioY = z;
    const audioZ = -y;

    return {
      distance: parseFloat(distance.toFixed(2)),
      azimuthDeg: parseFloat(azimuthDeg.toFixed(1)),
      targetProxy,
      urgencyLevel,
      audioX,
      audioY,
      audioZ
    };
  }

  /**
   * Adds or updates a threat
   */
  upsertThreat(threatData) {
    const metrics = this.calculateThreatMetrics(threatData.x, threatData.y, threatData.z || 0.2);
    const existingIndex = this.threats.findIndex(t => t.id === threatData.id);

    const threat = {
      id: threatData.id || 1,
      type: threatData.type || 'vehicle',
      x: threatData.x,
      y: threatData.y,
      z: threatData.z || 0.2,
      vx: threatData.vx || 0,
      vy: threatData.vy || 0,
      active: threatData.active !== undefined ? threatData.active : true,
      label: threatData.label || 'Vehicle',
      ...metrics
    };

    if (existingIndex >= 0) {
      this.threats[existingIndex] = threat;
    } else {
      this.threats.push(threat);
    }

    if (!this.selectedThreatId) {
      this.selectedThreatId = threat.id;
    }

    if (this.onThreatUpdated) {
      this.onThreatUpdated(this.threats);
    }

    return threat;
  }

  getPrimaryThreat() {
    if (this.threats.length === 0) return null;
    if (this.selectedThreatId) {
      const selected = this.threats.find(t => t.id === this.selectedThreatId && t.active);
      if (selected) return selected;
    }
    // Return closest active threat
    const active = this.threats.filter(t => t.active);
    if (active.length === 0) return null;
    return active.reduce((closest, t) => t.distance < closest.distance ? t : closest, active[0]);
  }

  clearThreats() {
    this.threats = [];
    this.selectedThreatId = null;
    if (this.onThreatUpdated) this.onThreatUpdated(this.threats);
  }

  /**
   * Loads pre-programmed ADAS test scenarios
   */
  loadScenario(scenarioName) {
    this.activeScenario = scenarioName;
    this.scenarioTime = 0;
    this.clearThreats();

    switch (scenarioName) {
      case 'BLIND_SPOT_LEFT':
        this.upsertThreat({
          id: 1,
          label: 'Overtaking Sedan',
          type: 'car',
          x: -3.5, // Adjacent left lane
          y: -14.0, // Approaching from behind
          vy: 6.5,  // Closing speed ~23 km/h
          active: true
        });
        break;

      case 'BLIND_SPOT_RIGHT':
        this.upsertThreat({
          id: 2,
          label: 'Blind Spot SUV',
          type: 'suv',
          x: 3.5,  // Adjacent right lane
          y: -6.0, // Lingering in right mirror blind zone
          vy: 0.5,
          active: true
        });
        break;

      case 'REAR_TAILGATER':
        this.upsertThreat({
          id: 3,
          label: 'Fast Tailgater',
          type: 'car',
          x: 0.0,
          y: -28.0, // Directly behind
          vy: 9.0,  // Fast closing speed
          active: true
        });
        break;

      case 'FRONT_CUT_IN':
        this.upsertThreat({
          id: 4,
          label: 'Lead Vehicle Braking',
          type: 'truck',
          x: 1.2,
          y: 20.0, // Forward ahead
          vy: -5.0, // Rapid deceleration
          active: true
        });
        break;

      case 'ORBIT_360':
        this.upsertThreat({
          id: 5,
          label: 'Circling Hazard',
          type: 'motorcycle',
          x: 0,
          y: 8,
          active: true
        });
        break;

      case 'MANUAL':
      default:
        this.upsertThreat({
          id: 1,
          label: 'Threat 1 (Drag Me)',
          type: 'car',
          x: -3.5,
          y: -4.0,
          active: true
        });
        break;
    }
  }

  /**
   * Physics / trajectory tick for animated scenarios
   * @param {number} dt - Delta time in seconds
   */
  tick(dt) {
    if (this.activeScenario === 'NONE' || this.activeScenario === 'MANUAL') return;

    this.scenarioTime += dt;

    if (this.activeScenario === 'ORBIT_360') {
      const threat = this.threats.find(t => t.id === 5);
      if (threat) {
        const radius = 8.5; // 8.5 meters
        const angularSpeed = 0.55; // rad/sec (~11.4 sec per full 360° circle)
        const angle = this.scenarioTime * angularSpeed;
        
        // Circular orbit
        threat.x = Math.sin(angle) * radius;
        threat.y = Math.cos(angle) * radius;

        const metrics = this.calculateThreatMetrics(threat.x, threat.y, threat.z);
        Object.assign(threat, metrics);
      }
    } else {
      // Linear trajectories with bouncing / looping
      this.threats.forEach(t => {
        if (!t.active) return;

        if (this.activeScenario === 'BLIND_SPOT_LEFT') {
          t.y += t.vy * dt;
          if (t.y > 6.0) t.y = -18.0; // Loop approach
        } else if (this.activeScenario === 'REAR_TAILGATER') {
          t.y += t.vy * dt;
          if (t.y > -4.5) t.y = -30.0; // Loop approach
        } else if (this.activeScenario === 'FRONT_CUT_IN') {
          t.y += t.vy * dt;
          if (t.y < 4.0) t.vy = 4.0;
          if (t.y > 22.0) t.vy = -5.0;
        }

        const metrics = this.calculateThreatMetrics(t.x, t.y, t.z);
        Object.assign(t, metrics);
      });
    }

    if (this.onThreatUpdated) {
      this.onThreatUpdated(this.threats);
    }
  }
}
