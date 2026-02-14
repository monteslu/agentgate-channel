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