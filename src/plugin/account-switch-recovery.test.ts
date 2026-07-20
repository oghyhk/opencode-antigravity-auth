import { describe, expect, it, vi } from "vitest";

import { AccountSwitchRecoveryRegistry, resumeAfterAccountSwitch } from "./account-switch-recovery";
import { AntigravityConfigSchema } from "./config";

describe("AccountSwitchRecoveryRegistry", () => {
  it("consumes a pending account-switch recovery once", async () => {
    const registry = new AccountSwitchRecoveryRegistry();
    const abort = vi.fn().mockResolvedValue(undefined);
    const prompt = vi.fn().mockResolvedValue(undefined);

    registry.mark({ sessionID: "ses_123", modelFamily: "gemini", sourceAccountIndex: 1 });

    await expect(
      resumeAfterAccountSwitch({
        registry,
        client: { session: { abort, prompt } },
        sessionID: "ses_123",
        directory: "C:/workspace",
        resumeText: "continue",
      }),
    ).resolves.toMatchObject({ sessionID: "ses_123", modelFamily: "gemini", sourceAccountIndex: 1 });

    expect(abort).toHaveBeenCalledWith({ path: { id: "ses_123" } });
    expect(prompt).toHaveBeenCalledWith({
      path: { id: "ses_123" },
      body: { parts: [{ type: "text", text: "continue" }] },
      query: { directory: "C:/workspace" },
    });
    await expect(
      resumeAfterAccountSwitch({
        registry,
        client: { session: { abort, prompt } },
        sessionID: "ses_123",
        directory: "C:/workspace",
        resumeText: "continue",
      }),
    ).resolves.toBeUndefined();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("does not resume an expired marker", () => {
    let now = 1_000;
    const registry = new AccountSwitchRecoveryRegistry(100, () => now);
    registry.mark({ sessionID: "ses_123", modelFamily: "claude", sourceAccountIndex: 0 });
    now += 101;

    expect(registry.consume("ses_123")).toBeUndefined();
  });

  it("clears a marker after the account retry succeeds", async () => {
    const registry = new AccountSwitchRecoveryRegistry();
    const prompt = vi.fn().mockResolvedValue(undefined);

    registry.mark({ sessionID: "ses_123", modelFamily: "claude", sourceAccountIndex: 0 });
    registry.clear("ses_123");

    await expect(
      resumeAfterAccountSwitch({
        registry,
        client: { session: { abort: vi.fn().mockResolvedValue(undefined), prompt } },
        sessionID: "ses_123",
        directory: "C:/workspace",
        resumeText: "continue",
      }),
    ).resolves.toBeUndefined();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("enables account-switch continuation by default", () => {
    expect(AntigravityConfigSchema.parse({}).account_switch_auto_resume).toBe(true);
  });
});
