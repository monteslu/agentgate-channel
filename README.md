# agentgate-channel

OpenClaw channel plugin for [AgentGate](https://github.com/monteslu/agentgate) — connect agents to humans and AgentGate system events through one outbound WebSocket.

## Overview

This plugin connects an OpenClaw agent to AgentGate's `/api/channel/` WebSocket endpoint. Humans connect separately to `/channel/<id>`. AgentGate derives the agent channel from the bearer token, then bridges chat and system events to OpenClaw.

## Architecture

```
Human App ←WS→ AgentGate /channel/<id> ←WS→ OpenClaw (agentgate-channel plugin)
AgentGate events ────────────────────────┘
```

- **Human** connects to `WS /channel/<id>` — authenticates with channel key
- **Agent (this plugin)** connects to `WS /api/channel/` — authenticates with Bearer token
- **AgentGate** derives the channel from that token, bridges chat, and can deliver typed system events
- **Chat** uses the OpenClaw channel reply pipeline
- **Wake/agent events** use OpenClaw's local hooks instead of being faked as chat

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
| `url` | Yes | AgentGate server URL, for example `https://agentgate.example.com` |
| `token` | Yes | Agent API key for Bearer auth. The key must have channel access enabled in AgentGate. |

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

// System notification; no conversational reply expected
{ "type": "wake", "text": "Queue #42 was approved", "id": "wake_123", "mode": "now" }

// Explicit isolated agent turn; no human chat message is created by default
{ "type": "agent", "message": "Check PR #42 CI", "id": "agent_123", "name": "ci-check" }
```

## How It Works

1. Plugin opens a WebSocket to `${AGENT_GATE_URL}/api/channel/`
2. Authenticates with `Authorization: Bearer ${token}` header
3. Receives `connected` message with list of currently connected humans
4. Human messages arrive as `{ type: "message", from: "human" }` events
5. Plugin routes chat through OpenClaw's inbound direct-message/channel reply path
6. Agent responses are sent back as `message`, `chunk`/`done` (streaming), or `typing` indicators
7. `wake` and `agent` events are dispatched to local OpenClaw hooks (`/hooks/wake` and `/hooks/agent`) and acknowledged with `ack`

If the WebSocket disconnects, AgentGate queues channel messages (up to 100) until the agent reconnects. AgentGate may also fall back to configured webhooks for non-chat notifications when available.

## Message Types

Use `message` only for conversational chat that should run through the normal channel reply flow. Use `wake` for notifications, broadcasts, queue updates, and other system events. Use `agent` when AgentGate wants OpenClaw to run a separate explicit task.

## Related X/Twitter Workflows

Keep this plugin responsible for AgentGate human chat, WebSocket delivery, channel events, wake events, isolated agent turns, and AgentGate bearer-token routing. If the same OpenClaw agent also needs public X/Twitter data or visible X/Twitter actions, install TweetClaw as a separate OpenClaw plugin:

```bash
openclaw plugins install @xquik/tweetclaw
```

[TweetClaw](https://github.com/Xquik-dev/tweetclaw) covers scrape tweets, tweet scraper workflows, search tweets, search tweet replies, follower export, user lookup, media upload, media download, direct messages, monitor tweets, webhooks, giveaway draws, and approval-gated post tweets or post tweet replies. See the [ClawHub listing](https://clawhub.ai/plugins/@xquik/tweetclaw) or [npm package](https://www.npmjs.com/package/@xquik/tweetclaw) for setup details. Keep AgentGate credentials and X/Twitter credentials separate, and review visible X/Twitter actions through OpenClaw approval flows.

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
