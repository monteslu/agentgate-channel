import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import * as runtime from "./runtime.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import http from "node:http";

// Shared mock instance that all WebSocketClient() calls return
const sharedMockClient = {
  start: vi.fn(),
  stop: vi.fn(),
  send: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true),
};

// Capture the onMessage callback so we can invoke it in tests
let capturedOnMessage: ((msg: any) => Promise<void>) | null = null;
let capturedOnConnect: ((channelId: string, humans: any[]) => void) | null = null;
let capturedOnError: ((error: Error) => void) | null = null;
let capturedOnDisconnect: (() => void) | null = null;

// Mock WebSocketClient — always returns the shared instance
vi.mock("./ws-client.js", () => ({
  WebSocketClient: vi.fn().mockImplementation((opts: any) => {
    capturedOnMessage = opts.onMessage;
    capturedOnConnect = opts.onConnect;
    capturedOnError = opts.onError;
    capturedOnDisconnect = opts.onDisconnect;
    return sharedMockClient;
  }),
}));

// Mock runtime
const mockRuntime = {
  channel: {
    reply: {
      handleInboundMessage: vi.fn(),
    },
  },
};

vi.spyOn(runtime, "getAgentGateRuntime").mockReturnValue(mockRuntime as any);

// Import after mocks
const { agentgatePlugin } = await import("./channel.js");

// Helper: start an account with given config and return ctx + stop fn
async function startTestAccount(cfgOverrides: Partial<OpenClawConfig> = {}) {
  const account = {
    accountId: DEFAULT_ACCOUNT_ID,
    name: "agentgate",
    enabled: true,
    configured: true,
    config: {
      url: "https://example.com",
      token: "t",
      reconnectIntervalMs: 5000,
      maxReconnectIntervalMs: 60000,
      pingIntervalMs: 30000,
    },
  };
  const ctx = {
    cfg: {
      gateway: { port: 18789 },
      hooks: { enabled: true, token: "hook-secret", path: "/hooks" },
      ...cfgOverrides,
    } as any,
    accountId: DEFAULT_ACCOUNT_ID,
    account,
    runtime: {} as any,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    setStatus: vi.fn(),
    abortSignal: new AbortController().signal,
    getStatus: vi.fn(),
  };
  const result = await agentgatePlugin.gateway!.startAccount!(ctx);
  return { ctx, result, stop: (result as any).stop };
}

