import { z } from "zod";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";

/**
 * Zod schema for channels.agentgate.* configuration
 */
export const AgentGateConfigSchema = z.object({
  /** AgentGate server URL */
  url: z.string().url().describe("AgentGate server URL"),

  /** API key for Bearer auth */
  token: z.string().min(1).describe("API key for Bearer auth"),

  /** Base reconnect interval in milliseconds */
  reconnectIntervalMs: z.number().min(1000).default(5000).describe("Base reconnect interval"),

  /** Max reconnect interval in milliseconds */
  maxReconnectIntervalMs: z.number().min(5000).default(60000).describe("Max reconnect interval"),

  /** WebSocket ping interval in milliseconds */
  pingIntervalMs: z.number().min(5000).default(30000).describe("WebSocket ping interval"),

  /** Whether this channel is enabled */
  enabled: z.boolean().default(true),
});

export type AgentGateConfig = z.infer<typeof AgentGateConfigSchema>;

/**
 * JSON Schema for Control UI (converted from Zod)
 */
export const agentgateChannelConfigSchema = buildChannelConfigSchema(AgentGateConfigSchema as any);
