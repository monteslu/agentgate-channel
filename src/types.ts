import type { AgentGateConfig } from "./config-schema.js";

/**
 * Resolved AgentGate account with config and state.
 */
export interface ResolvedAgentGateAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  config: AgentGateConfig;
}

/**
 * AgentGate inbound message structure.
 * Note: Uses `from` field per actual API response (not from_agent).
 * No to_agent field exists on inbound messages.
 */
export interface AgentGateMessage {
  id: number;
  from: string;
  message: string;
  created_at: string;
  read: boolean;
}

/**
 * AgentGate messages API response wrapper.
 */
export interface AgentGateMessagesResponse {
  via: string;
  mode: string;
  messages: AgentGateMessage[];
}

/**
 * Core config type (subset of OpenClaw config).
 */
export interface CoreConfig {
  channels?: {
    agentgate?: Partial<AgentGateConfig>;
  };
}

/**
 * Resolve an AgentGate account from config.
 */
export function resolveAgentGateAccount(opts: {
  cfg: CoreConfig;
  accountId: string;
}): ResolvedAgentGateAccount {
  const { cfg, accountId } = opts;
  const raw = cfg.channels?.agentgate ?? {};

  const config: AgentGateConfig = {
    enabled: raw.enabled ?? false,
    url: raw.url ?? "",
    token: raw.token ?? "",
    agentName: raw.agentName ?? "",
    pollIntervalMs: raw.pollIntervalMs ?? 5000,
    dmPolicy: raw.dmPolicy ?? "open",
    allowFrom: raw.allowFrom ?? [],
  };

  const configured = Boolean(config.url && config.token && config.agentName);

  return {
    accountId,
    name: config.agentName || accountId,
    enabled: config.enabled,
    configured,
    config,
  };
}

/**
 * List account IDs (AgentGate only supports single account for now).
 */
export function listAgentGateAccountIds(cfg: CoreConfig): string[] {
  return cfg.channels?.agentgate ? ["default"] : [];
}

/**
 * Get default account ID.
 */
export function resolveDefaultAgentGateAccountId(_cfg: CoreConfig): string {
  return "default";
}
