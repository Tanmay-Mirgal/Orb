import type { LogStore } from 'core';
import { createRedactor } from 'shared';

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;

/**
 * Buffers build output, masks secret values, pushes batches to Redis (for the live view) and keeps the
 * full text so it can be archived in object storage when the build ends.
 */
export class BuildLog {
  private pending: string[] = [];
  private archive: string[] = [];
  private archiveBytes = 0;
  private timer: NodeJS.Timeout | undefined;
  private redact: (line: string) => string = (l) => l;

  constructor(
    private readonly store: LogStore,
    private readonly deploymentId: string,
  ) {}

  setSecrets(secrets: Iterable<string>) {
    this.redact = createRedactor(secrets);
  }

  line = (message: string): void => {
    const text = `[${new Date().toISOString()}] ${this.redact(message)}`;
    this.pending.push(text);
    if (this.archiveBytes < MAX_ARCHIVE_BYTES) {
      this.archive.push(text);
      this.archiveBytes += text.length + 1;
    }
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 300);
  };

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    try {
      await this.store.appendBuild(this.deploymentId, batch);
    } catch {
      // Redis hiccup: the archived copy still has the lines.
    }
  }

  text(): string {
    return this.archive.join('\n') + '\n';
  }
}
