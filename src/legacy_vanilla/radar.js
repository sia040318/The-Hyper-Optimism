/**
 * 60 FPS Automotive Top-Down Radar Display
 * Renders ego-vehicle, surrounding obstacles, proxy mirror cones,
 * distance range rings, and acoustic wave propagation.
 */

export class RadarDisplay {
  constructor(canvas, threatManager, onThreatMoved) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.threatManager = threatManager;
    this.onThreatMoved = onThreatMoved;

    // Viewport & Scale
    this.scale = 11; // pixels per meter (covers ~32m radius)
    this.centerX = 0;
    this.centerY = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = window.devicePixelRatio || 1;

    // Drag & Interaction State
    this.draggedThreat = null;
    this.isDragging = false;
    this.hoveredThreat = null;

    // Acoustic Ripple Animation
    this.ripples = [];
    this.lastRippleTime = 0;

    // Active Mirror Highlights
    this.activeMirrorZone = null;
    this.gazeDirection = 'CENTER';

    this.initCanvas();
    this.setupEventListeners();
  }

  initCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 600;
    this.height = rect.height || 600;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);

    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
  }

  resize() {
    this.initCanvas();
  }

  setupEventListeners() {
    const getPosFromEvent = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      // Convert canvas pixels to relative meters:
      // x: right (+), left (-)
      // y: forward (+, up on screen), rear (-, down on screen)
      const relX = (mouseX - this.centerX) / this.scale;
      const relY = -(mouseY - this.centerY) / this.scale;
      return { relX, relY, mouseX, mouseY };
    };

    this.canvas.addEventListener('mousedown', (e) => {
      const { relX, relY } = getPosFromEvent(e);
      // Check if clicking near any existing threat
      const threat = this.threatManager.threats.find(t => {
        const dx = t.x - relX;
        const dy = t.y - relY;
        return Math.sqrt(dx * dx + dy * dy) < 2.0; // 2 meter click radius
      });

      if (threat) {
        this.draggedThreat = threat;
        this.threatManager.selectedThreatId = threat.id;
        this.isDragging = true;
      } else {
        // Place or move primary threat
        const primary = this.threatManager.getPrimaryThreat() || this.threatManager.upsertThreat({
          id: 1,
          type: 'car',
          x: relX,
          y: relY,
          active: true
        });
        primary.x = parseFloat(relX.toFixed(2));
        primary.y = parseFloat(relY.toFixed(2));
        this.threatManager.selectedThreatId = primary.id;
        this.draggedThreat = primary;
        this.isDragging = true;
        if (this.onThreatMoved) this.onThreatMoved(primary);
      }
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isDragging && this.draggedThreat) {
        const relX = (mouseX - this.centerX) / this.scale;
        const relY = -(mouseY - this.centerY) / this.scale;
        this.draggedThreat.x = parseFloat(relX.toFixed(2));
        this.draggedThreat.y = parseFloat(relY.toFixed(2));
        const metrics = this.threatManager.calculateThreatMetrics(this.draggedThreat.x, this.draggedThreat.y);
        Object.assign(this.draggedThreat, metrics);
        if (this.onThreatMoved) this.onThreatMoved(this.draggedThreat);
      } else if (mouseX >= 0 && mouseX <= this.width && mouseY >= 0 && mouseY <= this.height) {
        const relX = (mouseX - this.centerX) / this.scale;
        const relY = -(mouseY - this.centerY) / this.scale;
        this.hoveredThreat = this.threatManager.threats.find(t => {
          const dx = t.x - relX;
          const dy = t.y - relY;
          return Math.sqrt(dx * dx + dy * dy) < 2.0;
        });
        this.canvas.style.cursor = this.hoveredThreat ? 'grab' : 'crosshair';
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.draggedThreat = null;
      this.canvas.style.cursor = 'crosshair';
    });
  }

  setGazeDirection(zone) {
    this.gazeDirection = zone;
  }

  emitSoundRipple(threat) {
    if (!threat) return;
    this.ripples.push({
      x: threat.x,
      y: threat.y,
      radius: 0.5,
      maxRadius: threat.distance || 15,
      alpha: 0.85,
      urgency: threat.urgencyLevel
    });
  }

  render(timestamp) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Draw Background Grid & Radar Sweep Glow
    this.drawRadarBackground(ctx);

    // 2. Draw Distance Range Rings & Grid Coordinates
    this.drawRangeRings(ctx);

    // 3. Draw Mirror Proxy FOV Sectors
    this.drawMirrorProxyZones(ctx);

    // 4. Draw Sound Wave Ripples
    this.drawSoundRipples(ctx);

    // 5. Draw Ego Vehicle (Center)
    this.drawEgoVehicle(ctx);

    // 6. Draw Surrounding Threat Vehicles
    this.drawThreats(ctx);

    // 7. Draw Driver Gaze Indicator
    this.drawGazeOverlay(ctx);
  }

  drawRadarBackground(ctx) {
    // Subtle circular gradient
    const bgGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 10,
      this.centerX, this.centerY, this.width * 0.48
    );
    bgGrad.addColorStop(0, 'rgba(11, 19, 34, 0.95)');
    bgGrad.addColorStop(0.7, 'rgba(7, 12, 22, 0.98)');
    bgGrad.addColorStop(1, 'rgba(3, 6, 12, 1.0)');

    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Crosshairs
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical (Forward-Rear)
    ctx.moveTo(this.centerX, 20);
    ctx.lineTo(this.centerX, this.height - 20);
    // Horizontal (Left-Right)
    ctx.moveTo(20, this.centerY);
    ctx.lineTo(this.width - 20, this.centerY);
    ctx.stroke();
  }

  drawRangeRings(ctx) {
    const rings = [
      { meters: 5, color: 'rgba(239, 68, 68, 0.35)', dash: [4, 4], label: '5m CRITICAL' },
      { meters: 15, color: 'rgba(245, 158, 11, 0.30)', dash: [6, 6], label: '15m WARNING' },
      { meters: 25, color: 'rgba(56, 189, 248, 0.22)', dash: [], label: '25m AWARENESS' },
      { meters: 32, color: 'rgba(255, 255, 255, 0.12)', dash: [], label: '32m' }
    ];

    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    rings.forEach(r => {
      const radiusPx = r.meters * this.scale;
      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, radiusPx, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash(r.dash);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = r.color;
      ctx.fillText(r.label, this.centerX + 6, this.centerY - radiusPx - 3);
    });
  }

  drawMirrorProxyZones(ctx) {
    const primary = this.threatManager.getPrimaryThreat();
    const activeProxy = primary && primary.active ? primary.targetProxy : 'NONE';

    // Sector definitions in standard mathematical angles (where 0 is +X right, 90 is -Y up/forward):
    // Forward Windshield: -30° to +30° azimuth (approx 60° to 120° on screen)
    // Left Mirror: -125° to -55° azimuth (approx 145° to 215° on screen)
    // Right Mirror: 55° to 125° azimuth (approx -35° to 35° on screen)
    // Rear Mirror: |azimuth| > 135° (approx 225° to 315° on screen)

    const zones = [
      { id: 'LEFT_MIRROR', startAngle: Math.PI * 0.80, endAngle: Math.PI * 1.20, label: 'LEFT MIRROR', color: 'rgba(59, 130, 246, ' },
      { id: 'RIGHT_MIRROR', startAngle: -Math.PI * 0.20, endAngle: Math.PI * 0.20, label: 'RIGHT MIRROR', color: 'rgba(59, 130, 246, ' },
      { id: 'REAR_MIRROR', startAngle: Math.PI * 0.25, endAngle: Math.PI * 0.75, label: 'REAR-VIEW MIRROR', color: 'rgba(168, 85, 247, ' },
      { id: 'FRONT_WINDSHIELD', startAngle: -Math.PI * 0.75, endAngle: -Math.PI * 0.25, label: 'FRONT WINDSHIELD', color: 'rgba(34, 197, 94, ' }
    ];

    const outerRadius = 30 * this.scale;
    const innerRadius = 3.5 * this.scale;

    zones.forEach(z => {
      const isActive = activeProxy === z.id;
      const alpha = isActive ? '0.18)' : '0.04)';
      const strokeAlpha = isActive ? '0.75)' : '0.15)';

      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, outerRadius, z.startAngle, z.endAngle);
      ctx.arc(this.centerX, this.centerY, innerRadius, z.endAngle, z.startAngle, true);
      ctx.closePath();

      ctx.fillStyle = z.color + alpha;
      ctx.fill();

      ctx.strokeStyle = z.color + strokeAlpha;
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.stroke();

      // Zone Label
      const midAngle = (z.startAngle + z.endAngle) / 2;
      const labelDist = 27 * this.scale;
      const lx = this.centerX + Math.cos(midAngle) * labelDist;
      const ly = this.centerY + Math.sin(midAngle) * labelDist;

      ctx.font = isActive ? 'bold 11px monospace' : '10px monospace';
      ctx.fillStyle = isActive ? '#38bdf8' : 'rgba(255, 255, 255, 0.3)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.label, lx, ly);
    });
  }

  drawSoundRipples(ctx) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rip = this.ripples[i];
      rip.radius += 0.45;
      rip.alpha -= 0.022;

      if (rip.alpha <= 0 || rip.radius >= rip.maxRadius + 4) {
        this.ripples.splice(i, 1);
        continue;
      }

      const ripPxX = this.centerX + rip.x * this.scale;
      const ripPxY = this.centerY - rip.y * this.scale;
      const radiusPx = rip.radius * this.scale;

      ctx.beginPath();
      ctx.arc(ripPxX, ripPxY, radiusPx, 0, Math.PI * 2);
      ctx.strokeStyle = rip.urgency === 'CRITICAL'
        ? `rgba(239, 68, 68, ${rip.alpha})`
        : (rip.urgency === 'WARNING'
            ? `rgba(245, 158, 11, ${rip.alpha})`
            : `rgba(56, 189, 248, ${rip.alpha})`);
      ctx.lineWidth = 2.0;
      ctx.stroke();
    }
  }

  drawEgoVehicle(ctx) {
    ctx.save();
    ctx.translate(this.centerX, this.centerY);

    // Car Dimensions in Meters: Width 1.9m, Length 4.5m
    const carW = 1.9 * this.scale;
    const carL = 4.5 * this.scale;

    // Headlight Beams (Forward)
    const headlightGrad = ctx.createLinearGradient(0, -carL / 2, 0, -carL * 2.2);
    headlightGrad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
    headlightGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.fillStyle = headlightGrad;
    ctx.beginPath();
    ctx.moveTo(-carW * 0.4, -carL * 0.45);
    ctx.lineTo(-carW * 1.6, -carL * 2.0);
    ctx.lineTo(carW * 1.6, -carL * 2.0);
    ctx.lineTo(carW * 0.4, -carL * 0.45);
    ctx.closePath();
    ctx.fill();

    // Chassis Shadow / Glow
    ctx.shadowColor = 'rgba(56, 189, 248, 0.35)';
    ctx.shadowBlur = 12;

    // Car Body
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.0;
    this.drawRoundedRect(ctx, -carW / 2, -carL / 2, carW, carL, carW * 0.25);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0; // reset

    // Windshield (Front)
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.2;
    this.drawRoundedRect(ctx, -carW * 0.38, -carL * 0.32, carW * 0.76, carL * 0.22, 3);
    ctx.fill();
    ctx.stroke();

    // Rear Window
    this.drawRoundedRect(ctx, -carW * 0.36, carL * 0.18, carW * 0.72, carL * 0.16, 2);
    ctx.fill();
    ctx.stroke();

    // Side Mirrors
    ctx.fillStyle = '#38bdf8';
    // Left Mirror
    ctx.fillRect(-carW / 2 - 4, -carL * 0.24, 4, 7);
    // Right Mirror
    ctx.fillRect(carW / 2, -carL * 0.24, 4, 7);

    // Driver's Head & Listener Center Point (0, 0 in audio space)
    ctx.beginPath();
    ctx.arc(-carW * 0.16, -carL * 0.05, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Direction arrow on driver
    ctx.beginPath();
    ctx.moveTo(-carW * 0.16, -carL * 0.05 - 8);
    ctx.lineTo(-carW * 0.16 - 3, -carL * 0.05 - 3);
    ctx.lineTo(-carW * 0.16 + 3, -carL * 0.05 - 3);
    ctx.closePath();
    ctx.fillStyle = '#38bdf8';
    ctx.fill();

    ctx.restore();
  }

  drawThreats(ctx) {
    this.threatManager.threats.forEach(t => {
      if (!t.active) return;

      const px = this.centerX + t.x * this.scale;
      const py = this.centerY - t.y * this.scale;
      const isSelected = this.threatManager.selectedThreatId === t.id;

      ctx.save();
      ctx.translate(px, py);

      // Threat Dimensions
      const w = 1.8 * this.scale;
      const l = 4.2 * this.scale;

      // Color based on Urgency
      let threatColor = '#38bdf8'; // Blue (Awareness)
      let glowColor = 'rgba(56, 189, 248, 0.4)';
      if (t.urgencyLevel === 'CRITICAL') {
        threatColor = '#ef4444'; // Red
        glowColor = 'rgba(239, 68, 68, 0.6)';
      } else if (t.urgencyLevel === 'WARNING') {
        threatColor = '#f59e0b'; // Amber
        glowColor = 'rgba(245, 158, 11, 0.5)';
      }

      // Selection Halo
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(w, l) * 0.75 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = threatColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Vehicle Body
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#1e1e2d';
      ctx.strokeStyle = threatColor;
      ctx.lineWidth = 2.0;
      this.drawRoundedRect(ctx, -w / 2, -l / 2, w, l, 4);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Label & Distance Tag
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(`${t.distance}m`, 0, l / 2 + 13);
      ctx.font = '9px monospace';
      ctx.fillStyle = threatColor;
      ctx.fillText(`${t.azimuthDeg > 0 ? '+' : ''}${t.azimuthDeg}°`, 0, l / 2 + 24);

      ctx.restore();
    });
  }

  drawGazeOverlay(ctx) {
    if (this.gazeDirection === 'CENTER') return;

    ctx.save();
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#22c55e';
    ctx.fillText(`DRIVER GAZE: ${this.gazeDirection} [CONFIRMED]`, 20, 30);
    ctx.restore();
  }

  drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}
