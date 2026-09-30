import * as THREE from 'three';

export type MirrorSide = 'left' | 'right' | 'rear';

export interface TrafficEvent {
  type: 'blind_spot' | 'overtaking';
  side: 'left' | 'right';
  timestamp: number;
  vehicleId: string;
}

export interface HUDStats {
  speedKmh: number;
  score: number;
  streak: number;
  distanceM: number;
  gear: string;
  activeAlert: MirrorSide | null;
  lastReactionMs: number | null;
}

export interface GameEngineOptions {
  onTrafficEvent?: (event: TrafficEvent) => void;
  onHUDUpdate?: (stats: HUDStats) => void;
}

interface NormalizedRect {
  x: number; // 0 to 1
  y: number; // 0 to 1
  width: number; // 0 to 1
  height: number; // 0 to 1
}

export class GameEngine {
  private container: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;

  private mainCamera: THREE.PerspectiveCamera;
  private leftMirrorCamera: THREE.PerspectiveCamera;
  private rightMirrorCamera: THREE.PerspectiveCamera;
  private rearMirrorCamera: THREE.PerspectiveCamera;

  private isRunning: boolean = false;
  private animationFrameId: number = 0;
  private clock: THREE.Clock;

  private onTrafficEvent?: (event: TrafficEvent) => void;
  private onHUDUpdate?: (stats: HUDStats) => void;

  private trafficCars: {
    mesh: THREE.Group;
    id: string;
    lane: number;
    zSpeed: number;
    blindSpotNotified: boolean;
    overtakingNotified: boolean;
    isAcknowledged: boolean;
  }[] = [];

  private roadGroup: THREE.Group;
  private playerCarGroup: THREE.Group;
  private steeringWheel: THREE.Group | null = null;

  // Mirror viewport sizes
  private mirrorWidthRatio = 0.26;
  private mirrorHeightRatio = 0.26;
  private timeSinceLastSpawn: number = 0;

  // Driving Physics & Gameplay State
  private playerX: number = 0;
  private playerTargetX: number = 0;
  private playerSpeed: number = 26; // m/s (~94 km/h)
  private score: number = 0;
  private streak: number = 0;
  private distanceTraveled: number = 0;
  private activeAlert: MirrorSide | null = null;
  private lastAlertTimestamp: number = 0;
  private lastReactionMs: number | null = null;
  private keysPressed: { [key: string]: boolean } = {};

  // Driver head tracking orientation
  private driverYawRad: number = 0;
  private driverPitchRad: number = 0;

  constructor(options?: GameEngineOptions) {
    this.onTrafficEvent = options?.onTrafficEvent;
    this.onHUDUpdate = options?.onHUDUpdate;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
    this.scene.fog = new THREE.Fog(0x87ceeb, 25, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.clock = new THREE.Clock();

    // Cameras
    this.mainCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.mainCamera.position.set(0, 1.2, 0); // Driver's eye position

    this.leftMirrorCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.leftMirrorCamera.position.set(-0.8, 1.0, 0);
    this.leftMirrorCamera.lookAt(-4, 1.0, 100); // Look back and left

    this.rightMirrorCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.rightMirrorCamera.position.set(0.8, 1.0, 0);
    this.rightMirrorCamera.lookAt(4, 1.0, 100); // Look back and right

    this.rearMirrorCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.rearMirrorCamera.position.set(0, 1.5, 0.2);
    this.rearMirrorCamera.lookAt(0, 1.5, 100); // Look straight back

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(100, 200, 50);
    this.scene.add(dirLight);

    // Environment & Highway
    this.roadGroup = this.createEnvironment();
    this.scene.add(this.roadGroup);

    // Player Car Interior
    this.playerCarGroup = this.createPlayerCar();
    this.scene.add(this.playerCarGroup);

    // Event Listeners
    this.handleResize = this.handleResize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
      return;
    }
    this.keysPressed[e.code] = true;
    this.keysPressed[e.key] = true;
  }

