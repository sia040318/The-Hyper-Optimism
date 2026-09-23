export interface CarlaTelemetry {
  threats: Array<{
    id: string;
    type: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }>;
  ego_speed_kph: number;
}

export type CarlaListener = (data: CarlaTelemetry) => void;

export class CarlaBridgeService {
  private ws: WebSocket | null = null;
  private url: string;
  private isConnected = false;
  private listeners: Set<CarlaListener> = new Set();
  private reconnectTimer: number | null = null;

  constructor(url = 'ws://127.0.0.1:8765/carla') {
    this.url = url;
  }

  public start() {
    this.connect();
  }

  private connect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log(`[CARLA Bridge] Connected to CARLA bridge on ${this.url}`);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.listeners.forEach((l) => l(data));
        } catch {}
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        if (this.ws) {
          try { this.ws.close(); } catch {}
        }
      };
    } catch {
      this.isConnected = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected) {
        this.connect();
      }
    }, 5000);
  }

  public subscribe(listener: CarlaListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public cleanup() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(); } catch {}
    }
    this.listeners.clear();
  }
}
