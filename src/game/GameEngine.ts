import * as THREE from 'three';
import { ThreatObstacle, ScenarioType, ProxyTarget } from '../types/threats';
import { calculateAzimuth, calculateDistance } from '../utils/threatScenarios';

export type MirrorSide = 'left' | 'right' | 'rear';
export type CameraMode = 'cockpit' | 'chase' | 'hood';
export type TrafficVehicleType = 'sedan' | 'suv' | 'truck' | 'sport';

export interface TrafficEvent {
  type: 'blind_spot' | 'overtaking' | 'tailgater' | 'front_hazard';
  side: MirrorSide | 'front';
  timestamp: number;
  vehicleId: string;
}

export interface CollisionEvent {
  vehicleId: string;
  relativeSpeedKmh: number;
  damagePercent: number;
  timestamp: number;
}

export interface HUDStats {
  speedKmh: number;
  rpm: number;
  score: number;
  streak: number;
  distanceM: number;
  gear: string;
  activeAlert: MirrorSide | null;
  activeFrontWarning: boolean;
  lastReactionMs: number | null;
  collisionWarning: boolean;
  damage: number;
  cameraMode: CameraMode;
  autoPilot: boolean;
  currentLane: number;
  threatDistanceM: number | null;
  threatClosingKmh: number | null;
}

export interface GameEngineOptions {
  onTrafficEvent?: (event: TrafficEvent) => void;
  onCollisionEvent?: (event: CollisionEvent) => void;
  onHUDUpdate?: (stats: HUDStats) => void;
  onThreatsUpdate?: (threats: ThreatObstacle[]) => void;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SparkParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

interface TrafficCarData {
  mesh: THREE.Group;
  id: string;
  name: string;
  type: TrafficVehicleType;
  laneIndex: number; // 0, 1, 2, 3 corresponding to LANE_CENTERS
  targetLaneIndex: number;
  currentX: number;
  isChangingLane: boolean;
  zSpeed: number;
  baseSpeed: number;
  length: number;
  width: number;
  originalColor: number;
  bodyMesh: THREE.Mesh;
  hazardRing: THREE.Mesh;
  blindSpotNotified: boolean;
  tailgateNotified: boolean;
  isAcknowledged: boolean;
  leftBlinker?: THREE.Mesh;
  rightBlinker?: THREE.Mesh;
  taillights: THREE.Mesh[];
  headlights: THREE.Mesh[];
  wheels: THREE.Mesh[];
  role: 'overtaker' | 'blind_spot_linger' | 'tailgater' | 'cruiser' | 'cut_in';
}

// 4 Highway Lanes: Centers at -6.0m, -2.0m, +2.0m, +6.0m (each lane is 4m wide)
const LANE_CENTERS = [-6.0, -2.0, 2.0, 6.0];

export class GameEngine {
  private container: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;

  // Cameras
  private mainCamera: THREE.PerspectiveCamera;
  private chaseCamera: THREE.PerspectiveCamera;
  private hoodCamera: THREE.PerspectiveCamera;
  private leftMirrorCamera: THREE.PerspectiveCamera;
  private rightMirrorCamera: THREE.PerspectiveCamera;
  private rearMirrorCamera: THREE.PerspectiveCamera;

  private cameraMode: CameraMode = 'cockpit';
  private isRunning: boolean = false;
  private animationFrameId: number = 0;
  private clock: THREE.Clock;
  private elapsedTime: number = 0;

  // Callbacks
  private onTrafficEvent?: (event: TrafficEvent) => void;
  private onCollisionEvent?: (event: CollisionEvent) => void;
  private onHUDUpdate?: (stats: HUDStats) => void;
  private onThreatsUpdate?: (threats: ThreatObstacle[]) => void;

  // Scene entities
  private roadGroup: THREE.Group;
  private scrollingObjects: Array<{ obj: THREE.Object3D; wrapLength: number; minZ: number; maxZ: number }> = [];
  private playerCarGroup: THREE.Group;
  private cockpitInteriorGroup: THREE.Group;
  private exteriorBodyGroup: THREE.Group;
  private playerWheels: THREE.Mesh[] = [];
  private playerTaillightBar: THREE.Mesh | null = null;
  private sensorRingGroup: THREE.Group;
  private sensorZoneLeft: THREE.Mesh | null = null;
  private sensorZoneRight: THREE.Mesh | null = null;
  private sensorZoneRear: THREE.Mesh | null = null;
  private dashAmbientStrip: THREE.Mesh | null = null;

  private steeringWheel: THREE.Group | null = null;
  private clusterCanvas: HTMLCanvasElement | null = null;
  private clusterTexture: THREE.CanvasTexture | null = null;
  private clusterCtx: CanvasRenderingContext2D | null = null;

  // BSM (Blind Spot Monitor) LED indicators in mirrors
  private leftMirrorBSM: THREE.Mesh | null = null;
  private rightMirrorBSM: THREE.Mesh | null = null;

  // Traffic entities
  private trafficCars: TrafficCarData[] = [];
  private timeSinceLastSpawn: number = 0;

  // Spark Particles for collision
  private sparks: SparkParticle[] = [];
  private sparkPointsMesh: THREE.Points | null = null;
  private sparkGeo: THREE.BufferGeometry | null = null;

  // Driving Physics & Gameplay State
  private playerX: number = LANE_CENTERS[1]; // Start in Lane 2 (-2.0m)
  private playerTargetX: number = LANE_CENTERS[1];
  private playerSpeed: number = 27.78; // m/s (~100 km/h)
  private playerLateralVelocity: number = 0;
  private autoPilot: boolean = false;
  private score: number = 0;
  private streak: number = 0;
  private distanceTraveled: number = 0;
  private damage: number = 0;
  private activeAlert: MirrorSide | null = null;
  private activeFrontWarning: boolean = false;
  private lastAlertTimestamp: number = 0;
  private lastReactionMs: number | null = null;
  private collisionCooldown: number = 0;
  private keysPressed: { [key: string]: boolean } = {};

  // Camera Shake (Trauma model)
  private cameraTrauma: number = 0;

  // Driver head tracking orientation
  private driverYawRad: number = 0;
  private driverPitchRad: number = 0;
  private smoothedCameraYaw: number = 0;
  private smoothedCameraPitch: number = 0;

  // Mirror normalized regions (CSS top-left origin)
  // Left Mirror: bottom-left wing mirror
  // Right Mirror: bottom-right wing mirror
  // Rear Mirror: top-center panoramic mirror (below top HUD bar)
  private mirrorRegions: Record<MirrorSide, NormalizedRect> = {
    left: { x: 0.016, y: 0.67, width: 0.21, height: 0.18 },
    right: { x: 0.774, y: 0.67, width: 0.21, height: 0.18 },
    rear: { x: 0.34, y: 0.135, width: 0.32, height: 0.13 }
  };

  // Performance throttling
  private lastHUDUpdate: number = 0;
  private lastSentAlert: MirrorSide | null = null;

  // Audio synthesis for crashes
  private audioCtx: AudioContext | null = null;

  // Responsive layout tracking
  private resizeObserver: ResizeObserver | null = null;
  private lastRenderW: number = 0;
  private lastRenderH: number = 0;

  private handleBlur = () => {
    this.keysPressed = {};
  };

  constructor(options?: GameEngineOptions) {
    this.onTrafficEvent = options?.onTrafficEvent;
    this.onCollisionEvent = options?.onCollisionEvent;
    this.onHUDUpdate = options?.onHUDUpdate;
    this.onThreatsUpdate = options?.onThreatsUpdate;

    this.scene = new THREE.Scene();

    // 1. Deep Atmospheric Horizon Fog & Sky Dome
    this.scene.background = new THREE.Color(0x0b1021);
    this.scene.fog = new THREE.FogExp2(0x131b33, 0.0038);

    // 2. High-Performance WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.clock = new THREE.Clock();

    // 3. Driver Cockpit Camera
    this.mainCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.mainCamera.position.set(this.playerX, 1.24, 0.12);

    // 4. Third-Person Chase Camera
    this.chaseCamera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);
    this.chaseCamera.position.set(this.playerX, 3.1, 7.2);

    // 5. Hood / Bonnet ADAS Camera
    this.hoodCamera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
    this.hoodCamera.position.set(this.playerX, 1.08, -1.25);

    // 6. Cabin Mirror Viewport Cameras (Pointing backward along +Z)
    this.leftMirrorCamera = new THREE.PerspectiveCamera(38, 1.4, 0.2, 500);
    this.leftMirrorCamera.position.set(this.playerX - 1.05, 1.08, -0.35);
    this.leftMirrorCamera.lookAt(this.playerX - 3.6, 1.0, 90);

    this.rightMirrorCamera = new THREE.PerspectiveCamera(38, 1.4, 0.2, 500);
    this.rightMirrorCamera.position.set(this.playerX + 1.05, 1.08, -0.35);
    this.rightMirrorCamera.lookAt(this.playerX + 3.6, 1.0, 90);

    this.rearMirrorCamera = new THREE.PerspectiveCamera(34, 2.5, 0.5, 500);
    this.rearMirrorCamera.position.set(this.playerX, 1.42, 0.35);
    this.rearMirrorCamera.lookAt(this.playerX, 1.15, 95);

    // 7. Lighting: Crisp Twilight Sky + Golden Horizon Sun + Road Fill
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffedd5, 1.45);
    sunLight.position.set(35, 45, -200);
    this.scene.add(sunLight);

    const rearFillLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    rearFillLight.position.set(-20, 25, 140);
    this.scene.add(rearFillLight);

    // 8. Build Sky Dome, Highway Environment & Player Car
    this.createSkyDome();
    this.roadGroup = this.createEnvironment();
    this.scene.add(this.roadGroup);