  private handleKeyUp(e: KeyboardEvent) {
    this.keysPressed[e.code] = false;
    this.keysPressed[e.key] = false;
  }

  private createEnvironment(): THREE.Group {
    const group = new THREE.Group();

    // Road (3 Lanes, 12 meters wide)
    const roadGeo = new THREE.PlaneGeometry(12, 220);
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x242424 });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    group.add(road);

    // Lane divider lines
    for (let i = -1; i <= 1; i += 2) {
      for (let j = 0; j < 22; j++) {
        const lineGeo = new THREE.PlaneGeometry(0.12, 3.5);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(i * 2.2, 0.01, -j * 10 + 60);
        group.add(line);
      }
    }

    // Roadside Grass Terrain
    const grassGeo = new THREE.PlaneGeometry(240, 240);
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.01;
    group.add(grass);

    return group;
  }

  private createPlayerCar(): THREE.Group {
    const group = new THREE.Group();

    // Dashboard
    const dashGeo = new THREE.BoxGeometry(2.4, 0.55, 1.1);
    const dashMat = new THREE.MeshLambertMaterial({ color: 0x282c34 });
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.position.set(0, 0.6, -0.9);
    group.add(dash);

    // Instrument Cluster Display Screen
    const clusterGeo = new THREE.PlaneGeometry(0.6, 0.25);
    const clusterMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const cluster = new THREE.Mesh(clusterGeo, clusterMat);
    cluster.position.set(0, 0.72, -0.75);
    cluster.rotation.x = -0.3;
    group.add(cluster);

    // Front Hood
    const hoodGeo = new THREE.BoxGeometry(2.2, 0.12, 2.2);
    const hoodMat = new THREE.MeshLambertMaterial({ color: 0x1e3a8a }); // Metallic Navy
    const hood = new THREE.Mesh(hoodGeo, hoodMat);
    hood.position.set(0, 0.45, -2.4);
    group.add(hood);

    // Steering wheel group
    const wheelGroup = new THREE.Group();
    const wheelMat = new THREE.MeshBasicMaterial({ color: 0x18181b });

    // Ring
    const ringGeo = new THREE.TorusGeometry(0.2, 0.032, 16, 36);
    const ring = new THREE.Mesh(ringGeo, wheelMat);
    wheelGroup.add(ring);

    // Hub
    const hubGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.06, 16);
    const hub = new THREE.Mesh(hubGeo, wheelMat);
    hub.rotation.x = Math.PI / 2;
    wheelGroup.add(hub);

    // Spokes
    const spokeGeo = new THREE.BoxGeometry(0.4, 0.022, 0.022);
    const spoke = new THREE.Mesh(spokeGeo, wheelMat);
    wheelGroup.add(spoke);

    const spokeVertGeo = new THREE.BoxGeometry(0.022, 0.2, 0.022);
    const spokeVert = new THREE.Mesh(spokeVertGeo, wheelMat);
    spokeVert.position.y = -0.1;
    wheelGroup.add(spokeVert);

    // Position and tilt back toward driver
    wheelGroup.position.set(0, 0.68, -0.62);
    wheelGroup.rotation.x = -Math.PI * (65 / 180);

    group.add(wheelGroup);
    this.steeringWheel = wheelGroup;

    return group;
  }

  private createTrafficCar(lane: number, initialZ: number): THREE.Group {
    const carGroup = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.7, 3.8);
    const brightColors = [0xef4444, 0xf59e0b, 0x3b82f6, 0x8b5cf6, 0xec4899, 0x06b6d4];
    const color = brightColors[Math.floor(Math.random() * brightColors.length)];
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.45;
    carGroup.add(body);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.4, 0.5, 2.0);
    const cabinMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.95, 0);
    carGroup.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 16);
    const wheelMat = new THREE.MeshBasicMaterial({ color: 0x09090b });
    const wheelPositions = [
      [-0.85, 0.32, -1.2],
      [0.85, 0.32, -1.2],
      [-0.85, 0.32, 1.2],
      [0.85, 0.32, 1.2]
    ];
    wheelPositions.forEach((pos) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos[0], pos[1], pos[2]);
      carGroup.add(wheel);
    });

    carGroup.position.set(lane * 4, 0, initialZ);
    this.scene.add(carGroup);
    return carGroup;
  }

  private spawnCar() {
    // Left (-1) or right (+1) relative lane
    const lanes = [-1, 1];
    const lane = lanes[Math.floor(Math.random() * lanes.length)];
    const speed = this.playerSpeed + 6 + Math.random() * 6; // Overtaking speed relative to player
    const spawnZ = 75; // Behind the player
    const car = this.createTrafficCar(lane, spawnZ);

    this.trafficCars.push({
      mesh: car,
      id: Math.random().toString(36).substring(7),
      lane,
      zSpeed: speed,
      blindSpotNotified: false,
      overtakingNotified: false,
      isAcknowledged: false
    });
  }

  public mount(element: HTMLElement) {
    this.container = element;
    this.container.appendChild(this.renderer.domElement);
    this.handleResize();
  }

  public unmount() {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);

    if (this.container && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.loop();
  }

  public pause() {
    this.isRunning = false;
    cancelAnimationFrame(this.animationFrameId);
    this.clock.stop();
  }

  public reset() {
    this.trafficCars.forEach((car) => this.scene.remove(car.mesh));
    this.trafficCars = [];
    this.score = 0;
    this.streak = 0;
    this.distanceTraveled = 0;
    this.playerX = 0;
    this.playerTargetX = 0;
    this.activeAlert = null;
  }

  public updateDriverHeadPose(yawDeg: number, pitchDeg: number) {
    // Gently rotate the main cockpit camera as driver turns head
    this.driverYawRad = (-yawDeg * Math.PI) / 180;
    this.driverPitchRad = (pitchDeg * Math.PI) / 180;
  }

  public notifyMirrorCheck(side: MirrorSide) {
    // If the checked mirror matches the active alert, calculate reaction time and reward
    if (this.activeAlert === side) {
      const reactionTime = Math.round(performance.now() - this.lastAlertTimestamp);
      this.lastReactionMs = reactionTime;
      this.score += Math.max(80, 350 - Math.round(reactionTime / 10));
      this.streak += 1;
      this.activeAlert = null;
    }

    // Acknowledge corresponding threat cars and turn them emerald green
    this.trafficCars.forEach((car) => {
      if (!car.isAcknowledged && (car.blindSpotNotified || car.overtakingNotified)) {
        if ((side === 'left' && car.lane < 0) || (side === 'right' && car.lane > 0)) {
          car.isAcknowledged = true;
          const bodyMesh = car.mesh.children[0] as THREE.Mesh;
          (bodyMesh.material as THREE.MeshLambertMaterial).color.setHex(0x10b981);
        }
      }
    });
  }

  public getMirrorRegions(): Record<MirrorSide, NormalizedRect> {
    return {
      left: { x: 0, y: 0.4, width: this.mirrorWidthRatio, height: this.mirrorHeightRatio },
      right: { x: 1 - this.mirrorWidthRatio, y: 0.4, width: this.mirrorWidthRatio, height: this.mirrorHeightRatio },
      rear: { x: 0.5 - this.mirrorWidthRatio / 2, y: 0, width: this.mirrorWidthRatio, height: this.mirrorHeightRatio }
    };
  }

  private handleResize() {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.renderer.setSize(w, h);

    // Main Camera
    this.mainCamera.aspect = w / h;
    this.mainCamera.updateProjectionMatrix();

    // Mirror aspect ratios
    const mw = w * this.mirrorWidthRatio;
    const mh = h * this.mirrorHeightRatio;
    const aspect = mw / mh;

    this.leftMirrorCamera.aspect = aspect;
    this.leftMirrorCamera.updateProjectionMatrix();

    this.rightMirrorCamera.aspect = aspect;
    this.rightMirrorCamera.updateProjectionMatrix();

    this.rearMirrorCamera.aspect = aspect;
    this.rearMirrorCamera.updateProjectionMatrix();
  }

  private renderMirrorWithBorder(
    x: number,
    y: number,
    w: number,
    h: number,
    camera: THREE.Camera,
    borderColor: number = 0x222222
  ) {
    this.renderer.setViewport(x, y, w, h);
    this.renderer.setScissor(x, y, w, h);
    this.renderer.setClearColor(borderColor);
    this.renderer.clear();

    const border = 4;
    this.renderer.setViewport(x + border, y + border, w - border * 2, h - border * 2);
    this.renderer.setScissor(x + border, y + border, w - border * 2, h - border * 2);
    this.renderer.setClearColor(0x87ceeb);
    this.renderer.render(this.scene, camera);
  }

  private renderMirrors(w: number, h: number) {
    const mw = w * this.mirrorWidthRatio;
    const mh = h * this.mirrorHeightRatio;

    // Render Main Driving View
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.setClearColor(0x87ceeb);
    this.renderer.render(this.scene, this.mainCamera);

    this.renderer.setScissorTest(true);

    // Border highlights when alert is active
    const isLeftAlert = this.activeAlert === 'left';
    const isRightAlert = this.activeAlert === 'right';
    const isRearAlert = this.activeAlert === 'rear';

    const alertColor = (Math.floor(Date.now() / 250) % 2 === 0) ? 0xef4444 : 0xf59e0b;

    // Left Mirror (Left edge)
    const lx = 0;
    const ly = h * 0.4;
    this.renderMirrorWithBorder(lx, ly, mw, mh, this.leftMirrorCamera, isLeftAlert ? alertColor : 0x1f2937);

    // Right Mirror (Right edge)
    const rx = w - mw;
    const ry = h * 0.4;
    this.renderMirrorWithBorder(rx, ry, mw, mh, this.rightMirrorCamera, isRightAlert ? alertColor : 0x1f2937);

    // Rear Mirror (Top center)
    const cx = (w - mw) / 2;
    const cy = h - mh;
    this.renderMirrorWithBorder(cx, cy, mw, mh, this.rearMirrorCamera, isRearAlert ? alertColor : 0x1f2937);

    this.renderer.setScissorTest(false);
  }

  private loop = () => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.loop);
    const delta = Math.min(0.1, this.clock.getDelta());

    // 1. Steering Physics (A / D / Arrow Keys)
    const isSteerLeft = this.keysPressed['KeyA'] || this.keysPressed['ArrowLeft'] || this.keysPressed['a'] || this.keysPressed['A'];
    const isSteerRight = this.keysPressed['KeyD'] || this.keysPressed['ArrowRight'] || this.keysPressed['d'] || this.keysPressed['D'];
    const isThrottle = this.keysPressed['KeyW'] || this.keysPressed['ArrowUp'] || this.keysPressed['w'] || this.keysPressed['W'];
    const isBrake = this.keysPressed['KeyS'] || this.keysPressed['ArrowDown'] || this.keysPressed['s'] || this.keysPressed['S'];

    if (isSteerLeft) {
      this.playerTargetX -= 9.5 * delta;
    }
    if (isSteerRight) {
      this.playerTargetX += 9.5 * delta;
    }
    this.playerTargetX = Math.max(-4.2, Math.min(4.2, this.playerTargetX));

    // Smooth lateral car position easing
    this.playerX += (this.playerTargetX - this.playerX) * Math.min(1.0, 10.0 * delta);

    // Rotate Steering Wheel smoothly
    const wheelTargetAngle = (this.playerTargetX - this.playerX) * 1.8;
    if (this.steeringWheel) {
      this.steeringWheel.rotation.z = -wheelTargetAngle;
    }

    // 2. Throttle and Braking Physics
    if (isThrottle) {
      this.playerSpeed = Math.min(38.0, this.playerSpeed + 16.0 * delta); // up to ~137 km/h
    } else if (isBrake) {
      this.playerSpeed = Math.max(10.0, this.playerSpeed - 24.0 * delta); // down to ~36 km/h
    } else {
      // Return gently to cruising speed (26 m/s ~ 94 km/h)
      this.playerSpeed += (26.0 - this.playerSpeed) * 2.0 * delta;
    }

    // Accumulate distance & score
    this.distanceTraveled += this.playerSpeed * delta;
    this.score += Math.round(this.playerSpeed * delta * 0.5);

    // 3. Move Highway Lines to reflect player velocity
    this.roadGroup.children.forEach((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.geometry instanceof THREE.PlaneGeometry &&
        child.scale.y === 1 &&
        child.position.x !== 0 &&
        child.position.y > 0
      ) {
        child.position.z += this.playerSpeed * delta;
        if (child.position.z > 60) {
          child.position.z -= 110;
        }
      }
    });

    // 4. Update Player Vehicle and Cameras with Lateral Movement
    this.playerCarGroup.position.x = this.playerX;
    this.mainCamera.position.x = this.playerX;

    // Apply driver head-pose gaze tilt to main camera
    this.mainCamera.rotation.y = this.driverYawRad * 0.45;
    this.mainCamera.rotation.x = this.driverPitchRad * 0.35;

    // Mirrors follow car position
    this.leftMirrorCamera.position.x = this.playerX - 0.8;
    this.rightMirrorCamera.position.x = this.playerX + 0.8;
    this.rearMirrorCamera.position.x = this.playerX;

    // 5. Traffic Spawning and Dynamics
    this.timeSinceLastSpawn += delta;
    if (this.timeSinceLastSpawn > 9 || (this.timeSinceLastSpawn > 2.5 && Math.random() < 0.005)) {
      this.spawnCar();
      this.timeSinceLastSpawn = 0;
    }

    for (let i = this.trafficCars.length - 1; i >= 0; i--) {
      const car = this.trafficCars[i];
      // Car moves forward relative to player
      const relativeSpeed = car.zSpeed - this.playerSpeed;
      car.mesh.position.z -= relativeSpeed * delta;

      // Blind spot detection: car is overtaking alongside player (z between 0 and 12)
      if (!car.blindSpotNotified && car.mesh.position.z < 12 && car.mesh.position.z > -2) {
        car.blindSpotNotified = true;
        const side: MirrorSide = car.lane < 0 ? 'left' : 'right';
        this.activeAlert = side;
        this.lastAlertTimestamp = performance.now();

        if (this.onTrafficEvent) {
          this.onTrafficEvent({
            type: 'blind_spot',
            side,
            timestamp: Date.now(),
            vehicleId: car.id
          });
        }
      }

      // Despawn vehicles once far ahead
      if (car.mesh.position.z < -100) {
        this.scene.remove(car.mesh);
        this.trafficCars.splice(i, 1);
      }
    }

    // 6. Push Live HUD Telemetry
    if (this.onHUDUpdate) {
      const speedKmh = Math.round(this.playerSpeed * 3.6);
      let gear = 'D4';
      if (speedKmh > 115) gear = 'D6';
      else if (speedKmh > 95) gear = 'D5';
      else if (speedKmh < 60) gear = 'D3';

      this.onHUDUpdate({
        speedKmh,
        score: this.score,
        streak: this.streak,
        distanceM: Math.round(this.distanceTraveled),
        gear,
        activeAlert: this.activeAlert,
        lastReactionMs: this.lastReactionMs
      });
    }

    // 7. Render
    if (this.container) {
      this.renderMirrors(this.container.clientWidth, this.container.clientHeight);
    }
  };
}
