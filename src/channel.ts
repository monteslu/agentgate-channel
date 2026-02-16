import http from "node:http";
import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import { AgentGateConfigSchema } from "./config-schema.js";
import { getAgentGateRuntime } from "./runtime.js";
import {
  listAccountIds,
  defaultAccountId,
  resolveAccount,
  type ResolvedAgentGateAccount,
} from "./types.js";
import type { InboundWakeMessage, InboundAgentMessage } from "./types.js";
import { WebSocketClient } from "./ws-client.js";

// Store active WebSocket clients per account
const activeClients = new Map<string, WebSocketClient>();

// Local hooks configuration resolved from OpenClaw config
interface HooksConfig {
  enabled: boolean;
  wakeUrl: string;
  agentUrl: string;
  token: string;
}

function resolveHooksConfig(cfg: OpenClawConfig): HooksConfig {
  const gatewayPort = (cfg as any).gateway?.port ?? 18789;
  const hooksToken = (cfg as any).hooks?.token ?? "";
  const hooksPath = (cfg as any).hooks?.path?.replace(/\/+$/, "") ?? "/hooks";
  const hooksEnabled = (cfg as any).hooks?.enabled === true;
  const basePath = hooksPath.startsWith("/") ? hooksPath : `/${hooksPath}`;

  return {
    enabled: hooksEnabled && Boolean(hooksToken),
    wakeUrl: `http://127.0.0.1:${gatewayPort}${basePath}/wake`,
    agentUrl: `http://127.0.0.1:${gatewayPort}${basePath}/agent`,
    token: hooksToken,
  };
}

/**
 * POST JSON to a local hooks endpoint
 */
function postLocalHook(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk));
        res.on("end", () => {
          resolve({
            ok: res.statusCode === 200 || res.statusCode === 202,
            status: res.statusCode ?? 0,
            body: data,
          });
        });
      },
    );
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, body: err.message });
    });
    req.write(payload);
    req.end();
  });
}

export const agentgatePlugin: ChannelPlugin<ResolvedAgentGateAccount> = {
  id: "agentgate",
  meta: {
    id: "agentgate",
    label: "AgentGate",
    selectionLabel: "AgentGate",
    docsPath: "/channels/agentgate",
    blurb: "Connect to AgentGate for chat, wake, and agent turns",
    order: 100,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
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
        connId: to,
      });

      return {
        channel: "agentgate" as const,
        to,
        messageId: id,
      };
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const { cfg, account, log, setStatus, abortSignal } = ctx;
      const runtime = getAgentGateRuntime();

      log?.info(`[${account.accountId}] Starting AgentGate provider`);

      if (!account.configured) {
        throw new Error("AgentGate URL and token not configured");
      }

      // Resolve local hooks config for wake/agent support
      const hooks = resolveHooksConfig(cfg);
      if (hooks.enabled) {
        log?.info(`Hooks enabled — wake: ${hooks.wakeUrl}, agent: ${hooks.agentUrl}`);
      } else {
        log?.warn(
          "Hooks not enabled in OpenClaw config. wake/agent message types will return errors. " +
            "Only chat (message) type is available. Enable hooks in openclaw.json to use all message types.",
        );
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
                `Channel ${message.channelId} connected, ${message.humans?.length ?? 0} human(s) online`,
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
                log?.debug?.(`Chat from ${message.connId}: ${message.text.slice(0, 80)}...`);

                // Route through OpenClaw's channel pipeline for chat
                await (runtime.channel.reply as any).handleInboundMessage({
                  channel: "agentgate",
                  accountId: account.accountId,
                  senderId: message.connId,
                  chatType: "direct",
                  chatId: message.connId,
                  text: message.text,
                  reply: async (responseText: string) => {
                    if (client.isConnected()) {
                      client.send({
                        type: "reply" as any,
                        replyTo: message.id,
                        text: responseText,
                        id: crypto.randomUUID(),
                        timestamp: new Date().toISOString(),
                      });
                    }
                  },
                });
              }
              break;

            case "wake": {
              const wakeMsg = message as InboundWakeMessage;
              log?.info(`Wake event: ${wakeMsg.text.slice(0, 80)}`);

              if (!hooks.enabled) {
                log?.error("Cannot process wake: hooks not enabled");
                client.send({
                  type: "error",
                  error: "Hooks not enabled in OpenClaw config",
                  messageId: wakeMsg.id,
                });
                break;
              }

              const wakeResult = await postLocalHook(hooks.wakeUrl, hooks.token, {
                text: wakeMsg.text,
                mode: wakeMsg.mode ?? "now",
              });

              if (wakeResult.ok) {
                log?.info(`Wake dispatched: ${wakeMsg.id}`);
                client.send({ type: "ack" as any, id: wakeMsg.id, status: "dispatched" });
              } else {
                log?.error(`Wake failed (${wakeResult.status}): ${wakeResult.body}`);
                client.send({
                  type: "ack" as any,
                  id: wakeMsg.id,
                  status: "error",
                  error: `Hook returned ${wakeResult.status}`,
                });
              }
              break;
            }

            case "agent": {
              const agentMsg = message as InboundAgentMessage;
              log?.info(
                `Agent turn: ${agentMsg.name ?? "unnamed"} — ${agentMsg.message.slice(0, 80)}`,
              );

              if (!hooks.enabled) {
                log?.error("Cannot process agent turn: hooks not enabled");
                client.send({
                  type: "error",
                  error: "Hooks not enabled in OpenClaw config",
                  messageId: agentMsg.id,
                });
                break;
              }

              const agentBody: Record<string, unknown> = {
                message: agentMsg.message,
                name: agentMsg.name ?? "agentgate",
              };
              if (agentMsg.deliver !== undefined) agentBody.deliver = agentMsg.deliver;
              if (agentMsg.channel) agentBody.channel = agentMsg.channel;
              if (agentMsg.to) agentBody.to = agentMsg.to;
              if (agentMsg.model) agentBody.model = agentMsg.model;
              if (agentMsg.thinking) agentBody.thinking = agentMsg.thinking;
              if (agentMsg.timeoutSeconds) agentBody.timeoutSeconds = agentMsg.timeoutSeconds;

              const agentResult = await postLocalHook(hooks.agentUrl, hooks.token, agentBody);

              if (agentResult.ok) {
                log?.info(`Agent turn dispatched: ${agentMsg.id}`);
                client.send({ type: "ack" as any, id: agentMsg.id, status: "dispatched" });
              } else {
                log?.error(`Agent turn failed (${agentResult.status}): ${agentResult.body}`);
                client.send({
                  type: "ack" as any,
                  id: agentMsg.id,
                  status: "error",
                  error: `Hook returned ${agentResult.status}`,
                });
              }
              break;
            }

            case "error":
              log?.error(`AgentGate error: ${message.error}`);
              setStatus({
                accountId: account.accountId,
                lastError: message.error,
              });
              break;

            case "pong":
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
          debug: (msg: string) => log?.debug?.(msg),
        },
      });

      activeClients.set(account.accountId, client);
      await client.start(abortSignal);

      setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
      });

      log?.info(`[${account.accountId}] AgentGate provider started`);

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
