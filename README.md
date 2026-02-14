# agentgate-channel

OpenClaw channel plugin for [AgentGate](https://github.com/monteslu/agentgate) — connect agents to humans through AgentGate's WebSocket chat API.

## Overview

This plugin connects an OpenClaw agent to AgentGate's `/api/channel/<id>` WebSocket endpoint. Humans connect separately to `/channel/<id>`. AgentGate bridges the two — the human never sees OpenClaw internals.

## Architecture

```
Human App ←WS→ AgentGate /channel/<id> ←WS→ OpenClaw (agentgate-channel plugin)
```

- **Human** connects to `WS /channel/<id>` — authenticates with channel key
- **Agent (this plugin)** connects to `WS /api/channel/<id>` — authenticates with Bearer token
- **AgentGate** bridges messages between them, stores chat history

## Installation

```bash
# From npm (when published)
openclaw extensions install agentgate-channel

# Or local development
git clone https://github.com/monteslu/agentgate-channel
cd agentgate-channel
npm install
```

## Configuration

Add to your OpenClaw config:

```yaml
channels:
  agentgate:
    url: "${AGENT_GATE_URL}"
    token: "${AGENT_GATE_TOKEN}"
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | AgentGate server URL (use `AGENT_GATE_URL` env var) |
| `token` | Yes | API key for Bearer auth (use `AGENT_GATE_TOKEN` env var) |

The channel ID is derived from the API key — AgentGate knows which channel the agent belongs to from the token alone.

## Protocol

### Agent → AgentGate

```jsonc
// Send message to human(s)
{ "type": "message", "text": "hello", "id": "msg_123", "connId": "optional-target" }

// Streaming response
{ "type": "chunk", "text": "partial...", "id": "msg_123" }
{ "type": "done", "id": "msg_123", "text": "optional-full-text" }

// Status
{ "type": "typing", "connId": "optional-target" }
{ "type": "error", "error": "something went wrong", "messageId": "msg_123" }
```

### AgentGate → Agent

```jsonc
// On connect
{ "type": "connected", "channelId": "abc", "humans": ["conn_1", "conn_2"] }

// Human lifecycle
{ "type": "human_connected", "connId": "conn_3" }
{ "type": "human_disconnected", "connId": "conn_1" }

// Human message
{ "type": "message", "from": "human", "text": "hi there", "id": "msg_456", "timestamp": "...", "connId": "conn_1" }
```

## How It Works

1. Plugin opens a WebSocket to `${AGENT_GATE_URL}/api/channel/`
2. Authenticates with `Authorization: Bearer ${token}` header
3. Receives `connected` message with list of currently connected humans
4. Human messages arrive as `{ type: "message", from: "human" }` events
5. Plugin routes them into the OpenClaw session
6. Agent responses are sent back as `message`, `chunk`/`done` (streaming), or `typing` indicators

If the WebSocket disconnects, AgentGate queues human messages (up to 100) until the agent reconnects.

## Development

```bash
npm install
npm run build
npm run test
npm run lint
```

## See Also

- [AgentGate](https://github.com/monteslu/agentgate) — The AgentGate server
- [AgentGate PR #251](https://github.com/monteslu/agentgate/pull/251) — Server-side implementation
- [OpenClaw Docs](https://docs.openclaw.ai/channels) — Channel plugin documentation

## License

MIT
