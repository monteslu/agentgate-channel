import type { OpenClawRuntime } from "openclaw/plugin-sdk";

let runtime: OpenClawRuntime | null = null;

export function setAgentGateRuntime(r: OpenClawRuntime): void {
  runtime = r;
}

export function getAgentGateRuntime(): OpenClawRuntime {
  if (!runtime) {
    throw new Error("AgentGate runtime not initialized");
  }
  return runtime;
}
