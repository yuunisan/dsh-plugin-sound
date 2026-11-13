/**
 * The DeepSeek Harness browser-plugin surface this package actually uses.
 *
 * Deliberately structural rather than an import of `@deepseek-ai/cordis`: the
 * published plugin then carries no type dependency on a specific DSH release,
 * and a rename in the host surfaces as one field to fix here. Everything below
 * was read from the shipped `ui-session` / `ui-satellite` plugins of
 * `@deepseek-ai/dsh` 0.2.x.
 */

/** One browser-side Cordis context, narrowed to what this plugin touches. */
export interface PluginContext {
  /**
   * Host-pushed Session status. `running: false` follows a finished Turn
   * (completed, interrupted, or failed) — the signal this plugin rings on.
   * Same call site as `ui-session`: `ctx.remote.$on('api-session/status', ...)`.
   */
  readonly remote: {
    $on(event: 'api-session/status', listener: (sessionId: string, running: boolean) => void): () => void
  }
  /** Session list snapshot; used only to tell the focused Session from a subagent. */
  readonly sessions?: {
    list?: { getSnapshot(): { byId: Record<string, { retainedBy?: { mainView?: number } } | undefined> } }
  }
  /** Register a disposer owned by this plugin's fiber. */
  effect(execute: () => (() => void) | void, label?: string): () => void
}
