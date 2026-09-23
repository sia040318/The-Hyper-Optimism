import { GazeZone, GazeUpdateMessage, HeadPose, InputMode } from '../types/gaze';

export type GazeListener = (msg: GazeUpdateMessage, mode: InputMode) => void;

export class CVBridgeService {
  private ws: WebSocket | null = null;
  private url: string;
  private isConnected = false;
  private listeners: Set<GazeListener> = new Set();
  private reconnectTimer: number | null = null;
  private currentMode: InputMode = 'SIMULATION';
  private simulatedZone: GazeZone = 'CENTER';
  private simulatedStartTime = Date.now();
  private simulatedPose: HeadPose = { pitch: 0, yaw: 0, roll: 0 };
  private simulationInterval: number | null = null;

  constructor(url = 'ws://127.0.0.1:8765/gaze') {
    this.url = url;
  }

  public start() {
    this.connectWebSocket();
    this.startSimulationTicker();
  }

  private connectWebSocket() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.currentMode = 'CV_WEBSOCKET';
        console.log(`[CV Bridge] Connected to live CV stream on ${this.url}`);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === 'GAZE_UPDATE') {
            this.currentMode = 'CV_WEBSOCKET';
            this.notifyListeners(data as GazeUpdateMessage, 'CV_WEBSOCKET');
          }
        } catch (e) {
          console.warn('[CV Bridge] Malformed JSON:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.currentMode = 'SIMULATION';
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this.currentMode = 'SIMULATION';
        if (this.ws) {
          try { this.ws.close(); } catch {}
        }
      };
    } catch {
      this.isConnected = false;
      this.currentMode = 'SIMULATION';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected) {
        this.connectWebSocket();
      }
    }, 4000);
  }

  /**
   * Simulation Mode: Allows keyboard or UI clicks to simulate driver gaze
   */
  public simulateGaze(zone: GazeZone) {
    if (this.simulatedZone !== zone) {
      this.simulatedZone = zone;
      this.simulatedStartTime = Date.now();

      // Estimate corresponding head pose
      switch (zone) {
        case 'LEFT_MIRROR':
          this.simulatedPose = { yaw: -28.0, pitch: 1.5, roll: 0 };
          break;
        case 'RIGHT_MIRROR':
          this.simulatedPose = { yaw: 28.0, pitch: 1.5, roll: 0 };
          break;
        case 'REAR_MIRROR':
          this.simulatedPose = { yaw: -1.0, pitch: 15.5, roll: 0 };
          break;
        case 'CENTER':
        default:
          this.simulatedPose = { yaw: 0, pitch: 0, roll: 0 };
          break;
      }
    }

    const dwell = Date.now() - this.simulatedStartTime;
    const msg: GazeUpdateMessage = {
      type: 'GAZE_UPDATE',
      timestamp: Date.now() / 1000,
      gaze_zone: this.simulatedZone,
      confidence: 1.0,
      head_pose: this.simulatedPose,
      dwell_time_ms: dwell,
      face_detected: true
    };

    // If live CV is not active, emit simulation update
    if (!this.isConnected) {
      this.notifyListeners(msg, 'SIMULATION');
    }
  }

  private startSimulationTicker() {
    // Keeps sending dwell updates during simulation
    this.simulationInterval = window.setInterval(() => {
      if (!this.isConnected) {
        this.simulateGaze(this.simulatedZone);
      }
    }, 100);
  }

  public subscribe(listener: GazeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(msg: GazeUpdateMessage, mode: InputMode) {
    this.listeners.forEach((listener) => {
      try {
        listener(msg, mode);
      } catch (err) {
        console.error('[CV Bridge] Listener error:', err);
      }
    });
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getMode(): InputMode {
    return this.currentMode;
  }

  public cleanup() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(); } catch {}
    }
    this.listeners.clear();
  }
}
