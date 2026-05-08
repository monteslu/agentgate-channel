import type { OpenClawConfig } from "openclaw/plugin-sdk";

type Log = {
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export interface DispatchInboundChatParams {
  cfg: OpenClawConfig;
  runtime: any;
  accountId: string;
  senderId: string;
  text: string;
  messageId: string;
  timestamp?: string;
  reply: (text: string) => Promise<void>;
  log?: Log;
}

const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

function getTextFromPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return typeof record.text === "string" ? record.text : "";
}

async function tryDispatchWithDirectDm(params: DispatchInboundChatParams): Promise<boolean> {
  try {
    const mod = await dynamicImport("openclaw/plugin-sdk/direct-dm");
    const dispatchInboundDirectDmWithRuntime = mod?.dispatchInboundDirectDmWithRuntime;
    if (typeof dispatchInboundDirectDmWithRuntime !== "function") return false;

    await dispatchInboundDirectDmWithRuntime({
      cfg: params.cfg,
      runtime: params.runtime,
      channel: "agentgate",
      channelLabel: "AgentGate",
      accountId: params.accountId,
      peer: { kind: "direct", id: params.senderId },
      senderId: params.senderId,
      senderAddress: params.senderId,
      recipientAddress: "agentgate",
      conversationLabel: `AgentGate ${params.senderId}`,
      rawBody: params.text,
      messageId: params.messageId,
      timestamp: params.timestamp ? Date.parse(params.timestamp) : undefined,
      deliver: async (payload: unknown) => {
        const text = getTextFromPayload(payload);
        if (text) await params.reply(text);
      },
      onRecordError: (err: unknown) => {
        params.log?.warn?.(`AgentGate inbound session record failed: ${String(err)}`);
      },
      onDispatchError: (err: unknown) => {
        params.log?.error?.(`AgentGate inbound reply dispatch failed: ${String(err)}`);
      },
    });

    return true;
  } catch {
    return false;
  }
}

async function dispatchWithLegacyRuntime(params: DispatchInboundChatParams): Promise<boolean> {
  const legacyHandler = params.runtime?.channel?.reply?.handleInboundMessage;
  if (typeof legacyHandler !== "function") return false;

  await legacyHandler({
    channel: "agentgate",
    accountId: params.accountId,
    senderId: params.senderId,
    chatType: "direct",
    chatId: params.senderId,
    text: params.text,
    messageId: params.messageId,
    reply: params.reply,
  });

  return true;
}

export async function dispatchInboundChat(params: DispatchInboundChatParams): Promise<void> {
  if (await tryDispatchWithDirectDm(params)) return;
  if (await dispatchWithLegacyRuntime(params)) return;

  throw new Error("No supported OpenClaw inbound chat dispatch API is available");
}
