import * as THREE from 'three';

export type MirrorSide = 'left' | 'right' | 'rear';

export interface TrafficEvent {
  type: 'blind_spot' | 'overtaking';
  side: 'left' | 'right';
  timestamp: number;
  vehicleId: string;
}

export interface GameEngineOptions {
  onTrafficEvent?: (event: TrafficEvent) => void;
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
  
  private trafficCars: { mesh: THREE.Group, id: string, lane: number, zSpeed: number, blindSpotNotified: boolean, overtakingNotified: boolean, isAcknowledged: boolean }[] = [];
  private roadGroup: THREE.Group;
  
  // Mirror viewport sizes
  private mirrorWidthRatio = 0.26;
  private mirrorHeightRatio = 0.26;
  private timeSinceLastSpawn: number = 0;

  constructor(options?: GameEngineOptions) {
    this.onTrafficEvent = options?.onTrafficEvent;
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
    this.scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    
    this.clock = new THREE.Clock();

    // Cameras
    this.mainCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.mainCamera.position.set(0, 1.2, 0); // Driver's head position

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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 50);
    this.scene.add(dirLight);

    // Environment
    this.roadGroup = this.createEnvironment();
    this.scene.add(this.roadGroup);

    // Player Car Interior
    this.createPlayerCar();

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
  }

  private createEnvironment(): THREE.Group {
    const group = new THREE.Group();
    
    // Road
    const roadGeo = new THREE.PlaneGeometry(12, 200);
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    group.add(road);

    // Lane lines
    for (let i = -1; i <= 1; i += 2) {
      for (let j = 0; j < 20; j++) {
        const lineGeo = new THREE.PlaneGeometry(0.1, 3);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(i * 2, 0.01, -j * 10 + 50);
        group.add(line);
      }
    }

    // Grass
    const grassGeo = new THREE.PlaneGeometry(200, 200);
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.01;
    group.add(grass);

    return group;
  }

  private createPlayerCar() {
    // Dashboard
    const dashGeo = new THREE.BoxGeometry(2, 0.5, 1);
    const dashMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.position.set(0, 0.6, -1.0);
    this.scene.add(dash);

    // Hood
    const hoodGeo = new THREE.BoxGeometry(2, 0.1, 2);
    const hoodMat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const hood = new THREE.Mesh(hoodGeo, hoodMat);
    hood.position.set(0, 0.4, -2.5);
    this.scene.add(hood);

    // Steering wheel group
    const wheelGroup = new THREE.Group();
    const wheelMat = new THREE.MeshBasicMaterial({ color: 0x222222 }); // Dark charcoal
    
    // Ring
    const ringGeo = new THREE.TorusGeometry(0.18, 0.03, 16, 32);
    const ring = new THREE.Mesh(ringGeo, wheelMat);
    wheelGroup.add(ring);
    
    // Hub
    const hubGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.05, 16);
    const hub = new THREE.Mesh(hubGeo, wheelMat);
    hub.rotation.x = Math.PI / 2;
    wheelGroup.add(hub);
    
    // Spoke (horizontal)
    const spokeGeo = new THREE.BoxGeometry(0.36, 0.02, 0.02);
    const spoke = new THREE.Mesh(spokeGeo, wheelMat);
    wheelGroup.add(spoke);
    
    // Spoke (vertical bottom)
    const spokeVertGeo = new THREE.BoxGeometry(0.02, 0.18, 0.02);
    const spokeVert = new THREE.Mesh(spokeVertGeo, wheelMat);
    spokeVert.position.y = -0.09;
    wheelGroup.add(spokeVert);
    
    // Position and tilt
    wheelGroup.position.set(0, 0.65, -0.65); // Centered, low
    wheelGroup.rotation.x = -Math.PI * (65 / 180); // Tilt back towards driver
    
    this.scene.add(wheelGroup);
  }

  private createTrafficCar(lane: number, initialZ: number): THREE.Group {
    const carGroup = new THREE.Group();
    
    // Body - using MeshBasicMaterial so it's always brightly visible
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.7, 3.8); // Slightly larger
    const brightColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8800];
    const color = brightColors[Math.floor(Math.random() * brightColors.length)];
    const bodyMat = new THREE.MeshBasicMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.4;
    carGroup.add(body);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.4, 0.5, 2);
    const cabinMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.9, 0);
    carGroup.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
    const wheelMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const wheelPositions = [
      [-0.8, 0.3, -1.2], [0.8, 0.3, -1.2],
      [-0.8, 0.3, 1.2], [0.8, 0.3, 1.2]
    ];
    wheelPositions.forEach(pos => {
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
    const lanes = [-1, 1]; // Left and right lanes (relative to center player lane)
    const lane = lanes[Math.floor(Math.random() * lanes.length)];
    const speed = 15 + Math.random() * 5; // Faster relative speed
    const spawnZ = 60; // Spawn behind player so they approach from rear
    const car = this.createTrafficCar(lane, spawnZ);
    
    console.log(`[GameEngine] Spawned traffic car at (x: ${car.position.x}, y: ${car.position.y}, z: ${car.position.z}) in lane ${lane}. Target speed: ${speed}`);
    
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
    this.trafficCars.forEach(car => this.scene.remove(car.mesh));
    this.trafficCars = [];
  }

  public notifyMirrorCheck(side: MirrorSide) {
    // Acknowledge relevant threats
    this.trafficCars.forEach(car => {
      if (!car.isAcknowledged && (car.blindSpotNotified || car.overtakingNotified)) {
        if ((side === 'left' && car.lane < 0) || (side === 'right' && car.lane > 0)) {
          car.isAcknowledged = true;
          // Visual feedback
          const bodyMesh = car.mesh.children[0] as THREE.Mesh;
          (bodyMesh.material as THREE.MeshLambertMaterial).color.setHex(0x00ff00);
        }
      }
    });
  }

  public getMirrorRegions(): Record<MirrorSide, NormalizedRect> {
    // Assuming the renderer canvas fills the container
    // Left mirror: left edge, vertically centered
    // Right mirror: right edge, vertically centered
    // Rear mirror: top center
    return {
      left: { x: 0, y: 0.4, width: this.mirrorWidthRatio, height: this.mirrorHeightRatio },
      right: { x: 1 - this.mirrorWidthRatio, y: 0.4, width: this.mirrorWidthRatio, height: this.mirrorHeightRatio },
      rear: { x: 0.5 - this.mirrorWidthRatio/2, y: 0, width: this.mirrorWidthRatio, height: this.mirrorHeightRatio }
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

  private renderMirrorWithBorder(x: number, y: number, w: number, h: number, camera: THREE.Camera) {
    // Render border
    this.renderer.setViewport(x, y, w, h);
    this.renderer.setScissor(x, y, w, h);
    this.renderer.setClearColor(0x333333); // Dark border
    this.renderer.clear();
    
    // Render mirror content slightly smaller
    const border = 4;
    this.renderer.setViewport(x + border, y + border, w - border * 2, h - border * 2);
    this.renderer.setScissor(x + border, y + border, w - border * 2, h - border * 2);
    this.renderer.setClearColor(0x87CEEB); // Sky color
    this.renderer.render(this.scene, camera);
  }

  private renderMirrors(w: number, h: number) {
    const mw = w * this.mirrorWidthRatio;
    const mh = h * this.mirrorHeightRatio;

    // Render Main View
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.setClearColor(0x87CEEB);
    this.renderer.render(this.scene, this.mainCamera);

    this.renderer.setScissorTest(true);

    // Left Mirror
    const lx = 0;
    const ly = h * 0.4;
    this.renderMirrorWithBorder(lx, ly, mw, mh, this.leftMirrorCamera);

    // Right Mirror
    const rx = w - mw;
    const ry = h * 0.4;
    this.renderMirrorWithBorder(rx, ry, mw, mh, this.rightMirrorCamera);

    // Rear Mirror
    const cx = (w - mw) / 2;
    const cy = h - mh; // Top
    this.renderMirrorWithBorder(cx, cy, mw, mh, this.rearMirrorCamera);

    this.renderer.setScissorTest(false);
  }

  private loop = () => {
    if (!this.isRunning) return;
    
    this.animationFrameId = requestAnimationFrame(this.loop);
    
    const delta = this.clock.getDelta();
    
    // Move road lines to simulate speed
    this.roadGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry && child.scale.y === 1 && child.position.x !== 0 && child.position.y > 0) { // Check for lane lines
          child.position.z += 10 * delta; // Player speed
          if (child.position.z > 50) {
            child.position.z -= 100;
          }
      }
    });

    this.timeSinceLastSpawn += delta;

    // Handle traffic
    if (this.timeSinceLastSpawn > 12 || (this.timeSinceLastSpawn > 3 && Math.random() < 0.003)) {
      this.spawnCar();
      this.timeSinceLastSpawn = 0;
    }

    for (let i = this.trafficCars.length - 1; i >= 0; i--) {
      const car = this.trafficCars[i];
      // Car speed > player speed. Car moves towards -Z relative to player.
      // E.g., spawn at z=60, moves towards z=-100.
      const relativeSpeed = car.zSpeed - 10;
      car.mesh.position.z -= relativeSpeed * delta;

      // Blind spot check: roughly between z=10 and z=0 (behind player, moving forward)
      if (!car.blindSpotNotified && car.mesh.position.z < 10 && car.mesh.position.z > 0) {
        car.blindSpotNotified = true;
        if (this.onTrafficEvent) {
          this.onTrafficEvent({
            type: 'blind_spot',
            side: car.lane < 0 ? 'left' : 'right',
            timestamp: Date.now(),
            vehicleId: car.id
          });
        }
      }

      // Overtaking check: passing z = -5
      if (!car.overtakingNotified && car.mesh.position.z < -5) {
        car.overtakingNotified = true;
        if (this.onTrafficEvent) {
          this.onTrafficEvent({
            type: 'overtaking',
            side: car.lane < 0 ? 'left' : 'right',
            timestamp: Date.now(),
            vehicleId: car.id
          });
        }
      }

      if (car.mesh.position.z < -100) {
        this.scene.remove(car.mesh);
        this.trafficCars.splice(i, 1);
      }
    }

    if (this.container) {
      this.renderMirrors(this.container.clientWidth, this.container.clientHeight);
    }
  }
}
