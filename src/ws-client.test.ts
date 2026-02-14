import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketClient } from "./ws-client.js";
import type { InboundAgentGateMessage } from "./types.js";

// Mock WebSocket
const mockWebSocketInstances: any[] = [];

vi.mock("ws", () => {
  const WebSocketMock = vi.fn().mockImplementation(() => {
    const mockWebSocket = {
      readyState: 0, // CONNECTING initially, not OPEN
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      addEventListener: vi.fn(),
    };
    mockWebSocketInstances.push(mockWebSocket);
    return mockWebSocket;
  });

  // Add the constants as static properties
  WebSocketMock.OPEN = 1;
  WebSocketMock.CLOSED = 3;

  return {
    default: WebSocketMock,
  };
});

describe("WebSocketClient", () => {
  let client: WebSocketClient;
  let mockOnMessage: ReturnType<typeof vi.fn>;
  let mockOnConnect: ReturnType<typeof vi.fn>;
  let mockOnError: ReturnType<typeof vi.fn>;
  let mockOnDisconnect: ReturnType<typeof vi.fn>;
  let mockLog: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWebSocketInstances.length = 0;

    mockOnMessage = vi.fn();
    mockOnConnect = vi.fn();
    mockOnError = vi.fn();
    mockOnDisconnect = vi.fn();
    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    client = new WebSocketClient({
      url: "https://agentgate.example.com",
      token: "test-token",
      reconnectIntervalMs: 1000,
      maxReconnectIntervalMs: 5000,
      pingIntervalMs: 5000,
      onMessage: mockOnMessage,
      onConnect: mockOnConnect,
      onError: mockOnError,
      onDisconnect: mockOnDisconnect,
      log: mockLog,
    });
  });

  afterEach(() => {
    client.stop();
  });

  it("should create WebSocket with correct URL and headers", async () => {
    const WebSocket = (await import("ws")).default;

    await client.start();

    expect(WebSocket).toHaveBeenCalledWith("wss://agentgate.example.com/api/channel/", {
      headers: {
        Authorization: "Bearer test-token",
      },
    });
  });

  it("should handle connected message", async () => {
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    // Simulate WebSocket open event
    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const openHandler = onHandler.mock.calls.find(([event]) => event === "open")?.[1];
    mockWebSocket.readyState = 1; // WebSocket.OPEN
    openHandler?.();

    // Simulate connected message
    const messageHandler = onHandler.mock.calls.find(([event]) => event === "message")?.[1];
    const connectedMsg: InboundAgentGateMessage = {
      type: "connected",
      channelId: "test-channel",
      humans: ["conn1", "conn2"],
    };

    await messageHandler?.(Buffer.from(JSON.stringify(connectedMsg)));

    expect(mockOnConnect).toHaveBeenCalledWith("test-channel", ["conn1", "conn2"]);
    expect(mockOnMessage).toHaveBeenCalledWith(connectedMsg);
  });

  it("should handle human message", async () => {
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const messageHandler = onHandler.mock.calls.find(([event]) => event === "message")?.[1];

    const humanMsg: InboundAgentGateMessage = {
      type: "message",
      from: "human",
      text: "Hello!",
      id: "msg-123",
      timestamp: "2023-01-01T00:00:00Z",
      connId: "conn1",
    };

    await messageHandler?.(Buffer.from(JSON.stringify(humanMsg)));

    expect(mockOnMessage).toHaveBeenCalledWith(humanMsg);
  });

  it("should handle malformed JSON gracefully", async () => {
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const messageHandler = onHandler.mock.calls.find(([event]) => event === "message")?.[1];

    await messageHandler?.(Buffer.from("invalid json"));

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("Failed to parse message"));
  });

  it("should send messages when connected", async () => {
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    // Simulate WebSocket open event to establish connection
    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const openHandler = onHandler.mock.calls.find(([event]) => event === "open")?.[1];
    mockWebSocket.readyState = 1; // WebSocket.OPEN
    openHandler?.();

    const message = { type: "message" as const, text: "Hello!" };
    client.send(message);

    expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
  });

  it("should throw when sending while disconnected", async () => {
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];
    // Keep readyState as 0 (CONNECTING) or set to 3 (CLOSED) - both should fail
    mockWebSocket.readyState = 3; // WebSocket.CLOSED

    const message = { type: "message" as const, text: "Hello!" };

    expect(() => client.send(message)).toThrow("WebSocket is not connected");
  });

  it("should report connection status correctly", async () => {
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    // Initially not connected
    expect(client.isConnected()).toBe(false);

    // Simulate WebSocket open event to establish connection
    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const openHandler = onHandler.mock.calls.find(([event]) => event === "open")?.[1];
    mockWebSocket.readyState = 1; // WebSocket.OPEN
    openHandler?.();

    expect(client.isConnected()).toBe(true);

    mockWebSocket.readyState = 3; // WebSocket.CLOSED
    expect(client.isConnected()).toBe(false);
  });

  it("should handle close event and schedule reconnect", async () => {
    vi.useFakeTimers();
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const closeHandler = onHandler.mock.calls.find(([event]) => event === "close")?.[1];

    closeHandler?.(1006, "Connection lost");

    expect(mockOnDisconnect).toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("AgentGate WebSocket closed: 1006"),
    );

    vi.useRealTimers();
  });

  it("should handle error events", async () => {
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const errorHandler = onHandler.mock.calls.find(([event]) => event === "error")?.[1];

    const error = new Error("Connection failed");
    errorHandler?.(error);

    expect(mockOnError).toHaveBeenCalledWith(error);
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining("AgentGate WebSocket error: Connection failed"),
    );
  });

  it("should stop reconnecting when destroyed", async () => {
    vi.useFakeTimers();
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    client.stop();

    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const closeHandler = onHandler.mock.calls.find(([event]) => event === "close")?.[1];

    closeHandler?.(1006, "Connection lost");

    // Advance timers - should not trigger reconnect
    vi.advanceTimersByTime(10000);

    // Should not try to create a new WebSocket after stop
    const WebSocket = (await import("ws")).default;
    expect(WebSocket).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("should respect abort signal", async () => {
    const abortController = new AbortController();
    await client.start(abortController.signal);
    const mockWebSocket = mockWebSocketInstances[0];

    abortController.abort();

    expect(mockWebSocket.close).toHaveBeenCalledWith(1000, "stopped");
  });

  it("should send ping messages at intervals", async () => {
    vi.useFakeTimers();
    await client.start();
    const mockWebSocket = mockWebSocketInstances[0];

    // Simulate WebSocket open
    const onHandler = mockWebSocket.on as ReturnType<typeof vi.fn>;
    const openHandler = onHandler.mock.calls.find(([event]) => event === "open")?.[1];
    mockWebSocket.readyState = 1; // WebSocket.OPEN
    openHandler?.();

    // Advance time to trigger ping
    vi.advanceTimersByTime(5000);

    expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));

    vi.useRealTimers();
  });
});