describe("agentgatePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedMockClient.isConnected.mockReturnValue(true);
    capturedOnMessage = null;
    capturedOnConnect = null;
    capturedOnError = null;
    capturedOnDisconnect = null;
  });

  describe("config", () => {
    it("should return empty array when not configured", () => {
      const cfg: OpenClawConfig = { channels: {} };
      const accountIds = agentgatePlugin.config.listAccountIds(cfg);
      expect(accountIds).toEqual([]);
    });

    it("should return default account when configured", () => {
      const cfg: OpenClawConfig = {
        channels: {
          agentgate: { url: "https://agentgate.example.com", token: "test-token" },
        },
      };
      const accountIds = agentgatePlugin.config.listAccountIds(cfg);
      expect(accountIds).toEqual([DEFAULT_ACCOUNT_ID]);
    });

    it("should resolve account correctly", () => {
      const cfg: OpenClawConfig = {
        channels: {
          agentgate: {
            url: "https://agentgate.example.com",
            token: "test-token",
            enabled: true,
            reconnectIntervalMs: 3000,
          },
        },
      };
      const account = agentgatePlugin.config.resolveAccount(cfg, DEFAULT_ACCOUNT_ID);
      expect(account).toEqual({
        accountId: DEFAULT_ACCOUNT_ID,
        name: "agentgate",
        enabled: true,
        configured: true,
        config: {
          url: "https://agentgate.example.com",
          token: "test-token",
          enabled: true,
          reconnectIntervalMs: 3000,
          maxReconnectIntervalMs: 60000,
          pingIntervalMs: 30000,
        },
      });
    });

    it("should return not configured when url missing", () => {
      const cfg: OpenClawConfig = { channels: { agentgate: { token: "test-token" } } };
      const account = agentgatePlugin.config.resolveAccount(cfg, DEFAULT_ACCOUNT_ID);
      expect(account.configured).toBe(false);
    });

    it("should return not configured when token missing", () => {
      const cfg: OpenClawConfig = { channels: { agentgate: { url: "https://example.com" } } };
      const account = agentgatePlugin.config.resolveAccount(cfg, DEFAULT_ACCOUNT_ID);
      expect(account.configured).toBe(false);
    });

    it("should return default account id", () => {
      const cfg: OpenClawConfig = {
        channels: { agentgate: { url: "https://example.com", token: "t" } },
      };
      expect(agentgatePlugin.config.defaultAccountId!(cfg)).toBe(DEFAULT_ACCOUNT_ID);
    });

    it("should check if account is configured", () => {
      const yes = { configured: true } as any;
      const no = { configured: false } as any;
      expect(agentgatePlugin.config.isConfigured!(yes, {} as any)).toBe(true);
      expect(agentgatePlugin.config.isConfigured!(no, {} as any)).toBe(false);
    });

    it("should describe account correctly", () => {
      const account = {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "agentgate",
        enabled: true,
        configured: true,
        config: {} as any,
      };
      expect(agentgatePlugin.config.describeAccount!(account, {} as any)).toEqual({
        accountId: DEFAULT_ACCOUNT_ID,
        name: "agentgate",
        enabled: true,
        configured: true,
      });
    });
  });

  describe("outbound", () => {
    it("should send text message", async () => {
      await startTestAccount();
      vi.clearAllMocks();
      sharedMockClient.isConnected.mockReturnValue(true);

      const result = await agentgatePlugin.outbound!.sendText!({
        cfg: {} as any,
        to: "conn1",
        text: "Hello!",
        accountId: DEFAULT_ACCOUNT_ID,
      });

      expect(sharedMockClient.send).toHaveBeenCalledWith({
        type: "message",
        text: "Hello!",
        id: expect.any(String),
        connId: "conn1",
      });
      expect(result).toEqual({ channel: "agentgate", to: "conn1", messageId: expect.any(String) });
    });

    it("should throw when not connected", async () => {
      await startTestAccount();
      sharedMockClient.isConnected.mockReturnValue(false);

      await expect(
        agentgatePlugin.outbound!.sendText!({
          cfg: {} as any,
          to: "conn1",
          text: "Hi",
          accountId: DEFAULT_ACCOUNT_ID,
        }),
      ).rejects.toThrow("AgentGate WebSocket not connected");
    });

    it("should throw when no client for account", async () => {
      await expect(
        agentgatePlugin.outbound!.sendText!({
          cfg: {} as any,
          to: "conn1",
          text: "Hi",
          accountId: "nonexistent",
        }),
      ).rejects.toThrow("AgentGate WebSocket not connected");
    });
  });

  describe("gateway", () => {
    it("should throw when account not configured", async () => {
      const ctx = {
        cfg: {} as any,
        accountId: DEFAULT_ACCOUNT_ID,
        account: {
          accountId: DEFAULT_ACCOUNT_ID,
          name: "agentgate",
          enabled: true,
          configured: false,
          config: {} as any,
        },
        runtime: {} as any,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        setStatus: vi.fn(),
        abortSignal: new AbortController().signal,
        getStatus: vi.fn(),
      };
      await expect(agentgatePlugin.gateway!.startAccount(ctx)).rejects.toThrow("not configured");
    });

    it("should start account successfully", async () => {
      const { ctx, stop } = await startTestAccount();

      expect(sharedMockClient.start).toHaveBeenCalled();
      expect(ctx.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: DEFAULT_ACCOUNT_ID, running: true }),
      );

      stop();
      expect(sharedMockClient.stop).toHaveBeenCalled();
    });

    it("should warn when hooks not enabled", async () => {
      const { ctx } = await startTestAccount({ hooks: { enabled: false } } as any);
      expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining("Hooks not enabled"));
    });

    it("should log when hooks are enabled", async () => {
      const { ctx } = await startTestAccount();
      expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("Hooks enabled"));
    });

    it("should handle stop and cleanup", async () => {
      const { ctx, stop } = await startTestAccount();
      vi.clearAllMocks();

      stop();

      expect(sharedMockClient.stop).toHaveBeenCalled();
      expect(ctx.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: DEFAULT_ACCOUNT_ID,
          running: false,
          connected: false,
        }),
      );
    });
  });

  describe("message handlers", () => {
    it("should handle connected message", async () => {
      const { ctx } = await startTestAccount();
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "connected",
        channelId: "ch1",
        humans: [{ connId: "h1" }],
      });

      expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("ch1"));
      expect(ctx.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ connected: true, running: true }),
      );
    });

    it("should handle human_connected message", async () => {
      const { ctx } = await startTestAccount();
      vi.clearAllMocks();

      await capturedOnMessage!({ type: "human_connected", connId: "h1" });
      expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("h1"));
    });

    it("should handle human_disconnected message", async () => {
      const { ctx } = await startTestAccount();
      vi.clearAllMocks();

      await capturedOnMessage!({ type: "human_disconnected", connId: "h1" });
      expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("h1"));
    });

    it("should handle chat message from human", async () => {
      await startTestAccount();
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "message",
        from: "human",
        connId: "user1",
        text: "hello there",
        id: "msg1",
      });

      expect(mockRuntime.channel.reply.handleInboundMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "agentgate",
          senderId: "user1",
          chatType: "direct",
          chatId: "user1",
          text: "hello there",
        }),
      );
    });

    it("should handle error message", async () => {
      const { ctx } = await startTestAccount();
      vi.clearAllMocks();

      await capturedOnMessage!({ type: "error", error: "something broke" });
      expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("something broke"));
      expect(ctx.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: "something broke" }),
      );
    });

    it("should handle pong message silently", async () => {
      const { ctx } = await startTestAccount();
      vi.clearAllMocks();

      await capturedOnMessage!({ type: "pong" });
      expect(ctx.log.info).not.toHaveBeenCalled();
    });

    it("should handle wake message when hooks enabled", async () => {
      // Start a local HTTP server to mock the hooks endpoint
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;

      await startTestAccount({
        gateway: { port },
        hooks: { enabled: true, token: "test-hook-token", path: "/hooks" },
      } as any);
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "wake",
        text: "wake up",
        id: "wake1",
        mode: "now",
      });

      expect(sharedMockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ack", id: "wake1", status: "dispatched" }),
      );

      server.close();
    });

    it("should error on wake when hooks not enabled", async () => {
      const { ctx } = await startTestAccount({
        hooks: { enabled: false, token: "", path: "/hooks" },
      } as any);
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "wake",
        text: "wake up",
        id: "wake2",
      });

      expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("hooks not enabled"));
      expect(sharedMockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", messageId: "wake2" }),
      );
    });

    it("should handle agent message when hooks enabled", async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;

      await startTestAccount({
        gateway: { port },
        hooks: { enabled: true, token: "test-hook-token", path: "/hooks" },
      } as any);
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "agent",
        message: "do a thing",
        name: "test-agent",
        id: "agent1",
      });

      expect(sharedMockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ack", id: "agent1", status: "dispatched" }),
      );

      server.close();
    });

    it("should error on agent when hooks not enabled", async () => {
      const { ctx } = await startTestAccount({
        hooks: { enabled: false, token: "", path: "/hooks" },
      } as any);
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "agent",
        message: "do a thing",
        name: "test-agent",
        id: "agent2",
      });

      expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("hooks not enabled"));
      expect(sharedMockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", messageId: "agent2" }),
      );
    });

    it("should handle hook failure for wake", async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;

      const { ctx } = await startTestAccount({
        gateway: { port },
        hooks: { enabled: true, token: "t", path: "/hooks" },
      } as any);
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "wake",
        text: "wake up",
        id: "wake3",
      });

      expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("500"));
      expect(sharedMockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ack", id: "wake3", status: "error" }),
      );

      server.close();
    });

    it("should handle hook failure for agent", async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;

      await startTestAccount({
        gateway: { port },
        hooks: { enabled: true, token: "t", path: "/hooks" },
      } as any);
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "agent",
        message: "do a thing",
        id: "agent3",
      });

      expect(sharedMockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ack", id: "agent3", status: "error" }),
      );

      server.close();
    });

    it("should pass optional agent fields to hook", async () => {
      let receivedBody = "";
      const server = http.createServer((req, res) => {
        let data = "";
        req.on("data", (chunk: Buffer) => (data += chunk));
        req.on("end", () => {
          receivedBody = data;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;

      await startTestAccount({
        gateway: { port },
        hooks: { enabled: true, token: "t", path: "/hooks" },
      } as any);
      vi.clearAllMocks();

      await capturedOnMessage!({
        type: "agent",
        message: "do a thing",
        name: "custom-agent",
        id: "agent4",
        model: "claude-sonnet",
        thinking: "high",
        timeoutSeconds: 120,
        deliver: true,
        channel: "discord",
        to: "user123",
      });

      const parsed = JSON.parse(receivedBody);
      expect(parsed.message).toBe("do a thing");
      expect(parsed.name).toBe("custom-agent");
      expect(parsed.model).toBe("claude-sonnet");
      expect(parsed.thinking).toBe("high");
      expect(parsed.timeoutSeconds).toBe(120);
      expect(parsed.deliver).toBe(true);
      expect(parsed.channel).toBe("discord");
      expect(parsed.to).toBe("user123");

      server.close();
    });
  });

  describe("WebSocket callbacks", () => {
    it("should handle onConnect callback", async () => {
      const { ctx } = await startTestAccount();
      vi.clearAllMocks();

      capturedOnConnect!("ch1", [{ connId: "h1" }]);
      expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("ch1"));
    });

    it("should handle onError callback", async () => {
      const { ctx } = await startTestAccount();
      vi.clearAllMocks();

      capturedOnError!(new Error("test error"));
      expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("test error"));
      expect(ctx.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: "test error" }),
      );
    });

    it("should handle onDisconnect callback", async () => {
      const { ctx } = await startTestAccount();
      vi.clearAllMocks();

      capturedOnDisconnect!();
      expect(ctx.setStatus).toHaveBeenCalledWith(expect.objectContaining({ connected: false }));
    });
  });

  describe("plugin metadata", () => {
    it("should have correct metadata", () => {
      expect(agentgatePlugin.id).toBe("agentgate");
      expect(agentgatePlugin.meta.label).toBe("AgentGate");
      expect(agentgatePlugin.capabilities.chatTypes).toEqual(["direct"]);
      expect(agentgatePlugin.capabilities.media).toBe(false);
    });
  });
});
