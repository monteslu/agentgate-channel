# AgentGate Channel Plugin — Technical Specification

## Overview

OpenClaw channel plugin that connects an agent to human users through AgentGate's WebSocket chat API. Humans connect to AgentGate directly; this plugin connects FROM OpenClaw TO AgentGate as the agent endpoint.

```
Human App ←WS→ AgentGate /channel/<id> ←WS→ OpenClaw (this plugin)
```

**Key design principle:** AgentGate owns the session. Humans never see OpenClaw internals. This plugin speaks AgentGate's simple chat protocol and translates to/from OpenClaw's message pipeline.

---

## Architecture

### Connection Flow

1. AgentGate admin creates a channel + API key with `channel_enabled: true`
2. OpenClaw config references that API key as the `token`
3. On startup, plugin opens WebSocket to `${url}/api/channel/` with `Authorization: Bearer ${token}`
4. AgentGate identifies the channel from the API key and registers this as the agent connection
5. Humans independently connect to `/channel/<channel-id>` with their channel key
6. AgentGate bridges messages between the two sides

### Connection Lifecycle

```
Plugin starts → WS connect to /api/channel/ → Bearer auth (in HTTP upgrade headers)
  → Server sends: { type: "connected", channelId: "...", humans: [...] }
  → Plugin is now live, receiving human messages
  → On disconnect: reconnect with exponential backoff
```

---

## AgentGate WebSocket Protocol

### Endpoint

```
WS /api/channel/
Authorization: Bearer <api-key>
```

The channel ID is derived from the API key — no channel ID in the URL.

### Messages: AgentGate → Plugin (Inbound)

```typescript
// Connection established
{ type: "connected", channelId: string, humans: string[] }

// Human lifecycle
{ type: "human_connected", connId: string }
{ type: "human_disconnected", connId: string }

// Human sent a message
{ type: "message", from: "human", text: string, id: string, timestamp: string, connId: string }

// Wake event — inject a system event into the agent's main session
{ type: "wake", text: string, id: string, mode?: "now" | "next-heartbeat" }

// Agent turn — run an isolated agent turn (like sessions_spawn)
{ type: "agent", message: string, id: string, name?: string, model?: string, thinking?: string, timeoutSeconds?: number, deliver?: boolean, channel?: string, to?: string }

// Server-side errors
{ type: "error", error: string }

// Keepalive
{ type: "pong" }  // Response to our ping
```

### Messages: Plugin → AgentGate (Outbound)

```typescript
// Agent response (full message)
{ type: "message", text: string, id?: string, connId?: string }

// Streaming response
{ type: "chunk", text: string, id: string, connId?: string }
{ type: "done", id: string, text?: string, connId?: string }

// Status indicators
{ type: "typing", connId?: string }
{ type: "error", error: string, messageId?: string, connId?: string }

// Acknowledgment for wake/agent messages
{ type: "ack", id: string, status: "dispatched" | "error", error?: string }

// Keepalive
{ type: "ping" }
```

**Notes:**
- `connId` is optional. If omitted, message goes to all connected humans.
- `id` on outbound messages is a plugin-generated message ID (use `nanoid` or `crypto.randomUUID()`).
- For streaming, send `chunk` messages followed by a final `done`. The `done` may include the full concatenated `text`.

---

## Message Type Routing

The plugin multiplexes three message types over one WebSocket connection:

| Type | Purpose | Plugin Route |
|------|---------|-------------|
| `message` | Chat — human ↔ agent conversation | `handleInboundMessage()` (OpenClaw channel pipeline) |
| `wake` | System event — inject into main session | `POST http://127.0.0.1:{gateway.port}/hooks/wake` |
| `agent` | Isolated agent turn — like `sessions_spawn` | `POST http://127.0.0.1:{gateway.port}/hooks/agent` |

### Why local hooks for wake/agent?

The OpenClaw plugin SDK explicitly forbids `enqueueSystemEvent` from plugins. Wake and agent turns bypass the channel pipeline entirely — they're not chat messages. The plugin POSTs to the gateway's local hooks endpoints instead:

