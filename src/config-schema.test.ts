import { describe, it, expect } from "vitest";
import { AgentGateConfigSchema } from "./config-schema.js";

describe("AgentGateConfigSchema", () => {
  it("should validate a complete valid config", () => {
    const validConfig = {
      url: "https://agentgate.example.com",
      token: "ag_1234567890abcdef",
      reconnectIntervalMs: 5000,
      maxReconnectIntervalMs: 60000,
      pingIntervalMs: 30000,
      enabled: true,
    };

    const result = AgentGateConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validConfig);
    }
  });

  it("should validate minimal config with defaults", () => {
    const minimalConfig = {
      url: "https://agentgate.example.com",
      token: "ag_1234567890abcdef",
    };

    const result = AgentGateConfigSchema.safeParse(minimalConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        url: "https://agentgate.example.com",
        token: "ag_1234567890abcdef",
        reconnectIntervalMs: 5000,
        maxReconnectIntervalMs: 60000,
        pingIntervalMs: 30000,
        enabled: true,
      });
    }
  });

  it("should reject invalid URL", () => {
    const invalidConfig = {
      url: "not-a-url",
      token: "ag_1234567890abcdef",
    };

    const result = AgentGateConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("should reject missing URL", () => {
    const invalidConfig = {
      token: "ag_1234567890abcdef",
    };

    const result = AgentGateConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("should reject empty token", () => {
    const invalidConfig = {
      url: "https://agentgate.example.com",
      token: "",
    };

    const result = AgentGateConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("should reject missing token", () => {
    const invalidConfig = {
      url: "https://agentgate.example.com",
    };

    const result = AgentGateConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("should reject reconnectIntervalMs less than 1000", () => {
    const invalidConfig = {
      url: "https://agentgate.example.com",
      token: "ag_1234567890abcdef",
      reconnectIntervalMs: 500,
    };

    const result = AgentGateConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("should reject maxReconnectIntervalMs less than 5000", () => {
    const invalidConfig = {
      url: "https://agentgate.example.com",
      token: "ag_1234567890abcdef",
      maxReconnectIntervalMs: 3000,
    };

    const result = AgentGateConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("should reject pingIntervalMs less than 5000", () => {
    const invalidConfig = {
      url: "https://agentgate.example.com",
      token: "ag_1234567890abcdef",
      pingIntervalMs: 3000,
    };

    const result = AgentGateConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});