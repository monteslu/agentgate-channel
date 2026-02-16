import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { AgentGateConfig } from "./config-schema.js";

// AgentGate WebSocket Protocol Message Types

// Inbound messages (AgentGate → Plugin)
export interface ConnectedMessage {
  type: "connected";
  channelId: string;
  humans: string[];
}

export interface HumanConnectedMessage {
  type: "human_connected";
  connId: string;
}

export interface HumanDisconnectedMessage {
  type: "human_disconnected";
  connId: string;
}

export interface InboundChatMessage {
  type: "message";
  from: "human";
  text: string;
  id: string;
  timestamp: string;
  connId: string;
}

export interface InboundWakeMessage {
  type: "wake";
  id: string;
  text: string;
  mode?: "now" | "next-heartbeat";
}

export interface InboundAgentMessage {
  type: "agent";
  id: string;
  message: string;
  name?: string;
  deliver?: boolean;
  channel?: string;
  to?: string;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
}

export interface ErrorMessage {
  type: "error";
  error: string;
}

export interface PongMessage {
  type: "pong";
}

export type InboundAgentGateMessage =
  | ConnectedMessage
  | HumanConnectedMessage
  | HumanDisconnectedMessage
  | InboundChatMessage
  | InboundWakeMessage
  | InboundAgentMessage
  | ErrorMessage
  | PongMessage;

// Outbound messages (Plugin → AgentGate)
export interface OutboundMessage {
  type: "message";
  text: string;
  id?: string;
  connId?: string;
  replyTo?: string;
  timestamp?: string;
}

export interface ChunkMessage {
  type: "chunk";
  text: string;
  id: string;
  replyTo?: string;
  connId?: string;
}

export interface DoneMessage {
  type: "done";
  id: string;
  text?: string;
  connId?: string;
}

export interface AckMessage {
  type: "ack";
  id: string;
  status: "dispatched" | "error";
  error?: string;
}

export interface TypingMessage {
  type: "typing";
  connId?: string;
}

export interface OutboundErrorMessage {
  type: "error";
  error: string;
  messageId?: string;
  connId?: string;
}

export interface PingMessage {
  type: "ping";
}

export type OutboundAgentGateMessage =
  | OutboundMessage
  | ChunkMessage
  | DoneMessage
  | AckMessage
  | TypingMessage
  | OutboundErrorMessage
  | PingMessage;

// Account resolution types
export interface ResolvedAgentGateAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  config: AgentGateConfig;
}

const DEFAULT_ACCOUNT_ID = "default";

/**
 * List all configured AgentGate account IDs
 */
export function listAccountIds(cfg: OpenClawConfig): string[] {
  const agentgateCfg = (cfg.channels as Record<string, unknown> | undefined)?.agentgate as
    | AgentGateConfig
    | undefined;

  // If url and token are configured at top level, we have a default account
  if (agentgateCfg?.url && agentgateCfg?.token) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return [];
}

/**
 * Get the default account ID
 */
export function defaultAccountId(cfg: OpenClawConfig): string {
  const ids = listAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

/**
 * Resolve an AgentGate account from config
 */
export function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAgentGateAccount {
  const aid = accountId ?? DEFAULT_ACCOUNT_ID;
  const agentgateCfg = (cfg.channels as Record<string, unknown> | undefined)?.agentgate as
    | AgentGateConfig
    | undefined;

  const baseEnabled = agentgateCfg?.enabled !== false;
  const url = agentgateCfg?.url ?? "";
  const token = agentgateCfg?.token ?? "";
  const configured = Boolean(url.trim() && token.trim());

  return {
    accountId: aid,
    name: "agentgate",
    enabled: baseEnabled,
    configured,
    config: {
      url: agentgateCfg?.url ?? "",
      token: agentgateCfg?.token ?? "",
      enabled: agentgateCfg?.enabled ?? true,
      reconnectIntervalMs: agentgateCfg?.reconnectIntervalMs ?? 5000,
      maxReconnectIntervalMs: agentgateCfg?.maxReconnectIntervalMs ?? 60000,
      pingIntervalMs: agentgateCfg?.pingIntervalMs ?? 30000,
    },
  };
}