- **Wake**: `POST /hooks/wake` with `{ text, mode }` — injects a system event
- **Agent**: `POST /hooks/agent` with `{ message, name, model, ... }` — spawns an isolated turn

Both require `hooks.enabled: true` and `hooks.token` in the OpenClaw config. The plugin reads these from `cfg.gateway.port` and `cfg.hooks.*`.

### Acknowledgments

For wake and agent messages, the plugin sends an `ack` back to AgentGate:

```typescript
// Success
{ type: "ack", id: "<original-message-id>", status: "dispatched" }

// Failure (hooks not enabled, hook returned error, etc.)
{ type: "ack", id: "<original-message-id>", status: "error", error: "reason" }
```

---

## OpenClaw Plugin Interface

### Required: `ChannelPlugin<ResolvedAgentGateAccount>`

From `openclaw/plugin-sdk`:

```typescript
import type { ChannelPlugin } from "openclaw/plugin-sdk";

type ChannelPlugin<ResolvedAccount> = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  configSchema?: ChannelConfigSchema;
  config: ChannelConfigAdapter<ResolvedAccount>;
  outbound?: ChannelOutboundAdapter;
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;
  // ... optional adapters (see below)
};
```

### 1. `meta` — Channel metadata

```typescript
meta: {
  id: "agentgate",
  label: "AgentGate",
  selectionLabel: "AgentGate",
  docsPath: "/channels/agentgate",
  blurb: "Chat with humans through AgentGate",
  order: 100,
}
```

### 2. `capabilities`

```typescript
capabilities: {
  chatTypes: ["direct"],  // DMs for now. Groups could be added later via multi-human channels.
  media: false,           // Text only for MVP
}
```

### 3. `configSchema` — Zod schema for config validation

```typescript
import { z } from "zod";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";

const AgentGateConfigSchema = z.object({
  url: z.string().url().describe("AgentGate server URL"),
  token: z.string().min(1).describe("API key for Bearer auth"),
  reconnectIntervalMs: z.number().min(1000).default(5000).describe("Base reconnect interval"),
  maxReconnectIntervalMs: z.number().min(5000).default(60000).describe("Max reconnect interval"),
  pingIntervalMs: z.number().min(5000).default(30000).describe("WebSocket ping interval"),
  enabled: z.boolean().default(true),
});

// Wrap with buildChannelConfigSchema for OpenClaw integration
configSchema: buildChannelConfigSchema(AgentGateConfigSchema),
```

### 4. `config` — Account resolution

Single-account channel (one AgentGate connection per OpenClaw instance).

```typescript
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";

config: {
  listAccountIds: (cfg) => {
    return cfg.channels?.agentgate ? [DEFAULT_ACCOUNT_ID] : [];
  },
  resolveAccount: (cfg, accountId) => {
    const channelConfig = cfg.channels?.agentgate ?? {};
    return {
      accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      name: "agentgate",
      enabled: channelConfig.enabled !== false,
      configured: !!(channelConfig.url && channelConfig.token),
      config: channelConfig,
    };
  },
  defaultAccountId: () => DEFAULT_ACCOUNT_ID,
  isConfigured: (account) => account.configured,
  describeAccount: (account) => ({
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
  }),
}
```

### 5. `outbound` — Sending agent responses

When OpenClaw produces a reply, the outbound adapter sends it over the WebSocket.

```typescript
outbound: {
  deliveryMode: "direct",
  textChunkLimit: 4000,
  sendText: async ({ to, text, accountId }) => {
    // `to` is the human's connId (from inbound message routing)
    const ws = getActiveConnection(accountId);
    if (!ws) throw new Error("AgentGate WebSocket not connected");

    const id = crypto.randomUUID();
    ws.send(JSON.stringify({
      type: "message",
      text,
      id,
      connId: to,  // Target specific human, or omit for broadcast
    }));

    return { channel: "agentgate", to };
  },
}
```

### 6. `gateway` — WebSocket lifecycle

The gateway adapter manages the WebSocket connection. This is the core of the plugin.

