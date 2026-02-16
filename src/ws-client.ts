import WebSocket from "ws";
import type { InboundAgentGateMessage, OutboundAgentGateMessage } from "./types.js";

export interface WebSocketClientOptions {
  url: string;
  token: string;
  reconnectIntervalMs: number;
  maxReconnectIntervalMs: number;
  pingIntervalMs: number;
  onMessage: (message: InboundAgentGateMessage) => Promise<void>;
  onConnect?: (channelId: string, humans: string[]) => void;
  onError?: (error: Error) => void;
  onDisconnect?: () => void;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private pingInterval: NodeJS.Timeout | null = null;
  private destroyed = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(private options: WebSocketClientOptions) {}

  async start(abortSignal?: AbortSignal): Promise<void> {
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        this.stop();
      });
    }

    this.connect();
  }

  stop(): void {
    this.destroyed = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, "stopped");
      this.ws = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  send(message: OutboundAgentGateMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error("WebSocket is not connected");
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.destroyed) return;

    const wsUrl = this.options.url.replace(/^http/, "ws") + "/api/channel/";
    this.options.log?.info(`Connecting to AgentGate: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${this.options.token}`,
      },
    });

    this.ws.on("open", () => {
      this.options.log?.info("Connected to AgentGate channel");
      this.reconnectAttempts = 0;
      this.startPing();
    });

    this.ws.on("message", async (data: Buffer | string) => {
      try {
        const message: InboundAgentGateMessage = JSON.parse(data.toString());

        if (message.type === "connected") {
          this.options.onConnect?.(message.channelId, message.humans);
        }

        await this.options.onMessage(message);
      } catch (error) {
        this.options.log?.error(`Failed to parse message: ${error}`);
      }
    });

    this.ws.on("close", (code, reason) => {
      this.options.log?.warn(`AgentGate WebSocket closed: ${code} ${reason.toString()}`);
      this.cleanup();
      this.options.onDisconnect?.();
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      this.options.log?.error(`AgentGate WebSocket error: ${error.message}`);
      this.options.onError?.(error);
    });
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: "ping" });
      }
    }, this.options.pingIntervalMs);
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      this.options.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts - 1),
      this.options.maxReconnectIntervalMs,
    );

    this.options.log?.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
