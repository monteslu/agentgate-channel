/**
 * Mock for openclaw/plugin-sdk used in tests via vitest alias.
 */
import { z } from "zod";

export const DEFAULT_ACCOUNT_ID = "default";
export const SILENT_REPLY_TOKEN = "__SILENT__";

export function emptyPluginConfigSchema() {
  return z.object({});
}

export function buildChannelConfigSchema(accountSchema: z.ZodType) {
  return z.object({
    accounts: z.record(accountSchema).optional(),
  });
}

// Stub types — tests only need the shape, not full implementations
export type OpenClawConfig = {
  channels?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PluginRuntime = {
  channel: {
    reply: {
      handleInboundMessage: (...args: unknown[]) => Promise<void>;
    };
  };
  [key: string]: unknown;
};

export type OpenClawPluginApi = {
  runtime: PluginRuntime;
  registerChannel: (opts: { plugin: unknown }) => void;
  [key: string]: unknown;
};

export interface ChannelPlugin<T = unknown> {
  id: string;
  meta: {
    id: string;
    label: string;
    selectionLabel: string;
    docsPath?: string;
    blurb: string;
    order: number;
  };
  capabilities: {
    chatTypes: string[];
    media: boolean;
  };
  configSchema: z.ZodType;
  config: {
    listAccountIds: (cfg: OpenClawConfig) => string[];
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => T;
    defaultAccountId?: (cfg: OpenClawConfig) => string;
    isConfigured?: (account: T, cfg: OpenClawConfig) => boolean;
    describeAccount?: (account: T, cfg: OpenClawConfig) => Record<string, unknown>;
  };
  outbound?: {
    deliveryMode: string;
    textChunkLimit?: number;
    sendText?: (opts: {
      cfg: OpenClawConfig;
      to: string;
      text?: string;
      accountId?: string;
    }) => Promise<{ channel: string; to: string; messageId: string }>;
  };
  gateway?: {
    startAccount: (ctx: {
      cfg: OpenClawConfig;
      accountId: string;
      account: T;
      runtime: PluginRuntime;
      log?: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error: (msg: string) => void;
        debug: (msg: string) => void;
      };
      setStatus: (status: Record<string, unknown>) => void;
      abortSignal: AbortSignal;
      getStatus: () => Record<string, unknown>;
    }) => Promise<{ stop: () => void }>;
  };
}