```typescript
gateway: {
  startAccount: async (ctx) => {
    const { account, cfg, log, setStatus, abortSignal } = ctx;
    const { url, token } = account.config;
    const runtime = getAgentGateRuntime();

    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let pingInterval: NodeJS.Timeout | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;

      // Use the `ws` library (already an OpenClaw dependency)
      const WebSocket = require("ws");
      ws = new WebSocket(`${url.replace(/^http/, "ws")}/api/channel/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      ws.on("open", () => {
        log?.info("Connected to AgentGate channel");
        reconnectAttempts = 0;
        setStatus({ ...ctx.getStatus(), connected: true, lastConnectedAt: Date.now(), lastError: null });

        // Start keepalive pings
        pingInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, account.config.pingIntervalMs ?? 30000);
      });

      ws.on("message", async (data: Buffer | string) => {
        const msg = JSON.parse(data.toString());
        await handleInbound(msg, ctx, runtime);
      });

      ws.on("close", (code, reason) => {
        log?.warn(`AgentGate WS closed: ${code} ${reason}`);
        cleanup();
        scheduleReconnect();
      });

      ws.on("error", (err) => {
        log?.error(`AgentGate WS error: ${err.message}`);
        setStatus({ ...ctx.getStatus(), lastError: err.message });
      });
    }

    function cleanup() {
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = null;
      setStatus({ ...ctx.getStatus(), connected: false });
    }

    function scheduleReconnect() {
      if (destroyed) return;
      reconnectAttempts++;
      const base = account.config.reconnectIntervalMs ?? 5000;
      const max = account.config.maxReconnectIntervalMs ?? 60000;
      const delay = Math.min(base * Math.pow(2, reconnectAttempts - 1), max);
      log?.info(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
      setTimeout(connect, delay);
    }

    // Listen for abort signal (OpenClaw shutdown)
    abortSignal.addEventListener("abort", () => {
      destroyed = true;
      cleanup();
      ws?.close(1000, "shutdown");
    });

    // Initial connection
    connect();

    return {
      stop: () => {
        destroyed = true;
        cleanup();
        ws?.close(1000, "stopped");
        log?.info("AgentGate channel stopped");
      },
    };
  },
}
```

### 7. Inbound Message Handler

When a human sends a message, route it into OpenClaw's message pipeline:

```typescript
async function handleInbound(msg: any, ctx: ChannelGatewayContext, runtime: PluginRuntime) {
  const { account, log } = ctx;

  switch (msg.type) {
    case "connected":
      log?.info(`Channel ${msg.channelId} connected, ${msg.humans?.length ?? 0} human(s) online`);
      break;

    case "human_connected":
      log?.info(`Human connected: ${msg.connId}`);
      break;

    case "human_disconnected":
      log?.info(`Human disconnected: ${msg.connId}`);
      break;

    case "message":
      if (msg.from === "human") {
        // Route to OpenClaw's reply pipeline
        await runtime.channel.reply.dispatchReplyFromConfig({
          ctx: {
            channel: "agentgate",
            accountId: account.accountId,
            senderId: msg.connId,       // Human's connection ID
            chatType: "direct",
            chatId: msg.connId,         // Use connId as chat identifier
            text: msg.text,
            messageId: msg.id,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          },
          cfg: runtime.config.loadConfig(),
          dispatcher: /* see Outbound Dispatcher section */,
          replyOptions: {},
        });
      }
      break;

    case "error":
      log?.error(`AgentGate error: ${msg.error}`);
      break;

    case "pong":
      // Keepalive response, no action needed
      break;
  }
}
```

**Important:** Use `dispatchReplyFromConfig` (not `handleInboundMessage`) for full pipeline support including debouncing, command detection, and reply dispatching. See the Matrix or Feishu extensions for reference patterns.

Alternatively, for a simpler MVP, `handleInboundMessage` (as used by the Nostr plugin) is acceptable:

```typescript
await runtime.channel.reply.handleInboundMessage({
  channel: "agentgate",
  accountId: account.accountId,
  senderId: msg.connId,
  chatType: "direct",
  chatId: msg.connId,
  text: msg.text,
  reply: async (responseText: string) => {
    ws.send(JSON.stringify({
      type: "message",
      text: responseText,
      id: crypto.randomUUID(),
      connId: msg.connId,
    }));
  },
});
```

---

## Configuration

### OpenClaw Config (YAML)

```yaml
channels:
  agentgate:
    url: "${AGENT_GATE_URL}"
    token: "${AGENT_GATE_TOKEN}"
    enabled: true
    # Optional:
    # reconnectIntervalMs: 5000
    # maxReconnectIntervalMs: 60000
    # pingIntervalMs: 30000
