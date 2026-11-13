/**
 * Turn bookkeeping for the finish signal.
 *
 * The host pushes only `(sessionId, running)`. A turn's duration therefore has
 * to be reconstructed on the page: the first `running: true` after an idle
 * period marks the start, and `running: false` closes it. Kept pure (clock
 * injected) so the policy is testable without a browser.
 */

/** One completed observation. */
export interface TurnEnd {
  readonly sessionId: string
  /** Milliseconds the turn ran, or -1 when its start was never seen. */
  readonly elapsedMs: number
}

/** Tracks the running interval of each Session. */
export class TurnTracker {
  private readonly startedAt = new Map<string, number>()

  /**
   * Feed one host status push.
   * @param sessionId - Session the status belongs to.
   * @param running - whether that Session is now running.
   * @param now - current epoch milliseconds.
   * @returns the finished turn, or `null` while a turn is still open.
   */
  observe(sessionId: string, running: boolean, now: number): TurnEnd | null {
    if (running) {
      if (!this.startedAt.has(sessionId)) this.startedAt.set(sessionId, now)
      return null
    }
    const started = this.startedAt.get(sessionId)
    this.startedAt.delete(sessionId)
    if (started === undefined) return { sessionId, elapsedMs: -1 }
    return { sessionId, elapsedMs: Math.max(0, now - started) }
  }

  /** Forget a Session (on disposal, or when the Host drops it). */
  forget(sessionId: string): void {
    this.startedAt.delete(sessionId)
  }

  /** Start time for one Session, for tests and diagnostics. */
  startOf(sessionId: string): number | undefined {
    return this.startedAt.get(sessionId)
  }

  /** Clear every tracked Session. */
  clear(): void {
    this.startedAt.clear()
  }
}
