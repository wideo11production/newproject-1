export class WebSocketClient {
  private static instance: WebSocketClient;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectInterval = 1000;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private url: string | null = null;

  private constructor() {}

  static getInstance(): WebSocketClient {
    if (!WebSocketClient.instance) {
      WebSocketClient.instance = new WebSocketClient();
    }
    return WebSocketClient.instance;
  }

  connect(url: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.url = url;
    this.reconnectAttempts = 0;

    try {
      this.ws = new WebSocket(url);
      console.log('[WebSocketClient] Connecting to:', url);
    } catch (error) {
      console.error('[WebSocketClient] Failed to create WebSocket:', error);
      return;
    }

    this.ws.onopen = () => {
      console.log('[WebSocketClient] Connected');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.emit(msg.type, msg.data);
      } catch (error) {
        console.error('[WebSocketClient] Failed to parse message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('[WebSocketClient] Disconnected');
      this.reconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocketClient] Error:', error);
      this.ws?.close();
    };
  }

  private reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocketClient] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts);
    console.log(`[WebSocketClient] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect(this.url!);
    }, delay);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.url = null;
  }

  emit(type: string, data: any): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error('[WebSocketClient] Listener error:', error);
        }
      });
    }
  }

  on(type: string, callback: (data: any) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);
    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  off(type: string, callback: (data: any) => void): void {
    this.listeners.get(type)?.delete(callback);
  }

  removeAllListeners(type?: string): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
    }
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}