```

Environment variables:
- `AGENT_GATE_URL` — AgentGate server URL (e.g., `https://agentgate.example.com`)
- `AGENT_GATE_TOKEN` — API key with `channel_enabled: true` in AgentGate

### AgentGate Setup

1. Create an API key in AgentGate admin UI
2. Enable "Channel" for that key → assigns a `channel_id`
3. Use the API key as the `token` in OpenClaw config

---

## File Structure

```
agentgate-channel/
├── .github/
│   └── workflows/
│       ├── ci.yml                # Lint + test + coverage + build check on PRs
│       └── publish.yml           # npm publish on release tags
├── .eslintrc.cjs                 # ESLint config
├── .prettierrc                   # Prettier config
├── tsconfig.json
├── vitest.config.ts              # Vitest config with coverage
├── package.json
├── README.md
├── SPEC.md
├── LICENSE
├── index.ts                      # Plugin entry point
└── src/
    ├── channel.ts                # ChannelPlugin implementation (main export)
    ├── channel.test.ts           # Channel plugin unit tests
    ├── config-schema.ts          # Zod config schema
    ├── config-schema.test.ts     # Config validation tests
    ├── types.ts                  # TypeScript types (ResolvedAccount, protocol messages)
    ├── ws-client.ts              # WebSocket client with reconnect logic
    ├── ws-client.test.ts         # WebSocket client tests (mock WS server)
    └── runtime.ts                # Runtime reference (set during registration)
```

---

## package.json

```json
{
  "name": "agentgate-channel",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "eslint . --ext .ts",
    "lint:fix": "eslint . --ext .ts --fix",
    "format": "prettier --write 'src/**/*.ts' 'index.ts'",
    "format:check": "prettier --check 'src/**/*.ts' 'index.ts'",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ws": "^8.16.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/ws": "^8.5.10",
    "@vitest/coverage-v8": "^3.0.0",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^10.0.0",
    "prettier": "^3.2.0",
    "typescript": "^5.3.0",
    "vitest": "^3.0.0"
  },
  "peerDependencies": {
    "openclaw": "*"
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "channels": ["agentgate"],
    "installDependencies": true,
    "channel": {
      "id": "agentgate",
      "label": "AgentGate",
      "selectionLabel": "AgentGate",
      "blurb": "Chat with humans through AgentGate",
      "order": 100
    },
    "install": {
      "npmSpec": "agentgate-channel",
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
import { setAgentGateRuntime } from "./src/runtime.js";

const plugin = {
  id: "agentgate",
  name: "AgentGate",
  description: "AgentGate channel plugin — chat with humans through AgentGate",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setAgentGateRuntime(api.runtime);
    api.registerChannel({ plugin: agentgatePlugin });
  },
};

export default plugin;
```

---

## src/runtime.ts

```typescript
import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setAgentGateRuntime(r: PluginRuntime) {
  runtime = r;
}

export function getAgentGateRuntime(): PluginRuntime {
  if (!runtime) throw new Error("AgentGate runtime not initialized");
  return runtime;
}
```

---

## CI / GitHub Actions

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v4
        if: matrix.node-version == 22
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: false
```

### `.github/workflows/publish.yml`

```yaml
name: Publish

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:coverage
      - run: npm run typecheck
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Branch Protection Rules (Recommended)

- Require PR reviews before merging
- Require CI status checks to pass (lint, typecheck, test)
- Require branches to be up to date before merging

