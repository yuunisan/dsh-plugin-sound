/**
 * Browser half: ring when a turn finishes.
 *
 * The trigger is the Host's own status push — `api-session/status` with
 * `running: false` — the same signal the harness uses for its "completion
 * unread" badge. That is a turn boundary, not a step or a token, so it fires
 * exactly once per prompt.
 */

import { SoundPlayer } from './audio.ts'
import type { PluginContext } from './dsh.ts'
import { fileRejection, isPlayableUrl, MAX_SOUND_MS, normalizeSettings, skipReason, type SoundSettings } from './settings.ts'
import { clearClip, loadClip, loadSettings, saveClip, saveSettings, type StoredClip } from './storage.ts'
import { TurnTracker } from './tracker.ts'
import { mountSettingsPanel } from './ui.ts'

/** Services this plugin needs. `sessions` is optional and read defensively. */
export const inject = ['remote']

/**
 * Mount the notifier.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: PluginContext): void {
  let settings: SoundSettings = loadSettings()
  let clip: StoredClip | undefined
  let disposed = false

  const player = new SoundPlayer()
  const tracker = new TurnTracker()

  /**
   * Whether a Session is the one the user is looking at. Unknown rows count as
   * focused, so a version change degrades to "ring more" rather than silence.
   */
  const isMainSession = (sessionId: string): boolean => {
    try {
      const row = ctx.sessions?.list?.getSnapshot().byId[sessionId]
      if (row === undefined) return true
      return (row.retainedBy?.mainView ?? 0) > 0
    } catch {
      return true
    }
  }

  /** Play whichever sound the settings select, falling back to the chime. */
  const ring = async (): Promise<void> => {
    if (settings.source === 'url') {
      if (isPlayableUrl(settings.url) && await player.playUrl(settings.url, settings.volume)) return
      player.playBuiltin(settings.volume)
      return
    }
    if (settings.source === 'file' && clip !== undefined) {
      if (!player.matches(clip.blob)) {
        try {
          await player.prepare(clip.blob)
        } catch {
          player.playBuiltin(settings.volume)
          return
        }
      }
      if (player.playClip(settings.volume)) return
    }
    player.playBuiltin(settings.volume)
  }

  const unsubscribe = ctx.remote.$on('api-session/status', (sessionId: string, running: boolean) => {
    const finish = tracker.observe(sessionId, running, Date.now())
    if (finish === null || disposed) return
    const reason = skipReason(settings, {
      elapsedMs: finish.elapsedMs,
      hidden: document.visibilityState === 'hidden',
      mainSession: isMainSession(finish.sessionId),
    })
    if (reason !== null) return
    void ring()
  })

  // The stored clip is decoded up front so the first finish does not pay for it.
  void (async () => {
    clip = await loadClip()
    if (clip !== undefined) {
      try {
        await player.prepare(clip.blob)
      } catch {
        // A clip this browser cannot decode simply falls back to the chime.
      }
    }
  })()

  const removePanel = mountSettingsPanel({
    getSettings: () => settings,
    save: (next) => {
      settings = normalizeSettings(next)
      saveSettings(settings)
    },
    importFile: async (file) => {
      const rejection = fileRejection(file)
      if (rejection !== null) return rejection
      let durationMs = 0
      try {
        durationMs = await player.prepare(file)
      } catch {
        return 'That file could not be decoded as audio.'
      }
      if (durationMs > MAX_SOUND_MS) {
        return `That clip is ${(durationMs / 1000).toFixed(1)}s — keep notification sounds under ${MAX_SOUND_MS / 1000}s.`
      }
      const stored: StoredClip = { blob: file, name: file.name, durationMs, addedAt: Date.now() }
      if (!await saveClip(stored)) return 'Could not save that file (browser storage is unavailable).'
      clip = stored
      return null
    },
    clearFile: async () => {
      await clearClip()
      clip = undefined
      player.reset()
    },
    clipLabel: () => clip === undefined ? '' : `${clip.name} · ${(clip.durationMs / 1000).toFixed(2)}s`,
    test: ring,
  })

  ctx.effect(() => () => {
    disposed = true
    unsubscribe()
    removePanel()
    tracker.clear()
    player.reset()
    SoundPlayer.dispose()
  }, 'sound-notify: teardown')
}
