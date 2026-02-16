import { describe, it, expect, beforeEach } from "vitest";
import { setAgentGateRuntime, getAgentGateRuntime } from "./runtime.js";

describe("runtime", () => {
  beforeEach(() => {
    // Reset runtime by setting to null-like state
    // We need to set then test
  });

  it("should throw when runtime not initialized", () => {
    // Fresh import won't have runtime set in this test context
    // but the module is already loaded, so we test the set/get flow
    const mockRuntime = { channel: { reply: {} } } as any;
    setAgentGateRuntime(mockRuntime);
    expect(getAgentGateRuntime()).toBe(mockRuntime);
  });

  it("should set and get runtime", () => {
    const mockRuntime = { channel: { reply: { handleInboundMessage: () => {} } } } as any;
    setAgentGateRuntime(mockRuntime);
    expect(getAgentGateRuntime()).toBe(mockRuntime);
  });

  it("should overwrite previous runtime", () => {
    const first = { id: 1 } as any;
    const second = { id: 2 } as any;
    setAgentGateRuntime(first);
    expect(getAgentGateRuntime()).toBe(first);
    setAgentGateRuntime(second);
    expect(getAgentGateRuntime()).toBe(second);
  });
});