---

## Testing Strategy

### Unit Tests (`vitest`)

Tests live alongside source files as `*.test.ts`.

#### `src/config-schema.test.ts`
- Valid config parses correctly
- Missing `url` → validation error
- Missing `token` → validation error
- Default values applied (reconnectIntervalMs, pingIntervalMs)
- Environment variable substitution works

#### `src/ws-client.test.ts`
- Connects to mock WebSocket server
- Sends Bearer auth in upgrade headers
- Handles `connected` message on open
- Routes `message` (from: "human") to callback
- Handles `human_connected` / `human_disconnected` events
- Reconnects on close with exponential backoff
- Respects maxReconnectIntervalMs cap
- Resets backoff after successful connection
- Sends ping at configured interval
- Handles pong responses
- Stops cleanly on `stop()` — no reconnect after stop
- Stops on abort signal
- Handles malformed JSON gracefully (log, don't crash)
- Handles connection refused (ECONNREFUSED) → reconnect

#### `src/channel.test.ts`
- `config.listAccountIds` returns empty when not configured
- `config.listAccountIds` returns `[DEFAULT_ACCOUNT_ID]` when configured
- `config.resolveAccount` extracts url/token from config
- `config.isConfigured` returns false when url or token missing
- `outbound.sendText` sends correct JSON over WebSocket
- `outbound.sendText` throws when not connected
- `gateway.startAccount` establishes WebSocket connection
- `gateway.startAccount.stop()` closes cleanly
- Full integration: human message → OpenClaw pipeline → agent response

### Coverage Target

- **Minimum: 80% line coverage** enforced in CI
- Branch coverage: best effort, aim for 70%+

### `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types.ts"],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 80,
        statements: 80,
      },
    },
  },
});
```

---

## Code Quality

### ESLint (`.eslintrc.cjs`)

```javascript
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
};
```

### Prettier (`.prettierrc`)

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### TypeScript (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["index.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "coverage"]
}
```

### README Badges

Add these at the top of README.md:

```markdown
[![CI](https://github.com/monteslu/agentgate-channel/actions/workflows/ci.yml/badge.svg)](https://github.com/monteslu/agentgate-channel/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/monteslu/agentgate-channel/graph/badge.svg)](https://codecov.io/gh/monteslu/agentgate-channel)
[![npm version](https://img.shields.io/npm/v/agentgate-channel)](https://www.npmjs.com/package/agentgate-channel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
```

---

## Error Handling

### WebSocket Reconnection
- On close/error: exponential backoff starting at `reconnectIntervalMs` (default 5s), capped at `maxReconnectIntervalMs` (default 60s)
- Reset backoff counter on successful connection
- Stop reconnecting on `abortSignal` (OpenClaw shutdown) or explicit `stop()`

### Message Errors
- If `ws.send()` fails, log error and let reconnect logic handle it
- If AgentGate sends `{ type: "error" }`, log it — don't crash

### Auth Failures
- If the Bearer token is invalid, AgentGate will close the WebSocket immediately
- Log the rejection and still attempt reconnect (token might be rotated)

---

## Future Considerations (Not MVP)

- **Streaming support**: Forward OpenClaw's streaming chunks as `chunk`/`done` messages
- **Media support**: Image/file uploads via AgentGate
- **Multi-human awareness**: Track individual `connId`s, route replies to specific humans
- **History sync**: Fetch chat history on reconnect via AgentGate's `getChatHistory` DB function
- **Typing indicators**: Send `typing` when OpenClaw is processing
- **Group chat**: Multiple humans in one channel, with `connId`-aware routing

---

## Reference Implementations

For working examples of OpenClaw channel plugins, see:
- `/app/extensions/nostr/` — Simple WebSocket-based DM channel (closest pattern)
- `/app/extensions/matrix/` — More complex, uses `dispatchReplyFromConfig`
- `/app/extensions/telegram/` — HTTP webhook + polling pattern

All use the same `ChannelPlugin` interface from `openclaw/plugin-sdk`.
