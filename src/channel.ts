import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { AgentGateConfigSchema } from "./config-schema.js";
import { getAgentGateRuntime } from "./runtime.js";
import {
  listAgentGateAccountIds,
  resolveAgentGateAccount,
  resolveDefaultAgentGateAccountId,
  type AgentGateMessage,
  type CoreConfig,
  type ResolvedAgentGateAccount,
} from "./types.js";

// Store active pollers per account
const activePollers = new Map<string, NodeJS.Timeout>();

/**
 * Fetch unread messages from AgentGate.
 * Returns array of AgentGateMessage directly (not wrapped).
 */
async function fetchUnreadMessages(account: ResolvedAgentGateAccount): Promise<AgentGateMessage[]> {
  const { url, token } = account.config;
  const res = await fetch(`${url}/api/agents/messages?unread=true`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`AgentGate fetch failed: ${res.status} ${res.statusText}`);
  }

  const messages: AgentGateMessage[] = await res.json();
  return messages ?? [];
}

/**
 * Mark a message as read on AgentGate.
 */
async function markMessageRead(account: ResolvedAgentGateAccount, messageId: number): Promise<void> {
  const { url, token } = account.config;
  const res = await fetch(`${url}/api/agents/messages/${messageId}/read`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`AgentGate mark-read failed: ${res.status}`);
  }
}

/**
 * Send a message to another agent via AgentGate.
 */
async function sendMessage(
  account: ResolvedAgentGateAccount,
  toAgent: string,
  message: string,
): Promise<void> {
  const { url, token } = account.config;
  const res = await fetch(`${url}/api/agents/message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to_agent: toAgent,
      message,
    }),
  });

  if (!res.ok) {
    throw new Error(`AgentGate send failed: ${res.status} ${res.statusText}`);
  }
}

export const agentgatePlugin: ChannelPlugin<ResolvedAgentGateAccount> = {
  id: "agentgate",
  meta: {
    id: "agentgate",
    label: "AgentGate",
    selectionLabel: "AgentGate",
    docsPath: "/channels/agentgate",
    docsLabel: "agentgate",
    blurb: "Proxy AI agent messaging through AgentGate",
    order: 100,
  },
  capabilities: {
    chatTypes: ["direct"], // Agent-to-agent DMs only
    media: false, // No media support for MVP
  },
  reload: { configPrefixes: ["channels.agentgate"] },
  configSchema: buildChannelConfigSchema(AgentGateConfigSchema),

  config: {
    listAccountIds: (cfg) => listAgentGateAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveAgentGateAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultAgentGateAccountId(cfg as CoreConfig),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      url: account.config.url,
      agentName: account.config.agentName,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveAgentGateAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean),
  },

  pairing: {
    idLabel: "agentName",
    normalizeAllowEntry: (entry) => entry.replace(/^agentgate:/i, "").trim(),
    notifyApproval: async ({ cfg, id, accountId }) => {
      const account = resolveAgentGateAccount({ cfg: cfg as CoreConfig, accountId });
      await sendMessage(account, id, "Your pairing request has been approved!");
    },
  },

  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dmPolicy ?? "open",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: "channels.agentgate.dmPolicy",
      allowFromPath: "channels.agentgate.allowFrom",
      approveHint: formatPairingApproveHint("agentgate"),
      normalizeEntry: (raw) => raw.replace(/^agentgate:/i, "").trim(),
    }),
  },

  messaging: {
    normalizeTarget: (target) => target.replace(/^agentgate:/i, "").trim(),
    targetResolver: {
      looksLikeId: (input) => {
        const trimmed = input.trim();
        // AgentGate agent names are typically alphanumeric
        return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(trimmed);
      },
      hint: "<agent-name>",
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId }) => {
      const runtime = getAgentGateRuntime();
      const cfg = runtime.config.loadConfig() as CoreConfig;
      const aid = accountId ?? DEFAULT_ACCOUNT_ID;
      const account = resolveAgentGateAccount({ cfg, accountId: aid });

      if (!account.configured) {
        throw new Error(`AgentGate account ${aid} not configured`);
      }

      const normalizedTo = to.replace(/^agentgate:/i, "").trim();
      await sendMessage(account, normalizedTo, text ?? "");

      return { channel: "agentgate", to: normalizedTo };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (!lastError) {
          return [];
        }
        return [
          {
            channel: "agentgate",
            accountId: account.accountId,
            kind: "runtime" as const,
            message: `Channel error: ${lastError}`,
          },
        ];
      }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      agentName: snapshot.agentName ?? null,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      agentName: account.config.agentName,
      url: account.config.url,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.setStatus({
        accountId: account.accountId,
        agentName: account.config.agentName,
      });
      ctx.log?.info(
        `[${account.accountId}] Starting AgentGate channel (agent: ${account.config.agentName})`,
      );

      if (!account.configured) {
        throw new Error("AgentGate not configured: missing url, token, or agentName");
      }

      const runtime = getAgentGateRuntime();
      const pollIntervalMs = account.config.pollIntervalMs || 5000;

      // Polling function
      const poll = async () => {
        try {
          const messages = await fetchUnreadMessages(account);

          for (const msg of messages) {
            // Skip messages not addressed to us
            if (msg.to_agent !== account.config.agentName) {
              continue;
            }

            ctx.log?.debug(
              `[${account.accountId}] Message from ${msg.from_agent}: ${msg.message.slice(0, 50)}...`,
            );

            // Forward to OpenClaw's message pipeline
            await runtime.channel.reply.handleInboundMessage({
              channel: "agentgate",
              accountId: account.accountId,
              senderId: msg.from_agent,
              chatType: "direct",
              chatId: msg.from_agent, // For DMs, chatId is the sender
              text: msg.message,
              reply: async (responseText: string) => {
                await sendMessage(account, msg.from_agent, responseText);
              },
            });

            // Mark message as read
            await markMessageRead(account, msg.id);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          ctx.log?.error(`[${account.accountId}] Poll error: ${errorMsg}`);
          ctx.setStatus({ lastError: errorMsg });
        }
      };

      // Start polling
      const timer = setInterval(poll, pollIntervalMs);
      activePollers.set(account.accountId, timer);

      // Initial poll
      await poll();

      ctx.log?.info(
        `[${account.accountId}] AgentGate channel started, polling every ${pollIntervalMs}ms`,
      );

      // Return cleanup function
      return {
        stop: () => {
          const timer = activePollers.get(account.accountId);
          if (timer) {
            clearInterval(timer);
            activePollers.delete(account.accountId);
          }
          ctx.log?.info(`[${account.accountId}] AgentGate channel stopped`);
        },
      };
    },
  },
};
