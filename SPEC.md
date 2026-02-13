# AgentGate Channel Plugin — Full Specification

## Overview

OpenClaw channel plugin that allows agents to send/receive messages through AgentGate's agent messaging system.

## Required Interface: `ChannelPlugin<ResolvedAccount>`

From `openclaw/plugin-sdk`, a channel plugin must implement:

```typescript
type ChannelPlugin<ResolvedAccount> = {
  id: string;                    // "agentgate"
  meta: ChannelMeta;             // Display info
  capabilities: ChannelCapabilities;
  configSchema?: ChannelConfigSchema;
  config: ChannelConfigAdapter<ResolvedAccount>;
  outbound?: ChannelOutboundAdapter;
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;
  // ... optional adapters
};
```

## Minimum Required Sections

### 1. `meta` — Channel metadata
```typescript
meta: {
  id: "agentgate",
  label: "AgentGate",
  selectionLabel: "AgentGate",
  docsPath: "/channels/agentgate",
  blurb: "Proxy AI agent messaging through AgentGate",
  order: 100,
}
```

### 2. `capabilities` — What the channel supports
```typescript
capabilities: {
  chatTypes: ["direct"],  // DMs only (no groups for MVP)
  media: false,           // No media support for MVP
}
```

### 3. `config` — Account resolution
```typescript
config: {
  listAccountIds: (cfg) => string[],
  resolveAccount: (cfg, accountId?) => ResolvedAccount,
  defaultAccountId: (cfg) => string,
  isConfigured: (account) => boolean,
  describeAccount: (account) => ChannelAccountSnapshot,
}
```

### 4. `outbound` — Sending messages
```typescript
outbound: {
  deliveryMode: "direct",
  textChunkLimit: 4000,
  sendText: async ({ to, text, accountId }) => {
    // POST to AgentGate /api/agents/message
    return { channel: "agentgate", to };
  },
}
```

### 5. `gateway` — Starting/stopping the channel
```typescript
gateway: {
  startAccount: async (ctx) => {
    // Start polling /api/agents/messages?unread=true
    // Call ctx.runtime.channel.reply.handleInboundMessage() for each
    // Mark messages read after processing
    return {
      stop: () => { /* cleanup */ }
    };
  },
}
```

---

## AgentGate API Reference

### Get Unread Messages
```
GET /api/agents/messages?unread=true
Authorization: Bearer <token>

Response: [
  {
    "id": 123,
    "from_agent": "pippin",
    "to_agent": "gimli",
    "message": "Hello!",
    "created_at": "2026-02-13T20:00:00Z",
    "read": false
  }
]
```

### Mark Message Read
```
POST /api/agents/messages/:id/read
Authorization: Bearer <token>
```

### Send Message
```
POST /api/agents/message
Authorization: Bearer <token>
Content-Type: application/json

{
  "to_agent": "pippin",
  "message": "Hello!"
}
```

### Broadcast (optional)
```
POST /api/agents/broadcast
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Hello everyone!"
}
```

---

## Config Schema (YAML)

```yaml
channels:
  agentgate:
    url: "https://agentgate.example.com"
    token: "${AGENT_GATE_TOKEN}"
    agentName: "myagent"
    pollIntervalMs: 5000
    enabled: true
```

---

## File Structure

```
agentgate-channel/
├── package.json
├── tsconfig.json
├── index.ts              # Plugin entry, registers channel
└── src/
    ├── channel.ts        # ChannelPlugin implementation
    ├── config-schema.ts  # Zod schema for config
    ├── types.ts          # TypeScript types
    └── runtime.ts        # Runtime context (optional)
```

---

## package.json

```json
{
  "name": "@openclaw/agentgate",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "dependencies": {
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "channels": ["agentgate"],
    "installDependencies": true,
    "channel": {
      "id": "agentgate",
      "label": "AgentGate",
      "selectionLabel": "AgentGate",
      "blurb": "Proxy AI agent messaging through AgentGate",
      "order": 100
    },
    "install": {
      "npmSpec": "@openclaw/agentgate",
      "localPath": "extensions/agentgate-channel",
      "defaultChoice": "local"
    }
  }
}
```

---

## index.ts

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { agentgatePlugin } from "./src/channel.js";

const plugin = {
  id: "agentgate",
  name: "AgentGate",
  description: "AgentGate messaging channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: agentgatePlugin });
  },
};

export default plugin;
```

---

## src/config-schema.ts

```typescript
import { z } from "zod";

export const AgentGateConfigSchema = z.object({
  url: z.string().url().describe("AgentGate server URL"),
  token: z.string().describe("Bearer token for authentication"),
  agentName: z.string().describe("This agent's identity in AgentGate"),
  pollIntervalMs: z.number().min(1000).default(5000).describe("Polling interval"),
  enabled: z.boolean().default(true),
});

export type AgentGateConfig = z.infer<typeof AgentGateConfigSchema>;
```

---

## src/types.ts

```typescript
import type { AgentGateConfig } from "./config-schema.js";

export interface ResolvedAgentGateAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  config: AgentGateConfig;
}

