import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import * as runtime from "./runtime.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

// Shared mock instance that all WebSocketClient() calls return
const sharedMockClient = {
  start: vi.fn(),
  stop: vi.fn(),
  send: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true),
};

// Mock WebSocketClient — always returns the shared instance
vi.mock("./ws-client.js", () => ({
  WebSocketClient: vi.fn().mockImplementation(() => sharedMockClient),
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

describe("agentgatePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedMockClient.isConnected.mockReturnValue(true);
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
      // Start an account first so the client gets registered in activeClients
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
        cfg: {} as any,
        accountId: DEFAULT_ACCOUNT_ID,
        account,
        runtime: {} as any,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        setStatus: vi.fn(),
        abortSignal: new AbortController().signal,
        getStatus: vi.fn(),
      };
      await agentgatePlugin.gateway!.startAccount!(ctx);
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
      sharedMockClient.isConnected.mockReturnValue(false);

      // Start account to register client
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
        cfg: {} as any,
        accountId: DEFAULT_ACCOUNT_ID,
        account,
        runtime: {} as any,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        setStatus: vi.fn(),
        abortSignal: new AbortController().signal,
        getStatus: vi.fn(),
      };
      await agentgatePlugin.gateway!.startAccount!(ctx);
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
        cfg: {} as any,
        accountId: DEFAULT_ACCOUNT_ID,
        account,
        runtime: {} as any,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        setStatus: vi.fn(),
        abortSignal: new AbortController().signal,
        getStatus: vi.fn(),
      };

      const result = await agentgatePlugin.gateway!.startAccount!(ctx);

      expect(sharedMockClient.start).toHaveBeenCalled();
      expect(ctx.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: DEFAULT_ACCOUNT_ID, running: true }),
      );

      // Test stop
      (result as any).stop();
      expect(sharedMockClient.stop).toHaveBeenCalled();
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
