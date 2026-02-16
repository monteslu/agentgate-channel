import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setAgentGateRuntime(r: PluginRuntime) {
  runtime = r;
}

export function getAgentGateRuntime(): PluginRuntime {
  if (!runtime) throw new Error("AgentGate runtime not initialized");
  return runtime;
}
