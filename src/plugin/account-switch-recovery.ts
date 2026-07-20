import type { ModelFamily } from "./accounts";

export interface AccountSwitchRecoveryEntry {
  sessionID: string;
  modelFamily: ModelFamily;
  sourceAccountIndex: number;
  createdAt: number;
}

export class AccountSwitchRecoveryRegistry {
  private readonly entries = new Map<string, AccountSwitchRecoveryEntry>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now = () => Date.now(),
  ) {}

  mark(input: Omit<AccountSwitchRecoveryEntry, "createdAt">): void {
    this.prune();
    this.entries.set(input.sessionID, { ...input, createdAt: this.now() });
  }

  clear(sessionID: string | undefined): void {
    if (sessionID) this.entries.delete(sessionID);
  }

  consume(sessionID: string | undefined): AccountSwitchRecoveryEntry | undefined {
    this.prune();
    if (!sessionID) return undefined;
    const entry = this.entries.get(sessionID);
    this.entries.delete(sessionID);
    return entry;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [sessionID, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(sessionID);
    }
  }
}

interface RecoveryClient {
  session: {
    abort(input: { path: { id: string } }): Promise<unknown>;
    prompt(input: {
      path: { id: string };
      body: { parts: Array<{ type: "text"; text: string }> };
      query: { directory: string };
    }): Promise<unknown>;
  };
}

export async function resumeAfterAccountSwitch(input: {
  registry: AccountSwitchRecoveryRegistry;
  client: RecoveryClient;
  sessionID: string | undefined;
  directory: string;
  resumeText: string;
}): Promise<AccountSwitchRecoveryEntry | undefined> {
  const entry = input.registry.consume(input.sessionID);
  if (!entry) return undefined;

  await input.client.session.abort({ path: { id: entry.sessionID } }).catch(() => {});
  await input.client.session.prompt({
    path: { id: entry.sessionID },
    body: { parts: [{ type: "text", text: input.resumeText }] },
    query: { directory: input.directory },
  });
  return entry;
}