    this.cockpitInteriorGroup = new THREE.Group();
    this.exteriorBodyGroup = new THREE.Group();
    this.sensorRingGroup = new THREE.Group();
    this.playerCarGroup = this.createPlayerCar();
    this.playerCarGroup.position.x = this.playerX;
    this.scene.add(this.playerCarGroup);

    // 9. Create Spark Particle System
    this.initSparkSystem();

    // 10. Spawn initial traffic so the highway feels alive immediately
    this.spawnInitialTraffic();

    // 11. Input & Window Listeners
    this.handleResize = this.handleResize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  private createSkyDome() {
    // High-res vertical twilight gradient texture on a large sphere
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 64;
    skyCanvas.height = 512;
    const ctx = skyCanvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0.0, '#040711'); // Zenith deep space
      grad.addColorStop(0.32, '#0b1536'); // Upper twilight navy
      grad.addColorStop(0.46, '#1e1b4b'); // Indigo band
      grad.addColorStop(0.51, '#7c2d12'); // Sunset horizon glow
      grad.addColorStop(0.54, '#f97316'); // Horizon rim
      grad.addColorStop(0.57, '#0f172a'); // Below horizon ground
      grad.addColorStop(1.0, '#040711');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 512);
    }
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    const skyGeo = new THREE.SphereGeometry(750, 32, 24);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTex,
      side: THREE.BackSide,
      fog: false
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(skyMesh);

    // Glowing Sunset Solar Disc on the forward horizon
    const sunGeo = new THREE.CircleGeometry(34, 48);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfdba74,
      transparent: true,
      opacity: 0.85,
      fog: false
    });
    const sunDisc = new THREE.Mesh(sunGeo, sunMat);
    sunDisc.position.set(0, 26, -580);
    this.scene.add(sunDisc);

    // Distant Horizon City Skyline Silhouette
    const skylineGroup = new THREE.Group();
    const bldgMat = new THREE.MeshBasicMaterial({ color: 0x090d1a, fog: false });
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, fog: false });
    for (let i = -38; i <= 38; i++) {
      if (Math.abs(i) < 3) continue; // Keep highway vanishing point clear
      const bw = 9 + (Math.abs(i * 7) % 10);
      const bh = 14 + (Math.abs(i * 19) % 52);
      const bldg = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 12), bldgMat);
      bldg.position.set(i * 14, bh / 2 - 2, -520 - (Math.abs(i * 13) % 40));
      skylineGroup.add(bldg);

      if (bh > 32) {
        const crown = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.7, 0.8, 12.2), windowMat);
        crown.position.set(bldg.position.x, bh - 4, bldg.position.z);
        skylineGroup.add(crown);
      }
    }
    this.scene.add(skylineGroup);
  }

  private registerScrolling(obj: THREE.Object3D, minZ: number, maxZ: number) {
    this.scrollingObjects.push({
      obj,
      wrapLength: maxZ - minZ,
      minZ,
      maxZ
    });
  }

  // --- ENVIRONMENT & 4-LANE HIGHWAY ---
  private createEnvironment(): THREE.Group {
    const group = new THREE.Group();
    this.scrollingObjects = [];

    // 1. Continuous Infinite-Look Asphalt Roadway (4 Lanes = 16m + shoulders = 18.4m wide, 900m long)
    const roadGeo = new THREE.PlaneGeometry(18.4, 900);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x161922,
      roughness: 0.78,
      metalness: 0.18
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -250);
    group.add(road);

    // Subtle darker asphalt wear tracks in the 4 lane centers (-6, -2, +2, +6)
    const trackMat = new THREE.MeshStandardMaterial({
      color: 0x11131a,
      roughness: 0.65,
      metalness: 0.22
    });
    LANE_CENTERS.forEach((cx) => {
      const track = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 900), trackMat);
      track.rotation.x = -Math.PI / 2;
      track.position.set(cx, 0.005, -250);
      group.add(track);
    });

    // 2. Continuous Yellow Outer Shoulder Lines (x = -8.0, +8.0) - NEVER teleport!
    const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    [-8.0, 8.0].forEach((sx) => {
      const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 900), yellowLineMat);
      shoulder.rotation.x = -Math.PI / 2;
      shoulder.position.set(sx, 0.015, -250);
      group.add(shoulder);
    });

    // 3. Continuous Double Metal Guardrails (x = -8.8, +8.8) - Static continuous rails!
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.28
    });
    [-8.8, 8.8].forEach((gx) => {
      const upperRail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.28, 900), railMat);
      upperRail.position.set(gx, 0.68, -250);
      group.add(upperRail);

      const lowerRail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 900), railMat);
      lowerRail.position.set(gx, 0.34, -250);
      group.add(lowerRail);
    });

    // 4. Scrolling Dashed Lane Dividers & Cat's-Eye Reflectors (Lanes separated at x = -4, 0, +4)
    const minScrollZ = -220;
    const maxScrollZ = 80;
    const stepZ = 10;
    const dashGeo = new THREE.PlaneGeometry(0.16, 4.0);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    const centerDashMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const studGeo = new THREE.BoxGeometry(0.14, 0.04, 0.22);
    const studMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    [-4.0, 0.0, 4.0].forEach((lx) => {
      for (let z = minScrollZ; z < maxScrollZ; z += stepZ) {
        const dash = new THREE.Mesh(dashGeo, lx === 0 ? centerDashMat : dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(lx, 0.018, z);
        group.add(dash);
        this.registerScrolling(dash, minScrollZ, maxScrollZ);

        // Glowing cat's eye reflector between dashes
        const stud = new THREE.Mesh(studGeo, studMat);
        stud.position.set(lx, 0.025, z + 5.0);
        group.add(stud);
        this.registerScrolling(stud, minScrollZ, maxScrollZ);
      }
    });

    // 5. Scrolling Guardrail Posts & Chevron Reflectors every 7.5m
    const postGeo = new THREE.BoxGeometry(0.14, 0.78, 0.14);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.4 });
    const reflectorGeo = new THREE.BoxGeometry(0.05, 0.16, 0.12);
    const leftRefMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const rightRefMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    for (let z = minScrollZ; z < maxScrollZ; z += 7.5) {
      [-8.85, 8.85].forEach((gx) => {
        const postGroup = new THREE.Group();
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.y = 0.39;
        postGroup.add(post);

        const ref = new THREE.Mesh(reflectorGeo, gx < 0 ? leftRefMat : rightRefMat);
        ref.position.set(gx < 0 ? 0.08 : -0.08, 0.68, 0);
        postGroup.add(ref);

        postGroup.position.set(gx, 0, z);
        group.add(postGroup);
        this.registerScrolling(postGroup, minScrollZ, maxScrollZ);
      });
    }

    // 6. Scrolling Highway LED Streetlights every 30m
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.25 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.25
    });

    for (let z = minScrollZ; z < maxScrollZ; z += 30) {
      [-10.2, 10.2].forEach((lx) => {
        const poleGroup = new THREE.Group();

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 8.2, 10), poleMat);
        pole.position.y = 4.1;
        poleGroup.add(pole);

        const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), poleMat);
        arm.position.set(lx < 0 ? 1.2 : -1.2, 8.0, 0);
        poleGroup.add(arm);

        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.36), lampMat);
        lamp.position.set(lx < 0 ? 2.2 : -2.2, 7.9, 0);
        poleGroup.add(lamp);

        const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), haloMat);
        halo.rotation.x = Math.PI / 2;
        halo.position.set(lx < 0 ? 2.2 : -2.2, 7.82, 0);
        poleGroup.add(halo);

        poleGroup.position.set(lx, 0, z);
        group.add(poleGroup);
        this.registerScrolling(poleGroup, minScrollZ, maxScrollZ);
      });
    }

    // 7. Scrolling Overhead Electronic Highway Gantries
    const gantry1 = this.createOverheadGantry(-55, 'KNU HCI ADAS LAB • 3D HRTF SPATIAL AUDIO', 'LANES 1-4 MONITORED • GAZE CANCELLATION ACTIVE');
    group.add(gantry1);
    this.registerScrolling(gantry1, minScrollZ, maxScrollZ);

    const gantry2 = this.createOverheadGantry(-175, 'CLOSED-LOOP DRIVER MONITORING ZONE', 'CHECK MIRRORS ON AUDIO CUE TO SILENCE ALERT');
    group.add(gantry2);
    this.registerScrolling(gantry2, minScrollZ, maxScrollZ);

    // 8. Surrounding Ground Terrain Plane
    const groundGeo = new THREE.PlaneGeometry(500, 900);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0b131e,
      roughness: 0.95
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -250);
    group.add(ground);

    return group;
  }

  private createOverheadGantry(zPos: number, line1: string, line2: string): THREE.Group {
    const gantryGroup = new THREE.Group();
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.35 });

    const pillarGeo = new THREE.CylinderGeometry(0.22, 0.26, 7.4, 10);
    const pLeft = new THREE.Mesh(pillarGeo, trussMat);
    pLeft.position.set(-9.6, 3.7, 0);
    gantryGroup.add(pLeft);

    const pRight = new THREE.Mesh(pillarGeo, trussMat);
    pRight.position.set(9.6, 3.7, 0);
    gantryGroup.add(pRight);

    const beam = new THREE.Mesh(new THREE.BoxGeometry(19.8, 0.55, 0.55), trussMat);
    beam.position.set(0, 7.2, 0);
    gantryGroup.add(beam);

    // High-contrast LED Matrix Highway Sign Board
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 192;
    const sCtx = signCanvas.getContext('2d');
    if (sCtx) {
      sCtx.fillStyle = '#064e3b';
      sCtx.fillRect(0, 0, 1024, 192);
      sCtx.strokeStyle = '#34d399';
      sCtx.lineWidth = 8;
      sCtx.strokeRect(8, 8, 1008, 176);

      sCtx.fillStyle = '#ffffff';
      sCtx.font = 'bold 34px "Inter", sans-serif';
      sCtx.textAlign = 'center';
      sCtx.fillText(line1, 512, 76);

      sCtx.fillStyle = '#38bdf8';
      sCtx.font = 'bold 26px "JetBrains Mono", monospace';
      sCtx.fillText(line2, 512, 134);
    }

    const signTexture = new THREE.CanvasTexture(signCanvas);
    const signMat = new THREE.MeshBasicMaterial({ map: signTexture });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 2.15), signMat);
    signMesh.position.set(0, 7.1, 0.32);
    gantryGroup.add(signMesh);

    gantryGroup.position.set(0, 0, zPos);
    return gantryGroup;
  }

  // --- PLAYER VEHICLE, 360 SENSOR FIELD & COCKPIT ---
  private createPlayerCar(): THREE.Group {
    const group = new THREE.Group();

    // =========================================================
    // A. EXTERIOR CHASSIS (Visible in Chase & Hood Cameras)
    // =========================================================
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9, // Metallic Electric Cyan-Blue
      metalness: 0.86,
      roughness: 0.18
    });
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.5,
      roughness: 0.35
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x020617,
      metalness: 0.95,
      roughness: 0.08
    });

    // Main sculpted lower body
    const bodyLower = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.54, 4.5), bodyMat);
    bodyLower.position.set(0, 0.46, -0.4);
    this.exteriorBodyGroup.add(bodyLower);

    // Side skirts
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.14, 4.3), darkTrimMat);
    skirt.position.set(0, 0.24, -0.4);
    this.exteriorBodyGroup.add(skirt);

    // Aerodynamic Hood
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.14, 1.75), bodyMat);
    hood.position.set(0, 0.72, -1.75);
    hood.rotation.x = 0.07;
    this.exteriorBodyGroup.add(hood);

    // Cabin Greenhouse (Visible in Chase Cam so car looks like a real sports coupe, hidden in Cockpit Cam)
    const cabinRoof = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.48, 2.15), glassMat);
    cabinRoof.position.set(0, 0.96, -0.2);
    this.exteriorBodyGroup.add(cabinRoof);

    // Front Headlights + Volumetric Road Light Beams
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
    [-0.76, 0.76].forEach((lx) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.1), headlightMat);
      hl.position.set(lx, 0.56, -2.66);
      this.exteriorBodyGroup.add(hl);
    });

    // Headlight Ground Projection Cone
    const beamGeo = new THREE.PlaneGeometry(3.6, 18);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.rotation.x = -Math.PI / 2;
    beamMesh.position.set(0, 0.03, -11.8);
    group.add(beamMesh);

    // Full-Width Rear LED Taillight Bar
    const tailBarMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    this.playerTaillightBar = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.14, 0.08), tailBarMat);
    this.playerTaillightBar.position.set(0, 0.62, 1.86);
    this.exteriorBodyGroup.add(this.playerTaillightBar);

    // 4 Alloy Wheels on Player Car
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.75 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.2 });
    [-1.75, 1.15].forEach((wz) => {
      [-0.98, 0.98].forEach((wx) => {
        const wheelWheelGroup = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20), tireMat);
        wheelWheelGroup.rotation.z = Math.PI / 2;
        wheelWheelGroup.position.set(wx, 0.36, wz);

        const alloy = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.27, 12), rimMat);
        wheelWheelGroup.add(alloy);

        this.exteriorBodyGroup.add(wheelWheelGroup);
        this.playerWheels.push(wheelWheelGroup);
      });
    });

    group.add(this.exteriorBodyGroup);

    // =========================================================
    // B. 360° ADAS GROUND SENSOR PROJECTION (Visible in Chase Cam)
    // =========================================================
    const ringGeo = new THREE.RingGeometry(2.7, 2.9, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });
    const baseRing = new THREE.Mesh(ringGeo, ringMat);
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.set(0, 0.04, -0.3);
    this.sensorRingGroup.add(baseRing);

    // Left Blind Spot Ground Zone Indicator
    const zoneGeo = new THREE.PlaneGeometry(2.8, 6.5);
    const leftZoneMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide
    });
    this.sensorZoneLeft = new THREE.Mesh(zoneGeo, leftZoneMat);
    this.sensorZoneLeft.rotation.x = -Math.PI / 2;
    this.sensorZoneLeft.position.set(-2.9, 0.035, 1.8);
    this.sensorRingGroup.add(this.sensorZoneLeft);

    // Right Blind Spot Ground Zone Indicator
    const rightZoneMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide
    });
    this.sensorZoneRight = new THREE.Mesh(zoneGeo, rightZoneMat);
    this.sensorZoneRight.rotation.x = -Math.PI / 2;
    this.sensorZoneRight.position.set(2.9, 0.035, 1.8);
    this.sensorRingGroup.add(this.sensorZoneRight);

    // Rear Zone Indicator
    const rearZoneMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide
    });
    this.sensorZoneRear = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5.5), rearZoneMat);
    this.sensorZoneRear.rotation.x = -Math.PI / 2;
    this.sensorZoneRear.position.set(0, 0.035, 4.8);
    this.sensorRingGroup.add(this.sensorZoneRear);

    group.add(this.sensorRingGroup);

    // =========================================================
    // C. FIRST-PERSON COCKPIT INTERIOR (Visible in Cockpit Mode)
    // =========================================================
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0x0b0f19,
      roughness: 0.75,
      metalness: 0.15
    });
    const binnacleMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.5,
      metalness: 0.3
    });

    // Main sculpted dashboard deck
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.52, 0.95), dashMat);
    dash.position.set(0, 0.68, -0.78);
    this.cockpitInteriorGroup.add(dash);

    // Instrument cluster hood binnacle
    const binnacleHood = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, 0.38), binnacleMat);
    binnacleHood.position.set(0, 0.97, -0.66);
    this.cockpitInteriorGroup.add(binnacleHood);

    // Glowing Ambient ADAS LED Trim Strip across the entire dashboard
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    this.dashAmbientStrip = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.018, 0.02), stripMat);
    this.dashAmbientStrip.position.set(0, 0.93, -0.52);
    this.cockpitInteriorGroup.add(this.dashAmbientStrip);

    // Structural Windshield A-Pillars & Upper Roof Header
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });
    [-1.02, 1.02].forEach((px) => {
      const aPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 1.15, 10), pillarMat);
      aPillar.position.set(px, 1.28, -0.68);
      aPillar.rotation.z = px < 0 ? -0.18 : 0.18;
      aPillar.rotation.x = -0.42;
      this.cockpitInteriorGroup.add(aPillar);
    });

    // Upper windshield roof header bar
    const roofHeader = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.4), pillarMat);
    roofHeader.position.set(0, 1.72, -0.45);
    this.cockpitInteriorGroup.add(roofHeader);

    // High-Res Live Digital LCD Cluster Display (Canvas Texture)
    this.clusterCanvas = document.createElement('canvas');
    this.clusterCanvas.width = 640;
    this.clusterCanvas.height = 280;
    this.clusterCtx = this.clusterCanvas.getContext('2d');
    this.clusterTexture = new THREE.CanvasTexture(this.clusterCanvas);

    const clusterMat = new THREE.MeshBasicMaterial({ map: this.clusterTexture });
    const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.28), clusterMat);
    cluster.position.set(0, 0.83, -0.63);
    cluster.rotation.x = -0.26;
    this.cockpitInteriorGroup.add(cluster);

    // Sculpted Sport Steering Wheel with Dynamic Turn Pivot
    const wheelGroup = new THREE.Group();
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.35, metalness: 0.65 });
    const accentMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.03, 18, 42), wheelMat);
    wheelGroup.add(rim);

    // Top 12-o'clock cyan racing stripe on steering wheel
    const topStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 12), accentMat);
    topStripe.rotation.z = Math.PI / 2;
    topStripe.position.set(0, 0.21, 0);
    wheelGroup.add(topStripe);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 18), wheelMat);
    hub.rotation.x = Math.PI / 2;
    wheelGroup.add(hub);

    const spokeHoriz = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.032, 0.02), wheelMat);
    wheelGroup.add(spokeHoriz);
    const spokeVert = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.19, 0.02), wheelMat);
    spokeVert.position.y = -0.095;
    wheelGroup.add(spokeVert);

    wheelGroup.position.set(0, 0.76, -0.42);
    wheelGroup.rotation.x = -Math.PI * (24 / 180);
    this.cockpitInteriorGroup.add(wheelGroup);
    this.steeringWheel = wheelGroup;

    // 3D BSM LED Warning Triangles on A-Pillar / Mirror Mounts
    const bsmGeo = new THREE.BufferGeometry();
    const bsmVertices = new Float32Array([-0.035, -0.03, 0, 0.035, -0.03, 0, 0.0, 0.04, 0]);
    bsmGeo.setAttribute('position', new THREE.BufferAttribute(bsmVertices, 3));
    const bsmMatLeft = new THREE.MeshBasicMaterial({ color: 0x1e293b, side: THREE.DoubleSide });
    const bsmMatRight = new THREE.MeshBasicMaterial({ color: 0x1e293b, side: THREE.DoubleSide });

    this.leftMirrorBSM = new THREE.Mesh(bsmGeo, bsmMatLeft);
    this.leftMirrorBSM.position.set(-0.92, 1.06, -0.58);
    this.cockpitInteriorGroup.add(this.leftMirrorBSM);

    this.rightMirrorBSM = new THREE.Mesh(bsmGeo, bsmMatRight);
    this.rightMirrorBSM.position.set(0.92, 1.06, -0.58);
    this.cockpitInteriorGroup.add(this.rightMirrorBSM);

    group.add(this.cockpitInteriorGroup);

    return group;
  }

  // --- AUDIO SYNTHESIS FOR IMPACT ---
  private initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  private playCrashSound(intensity: number) {
    try {
      this.initAudioContext();
      if (!this.audioCtx) return;

      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);

      oscGain.gain.setValueAtTime(Math.min(0.9, 0.4 + intensity * 0.4), now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);

      const bufferSize = ctx.sampleRate * 0.35;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750, now);
      filter.Q.setValueAtTime(2.5, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(Math.min(0.7, 0.25 + intensity * 0.4), now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);

      whiteNoise.start(now);
      whiteNoise.stop(now + 0.35);
    } catch {}
  }

  // --- PARTICLE SYSTEM ---
  private initSparkSystem() {
    const maxSparks = 80;
    this.sparkGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxSparks * 3);
    const colors = new Float32Array(maxSparks * 3);

    for (let i = 0; i < maxSparks; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -100;
      positions[i * 3 + 2] = 0;

      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.65;
      colors[i * 3 + 2] = 0.15;
    }

    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const sparkMat = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });

    this.sparkPointsMesh = new THREE.Points(this.sparkGeo, sparkMat);
    this.scene.add(this.sparkPointsMesh);
  }

  private triggerSparks(point: THREE.Vector3, count: number = 35) {
    for (let i = 0; i < count; i++) {
      this.sparks.push({
        position: point
          .clone()
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.4, (Math.random() - 0.5) * 0.5)),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          Math.random() * 8 + 3,
          (Math.random() - 0.5) * 14
        ),
        life: 0,
        maxLife: 0.25 + Math.random() * 0.35,
        size: 0.12 + Math.random() * 0.14
      });
    }
  }

  private updateSparks(delta: number) {
    if (!this.sparkGeo || !this.sparkPointsMesh) return;
    const posAttr = this.sparkGeo.getAttribute('position') as THREE.BufferAttribute;
    const maxSparks = 80;

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += delta;
      if (s.life >= s.maxLife) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.velocity.y -= 18.0 * delta;
      s.position.addScaledVector(s.velocity, delta);
    }

    const positions = posAttr.array as Float32Array;
    for (let i = 0; i < maxSparks; i++) {
      if (i < this.sparks.length) {
        positions[i * 3] = this.sparks[i].position.x;
        positions[i * 3 + 1] = this.sparks[i].position.y;
        positions[i * 3 + 2] = this.sparks[i].position.z;
      } else {
        positions[i * 3 + 1] = -100;
      }
    }
    posAttr.needsUpdate = true;
  }

  // --- TRAFFIC CAR MODELS & AI ---
  private createTrafficCar(
    laneIndex: number,
    initialZ: number,
    type: TrafficVehicleType,
    role: TrafficCarData['role'] = 'overtaker',
    customSpeed?: number
  ): TrafficCarData {
    const carGroup = new THREE.Group();
    const taillights: THREE.Mesh[] = [];
    const headlights: THREE.Mesh[] = [];
    const wheels: THREE.Mesh[] = [];

    let length = 4.3;
    let width = 1.9;
    let originalColor = 0xe11d48;
    let bodyMesh: THREE.Mesh;
    let name = 'Overtaking Sedan';

    if (type === 'sedan' || type === 'sport') {
      length = type === 'sport' ? 4.4 : 4.2;
      width = 1.92;
      name = type === 'sport' ? 'High-Speed Sports Coupe' : 'Highway Sedan';
      const palette =
        type === 'sport'
          ? [0xf43f5e, 0xf59e0b, 0x38bdf8, 0xa855f7]
          : [0xe11d48, 0x3b82f6, 0xf59e0b, 0xcbd5e1, 0x8b5cf6];
      originalColor = palette[Math.floor(Math.random() * palette.length)];
      const bodyMat = new THREE.MeshStandardMaterial({
        color: originalColor,
        metalness: 0.85,
        roughness: 0.2
      });

      bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.56, length), bodyMat);
      bodyMesh.position.y = 0.46;
      carGroup.add(bodyMesh);

      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.8, 0.48, length * 0.52),
        new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.1, metalness: 0.9 })
      );
      cabin.position.set(0, 0.92, -0.1);
      carGroup.add(cabin);
    } else if (type === 'suv') {
      length = 4.8;
      width = 2.08;
      name = 'Blind-Spot SUV';
      const palette = [0xf97316, 0x38bdf8, 0xe2e8f0, 0xec4899, 0x6366f1];
      originalColor = palette[Math.floor(Math.random() * palette.length)];
      const bodyMat = new THREE.MeshStandardMaterial({
        color: originalColor,
        metalness: 0.8,
        roughness: 0.25
      });

      bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.82, length), bodyMat);
      bodyMesh.position.y = 0.64;
      carGroup.add(bodyMesh);

      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.84, 0.62, length * 0.62),
        new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.1, metalness: 0.9 })
      );
      cabin.position.set(0, 1.24, -0.15);
      carGroup.add(cabin);
    } else {
      // Heavy Semi-Truck / Lorry
      length = 9.4;
      width = 2.46;
      name = 'Heavy Freight Truck';
      originalColor = 0xe11d48;
      const cabMat = new THREE.MeshStandardMaterial({
        color: originalColor,
        metalness: 0.65,
        roughness: 0.3
      });
      bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2.38, 2.2, 2.6), cabMat);
      bodyMesh.position.set(0, 1.35, -3.1);
      carGroup.add(bodyMesh);

      const win = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.82, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x090d16 })
      );
      win.position.set(0, 1.82, -4.41);
      carGroup.add(win);

      const trailerMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        metalness: 0.8,
        roughness: 0.3
      });
      const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.65, 6.6), trailerMat);
      trailer.position.set(0, 1.72, 1.45);
      carGroup.add(trailer);
    }

    // Bright Headlights (Crucial so cars are super clear inside Rear & Side Mirrors!)
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const hlHaloMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.65
    });
    const frontZ = -length / 2 - 0.02;
    [-width * 0.36, width * 0.36].forEach((hx) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.08), hlMat);
      hl.position.set(hx, 0.56, frontZ);
      carGroup.add(hl);
      headlights.push(hl);

      const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.38), hlHaloMat);
      halo.rotation.y = Math.PI;
      halo.position.set(hx, 0.56, frontZ - 0.05);
      carGroup.add(halo);
    });

    // Bright Taillights
    const rearZ = length / 2 + 0.02;
    [-width * 0.36, width * 0.36].forEach((tx) => {
      const tl = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.18, 0.08),
        new THREE.MeshBasicMaterial({ color: 0xef4444 })
      );
      tl.position.set(tx, 0.6, rearZ);
      carGroup.add(tl);
      taillights.push(tl);
    });

    // Turn Signal Blinkers (Left & Right)
    const blinkerMatL = new THREE.MeshBasicMaterial({ color: 0x334155 });
    const blinkerMatR = new THREE.MeshBasicMaterial({ color: 0x334155 });
    const leftBlinker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.25), blinkerMatL);
    leftBlinker.position.set(-width * 0.48, 0.56, rearZ - 0.1);
    carGroup.add(leftBlinker);

    const rightBlinker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.25), blinkerMatR);
    rightBlinker.position.set(width * 0.48, 0.56, rearZ - 0.1);
    carGroup.add(rightBlinker);

    // Ground ADAS Target Halo Ring around each traffic car (glows when threat is active!)
    const hazardRingGeo = new THREE.RingGeometry(Math.max(width, length) * 0.55, Math.max(width, length) * 0.63, 32);
    const hazardRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25
    });
    const hazardRing = new THREE.Mesh(hazardRingGeo, hazardRingMat);
    hazardRing.rotation.x = -Math.PI / 2;
    hazardRing.position.y = 0.04;
    carGroup.add(hazardRing);

    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.7 });
    const zOffsets = [-length * 0.32, length * 0.32];
    zOffsets.forEach((zo) => {
      [-width * 0.48, width * 0.48].forEach((wo) => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 14), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wo, 0.35, zo);
        carGroup.add(wheel);
        wheels.push(wheel);
      });
    });

    const laneX = LANE_CENTERS[laneIndex] ?? LANE_CENTERS[1];
    carGroup.position.set(laneX, 0, initialZ);
    this.scene.add(carGroup);

    const speed =
      customSpeed !== undefined
        ? customSpeed
        : role === 'cruiser'
        ? this.playerSpeed - 4.0
        : this.playerSpeed + 6.5 + Math.random() * 6.0;

    return {
      mesh: carGroup,
      id: Math.random().toString(36).substring(2, 8),
      name,
      type,
      laneIndex,
      targetLaneIndex: laneIndex,
      currentX: laneX,
      isChangingLane: false,
      zSpeed: speed,
      baseSpeed: speed,
      length,
      width,
      originalColor,
      bodyMesh,
      hazardRing,
      blindSpotNotified: false,
      tailgateNotified: false,
      isAcknowledged: false,
      leftBlinker,
      rightBlinker,
      taillights,
      headlights,
      wheels,
      role
    };
  }

  private getClosestPlayerLaneIndex(): number {
    let bestIdx = 1;
    let bestDist = Infinity;
    LANE_CENTERS.forEach((lx, idx) => {
      const d = Math.abs(this.playerX - lx);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    return bestIdx;
  }

  private isLaneClear(laneIndex: number, zPos: number, minGap = 18): boolean {
    return !this.trafficCars.some(
      (c) =>
        (c.laneIndex === laneIndex || c.targetLaneIndex === laneIndex) &&
        Math.abs(c.mesh.position.z - zPos) < minGap
    );
  }

  private spawnInitialTraffic() {
    // Spawn a left-lane overtaker approaching from 24m behind so the user immediately sees traffic in mirrors
    const leftCar = this.createTrafficCar(0, 22, 'sport', 'overtaker', this.playerSpeed + 6.5);
    this.trafficCars.push(leftCar);

    // Spawn a lead cruiser ahead in Lane 3 (+2.0m)
    const aheadCar = this.createTrafficCar(2, -38, 'sedan', 'cruiser', this.playerSpeed - 2.5);
    this.trafficCars.push(aheadCar);

    // Spawn a right-lane SUV approaching
    const rightCar = this.createTrafficCar(3, 42, 'suv', 'overtaker', this.playerSpeed + 5.5);
    this.trafficCars.push(rightCar);
  }

  /**
   * Injects a specific ADAS threat scenario directly into the live 3D Highway Simulator!
   */
  public triggerScenario(scenario: ScenarioType) {
    // Clear existing traffic to stage the requested ADAS scenario cleanly
    this.trafficCars.forEach((c) => this.scene.remove(c.mesh));
    this.trafficCars = [];
    this.activeAlert = null;
    this.activeFrontWarning = false;

    const playerLane = this.getClosestPlayerLaneIndex();

    if (scenario === 'BLIND_SPOT_LEFT') {
      const targetPlayerLane = Math.max(1, playerLane);
      this.playerTargetX = LANE_CENTERS[targetPlayerLane];
      this.playerX = this.playerTargetX;
      const leftLane = targetPlayerLane - 1;
      const car = this.createTrafficCar(leftLane, 16, 'sport', 'overtaker', this.playerSpeed + 5.2);
      car.name = 'Left Blind-Spot Overtaker';
      this.trafficCars.push(car);
    } else if (scenario === 'BLIND_SPOT_RIGHT') {
      const targetPlayerLane = Math.min(2, playerLane);
      this.playerTargetX = LANE_CENTERS[targetPlayerLane];
      this.playerX = this.playerTargetX;
      const rightLane = targetPlayerLane + 1;
      const car = this.createTrafficCar(rightLane, 9.5, 'suv', 'blind_spot_linger', this.playerSpeed + 3.5);
      car.name = 'Right Blind-Spot SUV';
      this.trafficCars.push(car);
    } else if (scenario === 'REAR_TAILGATER') {
      const car = this.createTrafficCar(playerLane, 32, 'sport', 'tailgater', this.playerSpeed + 9.5);
      car.name = 'High-Speed Rear Tailgater';
      this.trafficCars.push(car);
    } else if (scenario === 'FRONT_CUT_IN') {
      const adjLane = playerLane < 3 ? playerLane + 1 : playerLane - 1;
      const car = this.createTrafficCar(adjLane, -22, 'truck', 'cut_in', this.playerSpeed - 5.0);
      car.name = 'Cutting-In Lead Vehicle';
      car.targetLaneIndex = playerLane;
      car.isChangingLane = true;
      this.trafficCars.push(car);
    } else if (scenario === 'ORBIT_360') {
      // Multi-threat 360° highway wave
      this.playerTargetX = LANE_CENTERS[1];
      this.playerX = LANE_CENTERS[1];
      this.trafficCars.push(this.createTrafficCar(0, 14, 'sport', 'overtaker', this.playerSpeed + 5.0));
      this.trafficCars.push(this.createTrafficCar(2, 24, 'suv', 'overtaker', this.playerSpeed + 6.0));
      this.trafficCars.push(this.createTrafficCar(1, 40, 'sedan', 'tailgater', this.playerSpeed + 8.5));
      this.trafficCars.push(this.createTrafficCar(3, -30, 'truck', 'cruiser', this.playerSpeed - 3.0));
    } else {
      this.spawnInitialTraffic();
    }
  }

  private spawnTrafficWave() {
    if (this.trafficCars.length >= 6) return;

    const playerLane = this.getClosestPlayerLaneIndex();
    const rand = Math.random();

    // 70% chance to spawn an approaching overtaker or tailgater behind (+Z)
    if (rand < 0.72) {
      const candidateLanes = [0, 1, 2, 3];
      const chosenLane = candidateLanes[Math.floor(Math.random() * candidateLanes.length)];
      const spawnZ = 68 + Math.random() * 18;
      if (!this.isLaneClear(chosenLane, spawnZ, 22)) return;

      const isSameLane = chosenLane === playerLane;
      const role: TrafficCarData['role'] = isSameLane
        ? 'tailgater'
        : Math.random() < 0.35
        ? 'blind_spot_linger'
        : 'overtaker';
      const types: TrafficVehicleType[] = ['sedan', 'sport', 'suv', 'truck'];
      const type = isSameLane ? 'sport' : types[Math.floor(Math.random() * types.length)];
      const speed = this.playerSpeed + (isSameLane ? 8.5 : 5.5 + Math.random() * 5.0);

      const car = this.createTrafficCar(chosenLane, spawnZ, type, role, speed);
      this.trafficCars.push(car);
    } else {
      // 28% chance to spawn a slower cruiser ahead (-Z)
      const adjLanes = [0, 1, 2, 3].filter((l) => l !== playerLane);
      const chosenLane = adjLanes[Math.floor(Math.random() * adjLanes.length)];
      const spawnZ = -85 - Math.random() * 20;
      if (!this.isLaneClear(chosenLane, spawnZ, 22)) return;

      const type: TrafficVehicleType = Math.random() < 0.4 ? 'truck' : 'sedan';
      const car = this.createTrafficCar(chosenLane, spawnZ, type, 'cruiser', this.playerSpeed - 4.5);
      this.trafficCars.push(car);
    }
  }

  // --- DIGITAL COCKPIT DISPLAY DRAWING ---
  private updateClusterScreen(speedKmh: number, rpm: number, gear: string) {
    if (!this.clusterCtx || !this.clusterTexture) return;
    const ctx = this.clusterCtx;
    const w = 640;
    const h = 280;

    ctx.clearRect(0, 0, w, h);

    // Sleek dark automotive background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#040812');
    bgGrad.addColorStop(1, '#091326');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Glowing border frame
    ctx.strokeStyle = this.activeAlert ? '#ef4444' : '#00f0ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Left Zone: ADAS Lane & Sensor Mini-Map
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(24, 52, 150, 175);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(24, 52, 150, 175);

    // Mini lane lines inside cluster
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.setLineDash([6, 6]);
      ctx.moveTo(24 + i * 37.5, 58);
      ctx.lineTo(24 + i * 37.5, 220);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Ego dot in mini-map
    const egoMiniX = 24 + ((this.playerX + 8) / 16) * 150;
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(egoMiniX - 7, 130, 14, 24);

    // Nearby traffic dots in cluster mini-map
    this.trafficCars.forEach((tc) => {
      if (Math.abs(tc.mesh.position.z) < 40) {
        const tx = 24 + ((tc.currentX + 8) / 16) * 150;
        const ty = 140 + (tc.mesh.position.z / 40) * 75;
        ctx.fillStyle = tc.isAcknowledged ? '#10b981' : '#f43f5e';
        ctx.fillRect(tx - 6, Math.max(56, Math.min(212, ty)) - 10, 12, 20);
      }
    });

    // Center Digital Speedometer
    ctx.fillStyle = speedKmh > 130 ? '#ef4444' : '#ffffff';
    ctx.font = 'bold 84px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${speedKmh}`, 320, 140);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px "Inter", sans-serif';
    ctx.fillText('KM / H', 320, 170);

    // Gear & AutoPilot status on Right
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 34px "JetBrains Mono", monospace';
    ctx.fillText(`${gear}`, 530, 115);

    ctx.fillStyle = this.autoPilot ? '#10b981' : '#64748b';
    ctx.font = 'bold 16px "Inter", sans-serif';
    ctx.fillText(this.autoPilot ? '● LKA AUTO-STEER' : 'MANUAL STEER', 530, 155);

    // RPM Bar Sweep at bottom
    const rpmRatio = Math.min(1.0, rpm / 8000);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(200, 210, 400, 16);

    const barColor = rpmRatio > 0.85 ? '#ef4444' : rpmRatio > 0.65 ? '#f59e0b' : '#00f0ff';
    ctx.fillStyle = barColor;
    ctx.fillRect(200, 210, 400 * rpmRatio, 16);

    // Top Status Banner
    if (this.activeAlert) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 22px "Inter", sans-serif';
      ctx.fillText(`⚠ CHECK ${this.activeAlert.toUpperCase()} MIRROR!`, 320, 38);
    } else if (this.activeFrontWarning) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 22px "Inter", sans-serif';
      ctx.fillText('⚠ FORWARD OBSTACLE AHEAD', 320, 38);
    } else {
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 18px "Inter", sans-serif';
      ctx.fillText('● 3D HRTF SPATIAL ADAS ACTIVE', 320, 36);
    }

    this.clusterTexture.needsUpdate = true;
  }

  // --- COLLISION DETECTION & IMPULSE PHYSICS ---
  private checkCollisions(delta: number) {
    if (this.collisionCooldown > 0) {
      this.collisionCooldown -= delta;
    }

    const playerBox = {
      minX: this.playerX - 0.92,
      maxX: this.playerX + 0.92,
      minZ: -2.2,
      maxZ: 1.75
    };

    for (let i = 0; i < this.trafficCars.length; i++) {
      const car = this.trafficCars[i];
      const carZ = car.mesh.position.z;
      const carX = car.currentX;
      const halfL = car.length / 2;
      const halfW = car.width / 2;

      const carBox = {
        minX: carX - halfW,
        maxX: carX + halfW,
        minZ: carZ - halfL,
        maxZ: carZ + halfL
      };

      const overlapsX = playerBox.minX < carBox.maxX && playerBox.maxX > carBox.minX;
      const overlapsZ = playerBox.minZ < carBox.maxZ && playerBox.maxZ > carBox.minZ;

      if (overlapsX && overlapsZ) {
        const impactPoint = new THREE.Vector3(
          (Math.max(playerBox.minX, carBox.minX) + Math.min(playerBox.maxX, carBox.maxX)) / 2,
          0.6,
          (Math.max(playerBox.minZ, carBox.minZ) + Math.min(playerBox.maxZ, carBox.maxZ)) / 2
        );

        const relativeSpeed = Math.abs(this.playerSpeed - car.zSpeed);
        const relativeSpeedKmh = Math.max(12, Math.round(relativeSpeed * 3.6));

        if (this.collisionCooldown <= 0) {
          this.collisionCooldown = 0.55;

          this.addTrauma(0.75);
          this.triggerSparks(impactPoint, 42);
          this.playCrashSound(Math.min(1.0, relativeSpeed / 18));

          const pushDirection = this.playerX <= carX ? -1 : 1;
          this.playerTargetX = Math.max(-6.4, Math.min(6.4, this.playerTargetX + pushDirection * 1.8));
          this.playerLateralVelocity += pushDirection * 7.0;

          // Separate traffic car slightly to prevent sticky overlap
          car.mesh.position.z += carZ < 0 ? -3.0 : 3.0;
          this.playerSpeed = Math.max(12.0, this.playerSpeed - 8.0);

          this.damage = Math.min(100, this.damage + Math.max(8, Math.round(relativeSpeedKmh * 0.35)));
          this.streak = 0;

          if (this.onCollisionEvent) {
            this.onCollisionEvent({
              vehicleId: car.id,
              relativeSpeedKmh,
              damagePercent: this.damage,
              timestamp: Date.now()
            });
          }
        }
      }
    }
  }

  public addTrauma(amount: number) {
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + amount);
  }

  // --- PUBLIC API ---
  public mount(element: HTMLElement) {
    this.container = element;

    // Explicitly enforce 100% bounds on canvas element to prevent Retina scaling overflow
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';

    this.container.appendChild(this.renderer.domElement);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    }

    this.handleResize();
  }

  public unmount() {
    this.pause();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);

    if (this.container && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }

    try {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    } catch {}
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.loop();
  }

  public pause() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
    this.clock.stop();
  }

  public reset() {
    this.trafficCars.forEach((car) => this.scene.remove(car.mesh));
    this.trafficCars = [];
    this.score = 0;
    this.streak = 0;
    this.distanceTraveled = 0;
    this.damage = 0;
    this.playerX = LANE_CENTERS[1];
    this.playerTargetX = LANE_CENTERS[1];
    this.activeAlert = null;
    this.activeFrontWarning = false;
    this.spawnInitialTraffic();
  }

  public toggleCameraMode(): CameraMode {
    const order: CameraMode[] = ['cockpit', 'chase', 'hood'];
    const nextIdx = (order.indexOf(this.cameraMode) + 1) % order.length;
    this.cameraMode = order[nextIdx];
    return this.cameraMode;
  }

  public setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
  }

  public toggleAutoPilot(): boolean {
    this.autoPilot = !this.autoPilot;
    if (this.autoPilot) {
      const closestLane = this.getClosestPlayerLaneIndex();
      this.playerTargetX = LANE_CENTERS[closestLane];
    }
    return this.autoPilot;
  }

  public updateDriverHeadPose(yawDeg: number, pitchDeg: number) {
    this.driverYawRad = (-yawDeg * Math.PI) / 180;
    this.driverPitchRad = (pitchDeg * Math.PI) / 180;
  }

  public notifyMirrorCheck(side: MirrorSide) {
    if (this.activeAlert === side) {
      const reactionTime = Math.max(85, Math.round(performance.now() - this.lastAlertTimestamp));
      this.lastReactionMs = reactionTime;
      this.score += Math.max(120, 450 - Math.round(reactionTime / 6));
      this.streak += 1;
      this.activeAlert = null;

      if (side === 'left' && this.leftMirrorBSM) {
        (this.leftMirrorBSM.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
      } else if (side === 'right' && this.rightMirrorBSM) {
        (this.rightMirrorBSM.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
      }
    }

    // Mark matching threat vehicles as acknowledged (turn emerald green + ring emerald)
    this.trafficCars.forEach((car) => {
      if (!car.isAcknowledged && (car.blindSpotNotified || car.tailgateNotified)) {
        const relX = car.currentX - this.playerX;
        const matchesSide =
          (side === 'left' && relX < -1.5) ||
          (side === 'right' && relX > 1.5) ||
          (side === 'rear' && Math.abs(relX) <= 2.2);

        if (matchesSide) {
          car.isAcknowledged = true;
          if (car.bodyMesh && car.bodyMesh.material) {
            (car.bodyMesh.material as THREE.MeshStandardMaterial).color.setHex(0x10b981);
          }
          if (car.hazardRing && car.hazardRing.material) {
            (car.hazardRing.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
            (car.hazardRing.material as THREE.MeshBasicMaterial).opacity = 0.65;
          }
        }
      }
    });
  }

  public getMirrorRegions(): Record<MirrorSide, NormalizedRect> {
    return this.mirrorRegions;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
      return;
    }
    this.keysPressed[e.code] = true;
    this.keysPressed[e.key] = true;

    if (e.code === 'Space') {
      e.preventDefault();
      this.toggleAutoPilot();
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    this.keysPressed[e.code] = false;
    this.keysPressed[e.key] = false;
  }

  public handleResize() {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;

    this.lastRenderW = w;
    this.lastRenderH = h;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    const aspect = w / h;
    this.mainCamera.aspect = aspect;
    this.mainCamera.updateProjectionMatrix();

    this.chaseCamera.aspect = aspect;
    this.chaseCamera.updateProjectionMatrix();

    this.hoodCamera.aspect = aspect;
    this.hoodCamera.updateProjectionMatrix();

    // Update Mirror Aspect Ratios from mirrorRegions
    const leftRect = this.mirrorRegions.left;
    this.leftMirrorCamera.aspect = (w * leftRect.width) / (h * leftRect.height);
    this.leftMirrorCamera.updateProjectionMatrix();

    const rightRect = this.mirrorRegions.right;
    this.rightMirrorCamera.aspect = (w * rightRect.width) / (h * rightRect.height);
    this.rightMirrorCamera.updateProjectionMatrix();

    const rearRect = this.mirrorRegions.rear;
    this.rearMirrorCamera.aspect = (w * rearRect.width) / (h * rearRect.height);
    this.rearMirrorCamera.updateProjectionMatrix();
  }

  private renderMirrorSubViewport(
    rect: NormalizedRect,
    w: number,
    h: number,
    camera: THREE.PerspectiveCamera
  ) {
    // Convert top-left CSS normalized rect to bottom-left WebGL viewport pixels
    const vx = Math.round(rect.x * w);
    const vw = Math.round(rect.width * w);
    const vh = Math.round(rect.height * h);
    const vy = Math.round(h - (rect.y + rect.height) * h);

    this.renderer.setViewport(vx, vy, vw, vh);
    this.renderer.setScissor(vx, vy, vw, vh);
    this.renderer.render(this.scene, camera);
  }

  private renderScene(w: number, h: number) {
    // Toggle interior vs exterior visibility based on camera mode
    this.cockpitInteriorGroup.visible = this.cameraMode === 'cockpit';
    this.exteriorBodyGroup.visible = this.cameraMode !== 'cockpit';
    this.sensorRingGroup.visible = this.cameraMode === 'chase';

    const activeCam =
      this.cameraMode === 'chase'
        ? this.chaseCamera
        : this.cameraMode === 'hood'
        ? this.hoodCamera
        : this.mainCamera;

    // Apply Camera Trauma / Shake
    const shake = Math.pow(this.cameraTrauma, 2);
    const yawOffset = (Math.random() - 0.5) * 0.06 * shake;
    const pitchOffset = (Math.random() - 0.5) * 0.06 * shake;
    const rollOffset = (Math.random() - 0.5) * 0.04 * shake;

    activeCam.rotation.z += rollOffset;
    activeCam.rotation.y += yawOffset;
    activeCam.rotation.x += pitchOffset;

    // 1. Render Main Full Driving Viewport
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, activeCam);

    // 2. Render the 3 Automotive Mirrors (Left Wing, Right Wing, Center Rear-View)
    // Temporarily hide cockpit interior when rendering mirrors so mirrors have an unobstructed rear view
    const prevInteriorVisible = this.cockpitInteriorGroup.visible;
    const prevExteriorVisible = this.exteriorBodyGroup.visible;
    this.cockpitInteriorGroup.visible = false;
    this.exteriorBodyGroup.visible = false;

    this.renderer.setScissorTest(true);
    this.renderMirrorSubViewport(this.mirrorRegions.left, w, h, this.leftMirrorCamera);
    this.renderMirrorSubViewport(this.mirrorRegions.right, w, h, this.rightMirrorCamera);
    this.renderMirrorSubViewport(this.mirrorRegions.rear, w, h, this.rearMirrorCamera);
    this.renderer.setScissorTest(false);

    this.cockpitInteriorGroup.visible = prevInteriorVisible;
    this.exteriorBodyGroup.visible = prevExteriorVisible;
  }

  // --- GAME LOOP ---
  private loop = () => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.loop);
    const delta = Math.min(0.08, this.clock.getDelta());
    this.elapsedTime += delta;

    // 1. Decay Camera Shake Trauma
    if (this.cameraTrauma > 0) {
      this.cameraTrauma = Math.max(0, this.cameraTrauma - 1.8 * delta);
    }

    // 2. Steering & Physics Controls (A / D / W / S or Arrows)
    const isSteerLeft =
      this.keysPressed['KeyA'] ||
      this.keysPressed['ArrowLeft'] ||
      this.keysPressed['a'] ||
      this.keysPressed['A'];
    const isSteerRight =
      this.keysPressed['KeyD'] ||
      this.keysPressed['ArrowRight'] ||
      this.keysPressed['d'] ||
      this.keysPressed['D'];
    const isThrottle =
      this.keysPressed['KeyW'] ||
      this.keysPressed['ArrowUp'] ||
      this.keysPressed['w'] ||
      this.keysPressed['W'];
    const isBrake =
      this.keysPressed['KeyS'] ||
      this.keysPressed['ArrowDown'] ||
      this.keysPressed['s'] ||
      this.keysPressed['S'];

    let steerIntent = 0;
    if (isSteerLeft) steerIntent -= 1;
    if (isSteerRight) steerIntent += 1;

    if (steerIntent !== 0) {
      this.playerTargetX += steerIntent * 10.5 * delta;
      this.playerTargetX = Math.max(-6.4, Math.min(6.4, this.playerTargetX));
    } else if (this.autoPilot) {
      // Auto-center into nearest highway lane
      const nearestLane = this.getClosestPlayerLaneIndex();
      const laneCenter = LANE_CENTERS[nearestLane];
      this.playerTargetX += (laneCenter - this.playerTargetX) * Math.min(1.0, 5.0 * delta);
    }

    // Apply lateral impulse decay
    if (Math.abs(this.playerLateralVelocity) > 0.05) {
      this.playerX += this.playerLateralVelocity * delta;
      this.playerLateralVelocity *= Math.pow(0.04, delta);
    }

    // Smooth lateral car position easing
    this.playerX += (this.playerTargetX - this.playerX) * Math.min(1.0, 10.0 * delta);
    this.playerX = Math.max(-6.6, Math.min(6.6, this.playerX));

    // Rotate Steering Wheel smoothly
    if (this.steeringWheel) {
      const targetWheelRoll = -steerIntent * 0.55 - (this.playerTargetX - this.playerX) * 0.65;
      this.steeringWheel.rotation.z +=
        (targetWheelRoll - this.steeringWheel.rotation.z) * Math.min(1.0, 14.0 * delta);
    }

    // Dynamic car chassis roll into the turn
    this.playerCarGroup.rotation.z = (this.playerTargetX - this.playerX) * -0.045;
    this.playerCarGroup.rotation.y = (this.playerTargetX - this.playerX) * -0.035;

    // Throttle and Braking + Brake Light Flare
    if (isThrottle) {
      this.playerSpeed = Math.min(44.5, this.playerSpeed + 20.0 * delta); // up to 160 km/h
    } else if (isBrake) {
      this.playerSpeed = Math.max(11.0, this.playerSpeed - 28.0 * delta); // down to 40 km/h
    } else {
      this.playerSpeed += (27.78 - this.playerSpeed) * 1.8 * delta; // cruise ~100 km/h
    }

    if (this.playerTaillightBar) {
      (this.playerTaillightBar.material as THREE.MeshBasicMaterial).color.setHex(
        isBrake ? 0xff2222 : 0xb91c1c
      );
      this.playerTaillightBar.scale.y = isBrake ? 1.5 : 1.0;
    }

    // Spin Player Wheels
    this.playerWheels.forEach((w) => {
      w.rotation.x -= (this.playerSpeed / 0.36) * delta;
    });

    // Distance & Score accumulation
    this.distanceTraveled += this.playerSpeed * delta;
    this.score += Math.round(this.playerSpeed * delta * 0.5);

    // 3. Scroll Registered Repeating Highway Elements Seamlessly
    for (let i = 0; i < this.scrollingObjects.length; i++) {
      const item = this.scrollingObjects[i];
      item.obj.position.z += this.playerSpeed * delta;
      if (item.obj.position.z > item.maxZ) {
        item.obj.position.z -= item.wrapLength;
      }
    }

    // 4. Update Player Vehicle and Cameras with Lateral Movement
    this.playerCarGroup.position.x = this.playerX;
    this.mainCamera.position.x = this.playerX;
    this.hoodCamera.position.x = this.playerX;
    this.hoodCamera.rotation.set(0, 0, 0);

    // Smoothly interpolate driver head pose for cockpit camera
    this.smoothedCameraYaw += (this.driverYawRad * 0.48 - this.smoothedCameraYaw) * Math.min(1.0, 12.0 * delta);
    this.smoothedCameraPitch +=
      (this.driverPitchRad * 0.35 - this.smoothedCameraPitch) * Math.min(1.0, 12.0 * delta);
    this.mainCamera.rotation.y = this.smoothedCameraYaw;
    this.mainCamera.rotation.x = this.smoothedCameraPitch;
    this.mainCamera.rotation.z = 0;

    // Chase Camera follows player smoothly
    this.chaseCamera.position.x += (this.playerX - this.chaseCamera.position.x) * Math.min(1.0, 8.5 * delta);
    this.chaseCamera.lookAt(this.playerX * 0.85, 1.15, -16);

    // Mirror Cameras follow vehicle position & look into Left, Right, and Rear zones
    this.leftMirrorCamera.position.x = this.playerX - 1.05;
    this.leftMirrorCamera.lookAt(this.playerX - 4.2, 0.95, 75);

    this.rightMirrorCamera.position.x = this.playerX + 1.05;
    this.rightMirrorCamera.lookAt(this.playerX + 4.2, 0.95, 75);

    this.rearMirrorCamera.position.x = this.playerX;
    this.rearMirrorCamera.lookAt(this.playerX, 1.05, 85);

    // 5. Traffic Spawning, Lane Changes, and ADAS Threat Detection
    this.timeSinceLastSpawn += delta;
    if (this.timeSinceLastSpawn > 4.2 || (this.timeSinceLastSpawn > 1.8 && this.trafficCars.length < 2)) {
      this.spawnTrafficWave();
      this.timeSinceLastSpawn = 0;
    }

    const blinkOn = Math.floor(this.elapsedTime * 5) % 2 === 0;
    let detectedFrontWarning = false;
    let closestThreatDist: number | null = null;
    let closestThreatClosingKmh: number | null = null;
    const currentThreats: ThreatObstacle[] = [];

    for (let i = this.trafficCars.length - 1; i >= 0; i--) {
      const car = this.trafficCars[i];

      // Role-specific speed & lane behavior
      if (car.role === 'blind_spot_linger') {
        // Lingers inside the player's blind spot (z between 2m and 8m) for several seconds before accelerating past
        if (car.mesh.position.z > 2.5 && car.mesh.position.z < 9.5 && !car.isAcknowledged) {
          car.zSpeed += (this.playerSpeed + 0.9 - car.zSpeed) * 4.0 * delta;
        } else {
          car.zSpeed += (this.playerSpeed + 6.5 - car.zSpeed) * 2.0 * delta;
        }
      } else if (car.role === 'tailgater') {
        // High-Beam Flash Effect for tailgater
        car.headlights.forEach((hl) => {
          hl.scale.setScalar(blinkOn ? 1.35 : 1.0);
        });
        // Prevent unfair rear-end collision if player stays in lane: at z < 9.5m, tailgater signals and changes to an open adjacent lane!
        if (
          !car.isChangingLane &&
          car.mesh.position.z < 10.5 &&
          car.mesh.position.z > 2.0 &&
          Math.abs(car.currentX - this.playerX) < 2.2
        ) {
          const leftCandidate = car.laneIndex - 1;
          const rightCandidate = car.laneIndex + 1;
          if (leftCandidate >= 0 && this.isLaneClear(leftCandidate, car.mesh.position.z, 14)) {
            car.targetLaneIndex = leftCandidate;
            car.isChangingLane = true;
          } else if (rightCandidate <= 3 && this.isLaneClear(rightCandidate, car.mesh.position.z, 14)) {
            car.targetLaneIndex = rightCandidate;
            car.isChangingLane = true;
          } else {
            // Match player speed so it doesn't ram player from behind
            car.zSpeed = Math.min(car.zSpeed, this.playerSpeed + 0.4);
          }
        }
      }

      // Smooth lane changing for AI cars
      const targetLaneX = LANE_CENTERS[car.targetLaneIndex] ?? car.currentX;
      if (Math.abs(targetLaneX - car.currentX) > 0.05) {
        const dir = targetLaneX > car.currentX ? 1 : -1;
        car.currentX += dir * 3.8 * delta;
        if (Math.abs(targetLaneX - car.currentX) < 0.12) {
          car.currentX = targetLaneX;
          car.laneIndex = car.targetLaneIndex;
          car.isChangingLane = false;
        }
        // Blink turn signal while changing lanes
        if (dir < 0 && car.leftBlinker) {
          (car.leftBlinker.material as THREE.MeshBasicMaterial).color.setHex(blinkOn ? 0xf59e0b : 0x334155);
        } else if (dir > 0 && car.rightBlinker) {
          (car.rightBlinker.material as THREE.MeshBasicMaterial).color.setHex(blinkOn ? 0xf59e0b : 0x334155);
        }
      } else {
        if (car.leftBlinker) (car.leftBlinker.material as THREE.MeshBasicMaterial).color.setHex(0x334155);
        if (car.rightBlinker) (car.rightBlinker.material as THREE.MeshBasicMaterial).color.setHex(0x334155);
      }

      car.mesh.position.x = car.currentX;

      const relativeSpeed = car.zSpeed - this.playerSpeed;
      car.mesh.position.z -= relativeSpeed * delta;

      // Spin AI car wheels
      car.wheels.forEach((w) => {
        w.rotation.x -= (car.zSpeed / 0.35) * delta;
      });

      const relX = car.currentX - this.playerX;
      const relZ = car.mesh.position.z; // +Z is behind player, -Z is ahead of player
      const isoY = -relZ; // ISO 8855: +Y is ahead, -Y is behind
      const dist = calculateDistance(relX, isoY);
      const az = calculateAzimuth(relX, isoY);

      // Determine proxy target for this vehicle
      let proxyTarget: ProxyTarget = 'FRONT_WINDSHIELD';
      if (relZ > -3.5 && relZ < 24.0 && relX < -1.6 && relX > -6.5) {
        proxyTarget = 'LEFT_MIRROR';
      } else if (relZ > -3.5 && relZ < 24.0 && relX > 1.6 && relX < 6.5) {
        proxyTarget = 'RIGHT_MIRROR';
      } else if (relZ >= 3.5 && Math.abs(relX) <= 2.2) {
        proxyTarget = 'REAR_MIRROR';
      } else if (az <= -45 && az > -135) {
        proxyTarget = 'LEFT_MIRROR';
      } else if (az >= 45 && az < 135) {
        proxyTarget = 'RIGHT_MIRROR';
      } else if (Math.abs(az) >= 135) {
        proxyTarget = 'REAR_MIRROR';
      }

      // Check if vehicle is in an active ADAS threat zone
      const isLeftBlindSpot = relZ > -3.0 && relZ < 20.0 && relX < -1.6 && relX > -6.2;
      const isRightBlindSpot = relZ > -3.0 && relZ < 20.0 && relX > 1.6 && relX < 6.2;
      const isRearTailgate = relZ > 4.0 && relZ < 34.0 && Math.abs(relX) <= 2.2 && relativeSpeed > 1.5;
      const isFrontHazard = relZ < -3.0 && relZ > -26.0 && Math.abs(relX) <= 2.1 && relativeSpeed < -1.0;

      if (isFrontHazard) {
        detectedFrontWarning = true;
      }

      // Trigger ADAS Alert when entering Left/Right Blind Spot or Rear Tailgate zone
      if (!car.isAcknowledged) {
        if ((isLeftBlindSpot || isRightBlindSpot) && !car.blindSpotNotified) {
          car.blindSpotNotified = true;
          const side: MirrorSide = isLeftBlindSpot ? 'left' : 'right';
          this.activeAlert = side;
          this.lastAlertTimestamp = performance.now();

          if (side === 'left' && this.leftMirrorBSM) {
            (this.leftMirrorBSM.material as THREE.MeshBasicMaterial).color.setHex(0xef4444);
          } else if (side === 'right' && this.rightMirrorBSM) {
            (this.rightMirrorBSM.material as THREE.MeshBasicMaterial).color.setHex(0xef4444);
          }

          (car.hazardRing.material as THREE.MeshBasicMaterial).color.setHex(0xef4444);
          (car.hazardRing.material as THREE.MeshBasicMaterial).opacity = 0.75;

          this.onTrafficEvent?.({
            type: 'blind_spot',
            side,
            timestamp: Date.now(),
            vehicleId: car.id
          });
        } else if (isRearTailgate && !car.tailgateNotified) {
          car.tailgateNotified = true;
          this.activeAlert = 'rear';
          this.lastAlertTimestamp = performance.now();

          (car.hazardRing.material as THREE.MeshBasicMaterial).color.setHex(0xf59e0b);
          (car.hazardRing.material as THREE.MeshBasicMaterial).opacity = 0.75;

          this.onTrafficEvent?.({
            type: 'tailgater',
            side: 'rear',
            timestamp: Date.now(),
            vehicleId: car.id
          });
        }
      }

      // Clear activeAlert if the alerting car has already passed well ahead of the player (relZ < -5)
      if (car.blindSpotNotified && relZ < -5.5 && this.activeAlert !== null) {
        const side: MirrorSide = relX < 0 ? 'left' : 'right';
        if (this.activeAlert === side) {
          this.activeAlert = null;
        }
      }

      // Collect threats within 35m for 3D Spatial Audio & 2D Radar sync
      if (dist <= 35.0) {
        if (closestThreatDist === null || dist < closestThreatDist) {
          closestThreatDist = Math.round(dist * 10) / 10;
          closestThreatClosingKmh = Math.round(relativeSpeed * 3.6);
        }

        currentThreats.push({
          id: `car_${car.id}`,
          name: car.name,
          x: parseFloat(relX.toFixed(2)),
          y: parseFloat(isoY.toFixed(2)),
          speedX: 0,
          speedY: parseFloat(relativeSpeed.toFixed(2)),
          distance: parseFloat(dist.toFixed(1)),
          azimuth: parseFloat(az.toFixed(1)),
          proxyTarget,
          isPrimary: false
        });
      }

      // Despawn vehicles once far ahead or far behind
      if (car.mesh.position.z < -135 || car.mesh.position.z > 110) {
        this.scene.remove(car.mesh);
        this.trafficCars.splice(i, 1);
      }
    }

    this.activeFrontWarning = detectedFrontWarning;

    // Sort threats so the most urgent unacknowledged blind-spot/tailgater threat is Primary for 3D Audio
    currentThreats.sort((a, b) => a.distance - b.distance);
    if (currentThreats.length > 0) {
      currentThreats[0].isPrimary = true;
    }

    // Update 3D Ground Sensor Ring & Dashboard Ambient LED Strip colors
    const flashFast = Math.floor(this.elapsedTime * 7) % 2 === 0;
    if (this.sensorZoneLeft) {
      const mat = this.sensorZoneLeft.material as THREE.MeshBasicMaterial;
      mat.color.setHex(this.activeAlert === 'left' ? (flashFast ? 0xef4444 : 0xf59e0b) : 0x00f0ff);
      mat.opacity = this.activeAlert === 'left' ? 0.45 : 0.12;
    }
    if (this.sensorZoneRight) {
      const mat = this.sensorZoneRight.material as THREE.MeshBasicMaterial;
      mat.color.setHex(this.activeAlert === 'right' ? (flashFast ? 0xef4444 : 0xf59e0b) : 0x00f0ff);
      mat.opacity = this.activeAlert === 'right' ? 0.45 : 0.12;
    }
    if (this.sensorZoneRear) {
      const mat = this.sensorZoneRear.material as THREE.MeshBasicMaterial;
      mat.color.setHex(this.activeAlert === 'rear' ? (flashFast ? 0xef4444 : 0xf59e0b) : 0x00f0ff);
      mat.opacity = this.activeAlert === 'rear' ? 0.45 : 0.1;
    }
    if (this.dashAmbientStrip) {
      const mat = this.dashAmbientStrip.material as THREE.MeshBasicMaterial;
      mat.color.setHex(
        this.activeAlert
          ? flashFast
            ? 0xef4444
            : 0xf59e0b
          : this.activeFrontWarning
          ? 0xf59e0b
          : 0x00f0ff
      );
    }

    // 6. Collision Detection & Physics Response
    this.checkCollisions(delta);

    // 7. Update Sparks
    this.updateSparks(delta);

    // 8. Dynamic RPM & Gear Calculation
    const speedKmh = Math.round(this.playerSpeed * 3.6);
    let gear = 'D5';
    let rpm = 2600 + (this.playerSpeed - 20) * 115;
    if (speedKmh > 130) {
      gear = 'D6';
      rpm = 3200 + (speedKmh - 130) * 65;
    } else if (speedKmh > 95) {
      gear = 'D5';
      rpm = 2700 + (speedKmh - 95) * 75;
    } else if (speedKmh > 65) {
      gear = 'D4';
      rpm = 2400 + (speedKmh - 65) * 85;
    } else {
      gear = 'D3';
      rpm = 2100 + speedKmh * 45;
    }
    rpm = Math.max(1100, Math.min(7800, Math.round(rpm)));

    // 9. Update Live Cockpit Digital LCD Texture
    this.updateClusterScreen(speedKmh, rpm, gear);

    // 10. Push Live Telemetry & Threats to React (~15 Hz throttling)
    const now = performance.now();
    if (now - this.lastHUDUpdate > 65 || this.activeAlert !== this.lastSentAlert) {
      this.lastHUDUpdate = now;
      this.lastSentAlert = this.activeAlert;

      this.onThreatsUpdate?.(currentThreats);

      this.onHUDUpdate?.({
        speedKmh,
        rpm,
        score: this.score,
        streak: this.streak,
        distanceM: Math.round(this.distanceTraveled),
        gear,
        activeAlert: this.activeAlert,
        activeFrontWarning: this.activeFrontWarning,
        lastReactionMs: this.lastReactionMs,
        collisionWarning: this.collisionCooldown > 0,
        damage: this.damage,
        cameraMode: this.cameraMode,
        autoPilot: this.autoPilot,
        currentLane: this.getClosestPlayerLaneIndex() + 1,
        threatDistanceM: closestThreatDist,
        threatClosingKmh: closestThreatClosingKmh
      });
    }

    // 11. Render Scene with Multi-Viewport Mirrors
    if (this.container && this.container.clientWidth > 0 && this.container.clientHeight > 0) {
      const curW = this.container.clientWidth;
      const curH = this.container.clientHeight;
      if (Math.abs(curW - this.lastRenderW) > 1 || Math.abs(curH - this.lastRenderH) > 1) {
        this.handleResize();
      }
      this.renderScene(curW, curH);
    }
  };
}
