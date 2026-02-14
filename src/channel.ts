import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { AgentGateConfigSchema } from "./config-schema.js";
import { getAgentGateRuntime } from "./runtime.js";
import {
  listAccountIds,
  defaultAccountId,
  resolveAccount,
  type ResolvedAgentGateAccount,
} from "./types.js";
import { WebSocketClient } from "./ws-client.js";

// Store active WebSocket clients per account
const activeClients = new Map<string, WebSocketClient>();

export const agentgatePlugin: ChannelPlugin<ResolvedAgentGateAccount> = {
  id: "agentgate",
  meta: {
    id: "agentgate",
    label: "AgentGate",
    selectionLabel: "AgentGate",
    docsPath: "/channels/agentgate",
    blurb: "Chat with humans through AgentGate",
    order: 100,
  },
  capabilities: {
    chatTypes: ["direct"], // DMs only for MVP
    media: false, // Text only for MVP
  },
  configSchema: buildChannelConfigSchema(AgentGateConfigSchema as any),

  config: {
    listAccountIds: (cfg) => listAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    defaultAccountId: (cfg) => defaultAccountId(cfg),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId }) => {
      const aid = accountId ?? DEFAULT_ACCOUNT_ID;
      const client = activeClients.get(aid);
      if (!client || !client.isConnected()) {
        throw new Error(`AgentGate WebSocket not connected for account ${aid}`);
      }

      const id = crypto.randomUUID();
      client.send({
        type: "message",
        text: text ?? "",
        id,
        connId: to, // Target specific human connection
      });

      return { 
        channel: "agentgate" as const, 
        to, 
        messageId: id 
      };
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const { account, log, setStatus, abortSignal } = ctx;
      const runtime = getAgentGateRuntime();

      log?.info(`[${account.accountId}] Starting AgentGate provider`);

      if (!account.configured) {
        throw new Error("AgentGate URL and token not configured");
      }

      setStatus({
        accountId: account.accountId,
        running: false,
        connected: false,
        lastError: null,
      });

      const client = new WebSocketClient({
        url: account.config.url,
        token: account.config.token,
        reconnectIntervalMs: account.config.reconnectIntervalMs,
        maxReconnectIntervalMs: account.config.maxReconnectIntervalMs,
        pingIntervalMs: account.config.pingIntervalMs,
        
        onMessage: async (message) => {
          switch (message.type) {
            case "connected":
              log?.info(
                `Channel ${message.channelId} connected, ${message.humans?.length ?? 0} human(s) online`
              );
              setStatus({
                accountId: account.accountId,
                running: true,
                connected: true,
                lastConnectedAt: Date.now(),
                lastError: null,
              });
              break;

            case "human_connected":
              log?.info(`Human connected: ${message.connId}`);
              break;

            case "human_disconnected":
              log?.info(`Human disconnected: ${message.connId}`);
              break;

            case "message":
              if (message.from === "human") {
                log?.debug(`Message from ${message.connId}: ${message.text.slice(0, 50)}...`);
                
                // Route to OpenClaw's message pipeline
                await (runtime.channel.reply as any).handleInboundMessage({
                  channel: "agentgate",
                  accountId: account.accountId,
                  senderId: message.connId,
                  chatType: "direct",
                  chatId: message.connId, // Use connId as chat identifier
                  text: message.text,
                  reply: async (responseText: string) => {
                    if (client.isConnected()) {
                      client.send({
                        type: "message",
                        text: responseText,
                        id: crypto.randomUUID(),
                        connId: message.connId,
                      });
                    }
                  },
                });
              }
              break;

            case "error":
              log?.error(`AgentGate error: ${message.error}`);
              setStatus({
                accountId: account.accountId,
                lastError: message.error,
              });
              break;

            case "pong":
              // Keepalive response, no action needed
              break;
          }
        },

        onConnect: (channelId, humans) => {
          log?.info(`Connected to channel ${channelId} with ${humans.length} humans`);
        },

        onError: (error) => {
          log?.error(`WebSocket error: ${error.message}`);
          setStatus({
            accountId: account.accountId,
            lastError: error.message,
          });
        },

        onDisconnect: () => {
          setStatus({
            accountId: account.accountId,
            connected: false,
          });
        },

        log: {
          info: (msg: string) => log?.info(msg),
          warn: (msg: string) => log?.warn(msg),
          error: (msg: string) => log?.error(msg),
          debug: (msg: string) => log?.debug(msg),
        },
      });

      // Store the client for outbound message sending
      activeClients.set(account.accountId, client);

      // Start the WebSocket connection
      await client.start(abortSignal);

      setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
      });

      log?.info(`[${account.accountId}] AgentGate provider started`);

      // Return cleanup function
      return {
        stop: () => {
          client.stop();
          activeClients.delete(account.accountId);
          setStatus({
            accountId: account.accountId,
            running: false,
            connected: false,
            lastStopAt: Date.now(),
          });
          log?.info(`[${account.accountId}] AgentGate provider stopped`);
        },
      };
    },
  },
};