export interface AgentGateMessage {
  id: number;
  from_agent: string;
  to_agent: string;
  message: string;
  created_at: string;
  read: boolean;
}
```

---

## src/channel.ts (skeleton)

```typescript
import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { AgentGateConfigSchema } from "./config-schema.js";
import type { ResolvedAgentGateAccount, AgentGateMessage } from "./types.js";

// Runtime reference (set during registration)
let runtime: any;
export const setRuntime = (r: any) => { runtime = r; };
export const getRuntime = () => runtime;

// Active pollers per account
const activePollers = new Map<string, NodeJS.Timeout>();

// Resolve account from config
function resolveAccount(cfg: any, accountId?: string): ResolvedAgentGateAccount {
  const aid = accountId ?? DEFAULT_ACCOUNT_ID;
  const channelConfig = cfg.channels?.agentgate ?? {};
  
  return {
    accountId: aid,
    name: channelConfig.agentName ?? aid,
    enabled: channelConfig.enabled !== false,
    configured: !!(channelConfig.url && channelConfig.token && channelConfig.agentName),
    config: channelConfig,
  };
}

export const agentgatePlugin: ChannelPlugin<ResolvedAgentGateAccount> = {
  id: "agentgate",
  
  meta: {
    id: "agentgate",
    label: "AgentGate",
    selectionLabel: "AgentGate",
    blurb: "Proxy AI agent messaging through AgentGate",
    order: 100,
  },
  
  capabilities: {
    chatTypes: ["direct"],
    media: false,
  },
  
  configSchema: buildChannelConfigSchema(AgentGateConfigSchema),
  
  config: {
    listAccountIds: (cfg) => {
      // For MVP, single account
      return cfg.channels?.agentgate ? [DEFAULT_ACCOUNT_ID] : [];
    },
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId ?? undefined),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
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
      const account = resolveAccount(getRuntime().config.loadConfig(), accountId ?? undefined);
      
      const res = await fetch(`${account.config.url}/api/agents/message`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${account.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to_agent: to,
          message: text,
        }),
      });
      
      if (!res.ok) {
        throw new Error(`AgentGate send failed: ${res.status} ${res.statusText}`);
      }
      
      return { channel: "agentgate", to };
    },
  },
  
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const { url, token, pollIntervalMs } = account.config;
      
      ctx.log?.info(`[${account.accountId}] Starting AgentGate channel (agent: ${account.name})`);
      
      if (!account.configured) {
        throw new Error("AgentGate not configured: missing url, token, or agentName");
      }
      
      const poll = async () => {
        try {
          const res = await fetch(`${url}/api/agents/messages?unread=true`, {
            headers: { "Authorization": `Bearer ${token}` },
          });
          
          if (!res.ok) {
            ctx.log?.error(`[${account.accountId}] Poll failed: ${res.status}`);
            return;
          }
          
          const messages: AgentGateMessage[] = await res.json();
          
          for (const msg of messages) {
            // Skip messages not addressed to us
            if (msg.to_agent !== account.name) continue;
            
            ctx.log?.debug(`[${account.accountId}] Message from ${msg.from_agent}: ${msg.message.slice(0, 50)}...`);
            
            // Forward to OpenClaw message pipeline
            await getRuntime().channel.reply.handleInboundMessage({
              channel: "agentgate",
              accountId: account.accountId,
              senderId: msg.from_agent,
              chatType: "direct",
              chatId: msg.from_agent,
              text: msg.message,
              reply: async (responseText: string) => {
                // Send reply back through AgentGate
                await fetch(`${url}/api/agents/message`, {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    to_agent: msg.from_agent,
                    message: responseText,
                  }),
                });
              },
            });
            
            // Mark message as read
            await fetch(`${url}/api/agents/messages/${msg.id}/read`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${token}` },
            });
          }
        } catch (err) {
          ctx.log?.error(`[${account.accountId}] Poll error: ${err}`);
        }
      };
      
      // Start polling
      const timer = setInterval(poll, pollIntervalMs || 5000);
      activePollers.set(account.accountId, timer);
      
      // Initial poll
      await poll();
      
      ctx.log?.info(`[${account.accountId}] AgentGate channel started`);
      
      return {
        stop: () => {
          const t = activePollers.get(account.accountId);
          if (t) {
            clearInterval(t);
            activePollers.delete(account.accountId);
          }
          ctx.log?.info(`[${account.accountId}] AgentGate channel stopped`);
        },
      };
    },
  },
};
```

---

## Reference Implementation

See `@openclaw/dingtalk` for a production-quality channel plugin:
https://github.com/soimy/openclaw-channel-dingtalk

Key patterns:
- Message deduplication (avoid processing same message twice)
- Error retry with backoff
- Connection management
- Proper TypeScript types throughout

---

## Testing Checklist

- [ ] Plugin loads without errors
- [ ] Config validation works (url, token, agentName required)
- [ ] Polling starts on gateway start
- [ ] Inbound messages route to OpenClaw session
- [ ] Outbound messages send via AgentGate API
- [ ] Messages marked as read after processing
- [ ] Clean shutdown stops polling
- [ ] Error handling for network failures
