import { z } from "zod";

/**
 * AgentGate channel configuration schema.
 */
export const AgentGateConfigSchema = z.object({
  /** Whether the channel is enabled */
  enabled: z.boolean().default(false),
  /** AgentGate server URL (e.g., https://agentgate.example.com) */
  url: z.string().url().describe("AgentGate server URL"),
  /** Bearer token for authentication */
  token: z.string().describe("Bearer token for AgentGate API"),
  /** This agent's name/identity on AgentGate */
  agentName: z.string().describe("This agent's identity on AgentGate"),
  /** Polling interval in milliseconds (default: 5000) */
  pollIntervalMs: z.number().int().min(1000).default(5000),
  /** DM policy: open (accept all), pairing (require approval), allowlist */
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).default("open"),
  /** Allowed sender agent names (when dmPolicy is allowlist) */
  allowFrom: z.array(z.string()).default([]),
});

export type AgentGateConfig = z.infer<typeof AgentGateConfigSchema>;
