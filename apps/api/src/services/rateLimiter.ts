export class HostRateLimiter {
  private readonly lastFetchByHost = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  async waitForTurn(url: string): Promise<void> {
    const hostname = new URL(url).hostname;
    const now = Date.now();
    const lastFetchAt = this.lastFetchByHost.get(hostname);

    if (lastFetchAt !== undefined) {
      const elapsed = now - lastFetchAt;
      const waitMs = this.minIntervalMs - elapsed;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    this.lastFetchByHost.set(hostname, Date.now());
  }
}
