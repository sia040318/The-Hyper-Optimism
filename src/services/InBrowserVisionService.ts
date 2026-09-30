import { FilesetResolver, FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { GazeZone, HeadPose, GazeUpdateMessage, InBrowserVisionDiagnostics } from '../types/gaze';

export type VisionGazeListener = (msg: GazeUpdateMessage) => void;

// Landmark indices corresponding to facial points
export const LANDMARK_INDICES = {
  noseTip: 1,
  chin: 152,
  forehead: 10,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeOuter: 263,
  rightEyeInner: 362,
  leftCheek: 234,
  rightCheek: 454,
  leftMouth: 61,
  rightMouth: 291
};

// Left and Right Iris landmark indices in MediaPipe 478-point mesh
export const IRIS_INDICES = {
  left: [468, 469, 470, 471, 472], // 468 is iris center
  right: [473, 474, 475, 476, 477] // 473 is iris center
};

/**
 * DirectionStabilizer:
 * Requires a candidate direction to remain stable for a configurable threshold
 * before confirming, preventing accidental triggers from quick eye saccades.
 */
export class DirectionStabilizer {
  private confirmationMs: number;
  private candidateZone: GazeZone = 'CENTER';
  private candidateStartedAt: number = performance.now();
  private confirmedZone: GazeZone = 'CENTER';

  constructor(confirmationMs = 300) {
    this.confirmationMs = confirmationMs;
  }

  public setConfirmationMs(ms: number) {
    this.confirmationMs = Math.max(50, ms);
  }

  public update(rawZone: GazeZone, now = performance.now()) {
    if (rawZone !== this.candidateZone) {
      this.candidateZone = rawZone;
      this.candidateStartedAt = now;
    }

    const elapsed = Math.max(0, now - this.candidateStartedAt);
    const dwellProgress = Math.min(1.0, elapsed / this.confirmationMs);
    const isConfirmed = elapsed >= this.confirmationMs;

    if (isConfirmed) {
      this.confirmedZone = rawZone;
    }

    return {
      rawZone,
      candidateZone: this.candidateZone,
      confirmedZone: this.confirmedZone,
      elapsedMs: Math.round(elapsed),
      dwellProgress,
      isConfirmed
    };
  }

  public reset(zone: GazeZone = 'CENTER') {
    this.candidateZone = zone;
    this.confirmedZone = zone;
    this.candidateStartedAt = performance.now();
  }

  public getConfirmedZone(): GazeZone {
    return this.confirmedZone;
  }
}

export class InBrowserVisionService {
  private faceLandmarker: FaceLandmarker | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private stabilizer = new DirectionStabilizer(300);
  private listeners: Set<VisionGazeListener> = new Set();

  private isRunning = false;
  private isInitializing = false;
  private fps = 0;
  private frameCount = 0;
  private fpsLastSample = performance.now();
  private animFrameId: number | null = null;

  // Smoothing buffers for head pose
  private smoothedYaw = 0;
  private smoothedPitch = 0;
  private smoothedRoll = 0;

  // Last detected landmarks for canvas drawing
  private lastLandmarks: NormalizedLandmark[] | null = null;
  private lastIrisRatio: number | null = null;
  private lastDiagnostics: InBrowserVisionDiagnostics | null = null;

  constructor() {}

  /**
   * Initialize MediaPipe FaceLandmarker with GPU delegate and WebAssembly
   */
  public async init(): Promise<boolean> {
    if (this.faceLandmarker) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;
    try {
      console.log('[InBrowserVision] Loading MediaPipe FilesetResolver...');
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      console.log('[InBrowserVision] Creating FaceLandmarker instance...');
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU'
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      console.log('[InBrowserVision] FaceLandmarker initialized successfully!');
      this.isInitializing = false;
      return true;
    } catch (err) {
      console.error('[InBrowserVision] Failed to initialize FaceLandmarker:', err);
      this.isInitializing = false;
      return false;
    }
  }

  /**
   * Start camera and real-time inference loop
   */
  public async start(videoElement: HTMLVideoElement): Promise<boolean> {
    if (this.isRunning) return true;

    const initialized = await this.init();
    if (!initialized) {
      console.warn('[InBrowserVision] Cannot start: Landmarker initialization failed.');
      return false;
    }

    try {
      this.videoEl = videoElement;
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();

      this.isRunning = true;
      this.stabilizer.reset('CENTER');
      this.fpsLastSample = performance.now();
      this.frameCount = 0;

      // Start inference render loop
      this.loop();
      console.log('[InBrowserVision] Camera tracking active at 640x480');
      return true;
    } catch (err) {
      console.error('[InBrowserVision] Error opening webcam stream:', err);
      this.stop();
      return false;
    }
  }

  /**
   * Stop camera and inference loop
   */
  public stop() {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }

    this.lastLandmarks = null;
    this.lastIrisRatio = null;
    console.log('[InBrowserVision] Camera tracking stopped.');
  }

  /**
   * Continuous processing loop tied to requestAnimationFrame
   */
  private loop = () => {
    if (!this.isRunning || !this.videoEl || !this.faceLandmarker) return;

    const now = performance.now();
    const startTime = performance.now();

    // Check if video is ready for processing
    if (this.videoEl.readyState >= 2 && !this.videoEl.paused && !this.videoEl.ended) {
      // Calculate FPS
      this.frameCount++;
      if (now - this.fpsLastSample >= 1000) {
        this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsLastSample));
        this.frameCount = 0;
        this.fpsLastSample = now;
      }

      try {
        const results = this.faceLandmarker.detectForVideo(this.videoEl, now);
        const latencyMs = Math.round(performance.now() - startTime);

        if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
          const landmarks = results.faceLandmarks[0];
          this.lastLandmarks = landmarks;

          // 1. Compute 3D Head Pose
          const pose = this.computeHeadPose(results, landmarks);

          // 2. Compute Horizontal Iris Gaze Ratio
          const irisRatio = this.computeIrisGaze(landmarks);
          this.lastIrisRatio = irisRatio;

          // 3. Classify Direction Zone
          const rawZone = this.classifyZone(pose.yaw, pose.pitch, irisRatio);

          // 4. Stabilize with Dwell Window
          const stab = this.stabilizer.update(rawZone, now);

          const diagnostics: InBrowserVisionDiagnostics = {
            fps: this.fps,
            latencyMs,
            irisRatio,
            candidateZone: stab.candidateZone,
            confirmedZone: stab.confirmedZone,
            dwellProgress: stab.dwellProgress,
            isConfirmed: stab.isConfirmed,
            landmarksDetected: true
          };
          this.lastDiagnostics = diagnostics;

          const msg: GazeUpdateMessage = {
            type: 'GAZE_UPDATE',
            timestamp: now / 1000,
            gaze_zone: stab.confirmedZone,
            confidence: 0.96,
            head_pose: pose,
            dwell_time_ms: stab.elapsedMs,
            face_detected: true,
            iris_ratio: irisRatio,
            diagnostics
          };

          this.notifyListeners(msg);
        } else {
          this.lastLandmarks = null;
          // No face detected in frame
          const diagnostics: InBrowserVisionDiagnostics = {
            fps: this.fps,
            latencyMs,
            irisRatio: null,
            candidateZone: 'UNKNOWN',
            confirmedZone: null,
            dwellProgress: 0,
            isConfirmed: false,
            landmarksDetected: false
          };
          this.lastDiagnostics = diagnostics;

          const msg: GazeUpdateMessage = {
            type: 'GAZE_UPDATE',
            timestamp: now / 1000,
            gaze_zone: 'CENTER',
            confidence: 0,
            head_pose: { pitch: 0, yaw: 0, roll: 0 },
            dwell_time_ms: 0,
            face_detected: false,
            diagnostics
          };
          this.notifyListeners(msg);
        }
      } catch (e) {
        console.warn('[InBrowserVision] Frame inference warning:', e);
      }
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  /**
   * Extract Head Pose Euler Angles (Pitch, Yaw, Roll)
   * Prefers transformation matrix; falls back to geometric landmark triangulation.
   */
  private computeHeadPose(results: any, landmarks: NormalizedLandmark[]): HeadPose {
    let rawYaw = 0;
    let rawPitch = 0;
    let rawRoll = 0;

    // A. Method 1: Decomposition of facial transformation matrix
    if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
      const mat = results.facialTransformationMatrixes[0].data;
      // 4x4 Column-Major Matrix from MediaPipe
      // Rotation elements used for Euler angles:
      const r10 = mat[1];
      const r11 = mat[5];
      const r02 = mat[8];
      const r12 = mat[9];
      const r22 = mat[10];

      // Pitch (X), Yaw (Y), Roll (Z) in degrees
      // Note: Video frame is mirrored in driver's intuitive perception
      const pitchRad = Math.asin(-Math.max(-1, Math.min(1, r12)));
      const yawRad = Math.atan2(r02, r22);
      const rollRad = Math.atan2(r10, r11);

      rawPitch = pitchRad * (180 / Math.PI);
      rawYaw = yawRad * (180 / Math.PI);
      rawRoll = rollRad * (180 / Math.PI);
    } else {
      // B. Method 2: Geometric fallback from facial symmetry landmarks
      const nose = landmarks[LANDMARK_INDICES.noseTip];
      const leftEye = landmarks[LANDMARK_INDICES.leftEyeOuter];
      const rightEye = landmarks[LANDMARK_INDICES.rightEyeOuter];
      const chin = landmarks[LANDMARK_INDICES.chin];

      // Horizontal Yaw: Nose relative to mid-eye point
      const midEyeX = (leftEye.x + rightEye.x) / 2;
      const eyeDist = Math.abs(rightEye.x - leftEye.x);
      if (eyeDist > 0.01) {
        const yawNormalized = (nose.x - midEyeX) / eyeDist;
        rawYaw = yawNormalized * 75; // scale to degree approximation
      }

      // Vertical Pitch: Chin-to-nose vs nose-to-eye ratio
      const midEyeY = (leftEye.y + rightEye.y) / 2;
      const faceHeight = Math.abs(chin.y - midEyeY);
      if (faceHeight > 0.01) {
        const pitchNormalized = ((chin.y - nose.y) - (nose.y - midEyeY)) / faceHeight;
        rawPitch = pitchNormalized * 60;
      }

      // Roll: Angle between eyes
      rawRoll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);
    }

    // Invert Yaw so that Driver turning to their LEFT is NEGATIVE and RIGHT is POSITIVE
    // This matches the Python cv_mediapipe_template and SpatialAudioEngine convention!
    const canonicalYaw = -rawYaw;
    const canonicalPitch = rawPitch;
    const canonicalRoll = rawRoll;

    // Exponential smoothing filter (alpha = 0.40) to eliminate high-frequency jitter
    const alpha = 0.40;
    this.smoothedYaw = this.smoothedYaw * (1 - alpha) + canonicalYaw * alpha;
    this.smoothedPitch = this.smoothedPitch * (1 - alpha) + canonicalPitch * alpha;
    this.smoothedRoll = this.smoothedRoll * (1 - alpha) + canonicalRoll * alpha;

    return {
      yaw: Math.round(this.smoothedYaw * 10) / 10,
      pitch: Math.round(this.smoothedPitch * 10) / 10,
      roll: Math.round(this.smoothedRoll * 10) / 10
    };
  }

  /**
   * Compute Horizontal Iris Gaze Ratio (Ported from standalone_driver_monitor.py)
   * Returns a float from 0.0 (looking far left) to 1.0 (looking far right).
   * 0.50 represents center forward gaze.
   */
  private computeIrisGaze(landmarks: NormalizedLandmark[]): number | null {
    if (landmarks.length < 478) return null;

    const leftOuter = landmarks[LANDMARK_INDICES.leftEyeOuter];
    const leftInner = landmarks[LANDMARK_INDICES.leftEyeInner];
    const rightOuter = landmarks[LANDMARK_INDICES.rightEyeOuter];
    const rightInner = landmarks[LANDMARK_INDICES.rightEyeInner];

    // Left eye iris centroid
    let leftIrisX = 0;
    for (const idx of IRIS_INDICES.left) {
      leftIrisX += landmarks[idx].x;
    }
    leftIrisX /= IRIS_INDICES.left.length;

    // Right eye iris centroid
    let rightIrisX = 0;
    for (const idx of IRIS_INDICES.right) {
      rightIrisX += landmarks[idx].x;
    }
    rightIrisX /= IRIS_INDICES.right.length;

    // Left Eye horizontal iris ratio
    const leftMinX = Math.min(leftOuter.x, leftInner.x);
    const leftMaxX = Math.max(leftOuter.x, leftInner.x);
    const leftWidth = leftMaxX - leftMinX;
    const leftRatio = leftWidth > 0 ? (leftIrisX - leftMinX) / leftWidth : 0.5;

    // Right Eye horizontal iris ratio
    const rightMinX = Math.min(rightOuter.x, rightInner.x);
    const rightMaxX = Math.max(rightOuter.x, rightInner.x);
    const rightWidth = rightMaxX - rightMinX;
    const rightRatio = rightWidth > 0 ? (rightIrisX - rightMinX) / rightWidth : 0.5;

    // Average both eyes and normalize for driver perspective
    const avgRatio = (leftRatio + rightRatio) / 2;
    // Mirrored camera feed: driver looking left moves iris toward right of image
    const driverIrisRatio = 1.0 - Math.max(0, Math.min(1, avgRatio));

    return Math.round(driverIrisRatio * 100) / 100;
  }

  /**
   * Classify Compound Head Pose & Iris Gaze into ADAS Mirror Zones
   * Pitch: positive = looking UP (Rear Mirror)
   * Yaw: negative = looking LEFT (Left Side Mirror), positive = looking RIGHT (Right Side Mirror)
   */
  public classifyZone(yawDeg: number, pitchDeg: number, irisRatio: number | null): GazeZone {
    // 1. Rear-View Mirror Check (Driver tilts head up toward center mirror)
    if (pitchDeg >= 12.0 && Math.abs(yawDeg) <= 18.0) {
      return 'REAR_MIRROR';
    }

    // 2. Left Side Mirror Check (Turn head left or eye glance left)
    const isHeadLeft = yawDeg <= -18.0;
    const isGlanceLeft = yawDeg <= -10.0 && irisRatio !== null && irisRatio <= 0.40;
    if (isHeadLeft || isGlanceLeft) {
      return 'LEFT_MIRROR';
    }

    // 3. Right Side Mirror Check (Turn head right or eye glance right)
    const isHeadRight = yawDeg >= 18.0;
    const isGlanceRight = yawDeg >= 10.0 && irisRatio !== null && irisRatio >= 0.60;
    if (isHeadRight || isGlanceRight) {
      return 'RIGHT_MIRROR';
    }

    // 4. Default: Center Windshield / Forward Road
    return 'CENTER';
  }

  /**
   * Render debug face mesh and iris indicators onto a canvas overlay
   */
  public drawDebugOverlay(canvas: HTMLCanvasElement) {
    if (!this.lastLandmarks || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Flip horizontally to match mirrored user webcam
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-w, 0);

    // 1. Draw Eye Contours
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 1.5;

    const drawPoint = (landmark: NormalizedLandmark, color: string, radius = 2) => {
      ctx.beginPath();
      ctx.arc(landmark.x * w, landmark.y * h, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };

    // Draw Nose & Chin
    drawPoint(this.lastLandmarks[LANDMARK_INDICES.noseTip], '#00f0ff', 3);
    drawPoint(this.lastLandmarks[LANDMARK_INDICES.chin], 'rgba(255, 255, 255, 0.5)', 2);

    // Draw Eye Corners
    drawPoint(this.lastLandmarks[LANDMARK_INDICES.leftEyeOuter], '#38bdf8', 2);
    drawPoint(this.lastLandmarks[LANDMARK_INDICES.leftEyeInner], '#38bdf8', 2);
    drawPoint(this.lastLandmarks[LANDMARK_INDICES.rightEyeOuter], '#38bdf8', 2);
    drawPoint(this.lastLandmarks[LANDMARK_INDICES.rightEyeInner], '#38bdf8', 2);

    // Draw Irises (Glowing Emerald)
    const leftIris = this.lastLandmarks[IRIS_INDICES.left[0]];
    const rightIris = this.lastLandmarks[IRIS_INDICES.right[0]];
    if (leftIris) drawPoint(leftIris, '#10b981', 4);
    if (rightIris) drawPoint(rightIris, '#10b981', 4);

    ctx.restore();
  }

  private notifyListeners(msg: GazeUpdateMessage) {
    this.listeners.forEach((listener) => {
      try {
        listener(msg);
      } catch (err) {
        console.error('[InBrowserVision] Listener dispatch error:', err);
      }
    });
  }

  public getLastIrisRatio(): number | null {
    return this.lastIrisRatio;
  }

  public subscribe(listener: VisionGazeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getFps(): number {
    return this.fps;
  }

  public getLastDiagnostics(): InBrowserVisionDiagnostics | null {
    return this.lastDiagnostics;
  }
}

// Global Singleton Instance
export const inBrowserVision = new InBrowserVisionService();
