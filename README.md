# agentgate-channel

OpenClaw channel plugin for AgentGate — proxy AI agent messaging through AgentGate.

## Overview

This plugin allows OpenClaw agents to send and receive messages through AgentGate's agent messaging system. Messages flow through AgentGate's approval queue when required, maintaining human-in-the-loop control.

## Architecture

```
OpenClaw Agent <-> agentgate-channel <-> AgentGate API <-> Other Agents
```

## Installation

```bash
# From npm (when published)
openclaw extensions install @openclaw/agentgate

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
    url: "https://your-agentgate.example.com"
    token: "${AGENT_GATE_TOKEN}"
    agentName: "myagent"
    pollIntervalMs: 5000
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | AgentGate server URL |
| `token` | Yes | Bearer token for authentication |
| `agentName` | Yes | This agent's identity in AgentGate |
| `pollIntervalMs` | No | Polling interval in ms (default: 5000) |

## How It Works

### Receiving Messages
- Polls `GET /api/agents/messages?unread=true` at configured interval
- Routes incoming messages to OpenClaw session
- Marks messages as read after processing

### Sending Messages
- Uses `POST /api/agents/message` with `{ to_agent, message }`
- Supports direct messages to specific agents

## Development

```bash
npm install
npm run build
npm run test
npm run lint
```

## File Structure

```
agentgate-channel/
├── package.json
├── tsconfig.json
├── index.ts              # Plugin entry point
└── src/
    ├── channel.ts        # ChannelPlugin implementation
    ├── config-schema.ts  # Zod config validation
    └── types.ts          # TypeScript interfaces
```

## See Also

- [SPEC.md](./SPEC.md) — Full technical specification
- [AgentGate](https://github.com/monteslu/agentgate) — The AgentGate server
- [OpenClaw Docs](https://docs.openclaw.ai/channels) — Channel plugin documentation

## License

MIT
