/**
 * The plugin's settings model: one plain object, one normalizer, one policy
 * predicate. Kept free of browser and DSH types so it is unit-testable and so
 * a corrupt stored value can never take the plugin down.
 */

/** Where the sound comes from. */
export type SoundSource = 'builtin' | 'file' | 'url'

/** Everything the user can change. */
export interface SoundSettings {
  /** Master switch. */
  enabled: boolean
  /** Built-in chime, an imported file, or a direct URL. */
  source: SoundSource
  /** Direct audio URL, used when `source === 'url'`. */
  url: string
  /** Playback gain, 0–1. */
  volume: number
  /** Only ring when the window is not visible. */
  onlyWhenHidden: boolean
  /** Only ring for the focused Session, never for a subagent Session. */
  onlyMainSession: boolean
  /** Skip turns shorter than this, in milliseconds. */
  minTurnMs: number
}

/** Why a finish was silent. `null` means the sound should play. */
export type SkipReason = 'disabled' | 'visible-window' | 'short-turn' | 'background-session'

/** What the policy needs to know about the turn that just ended. */
export interface PlayContext {
  /** Wall-clock duration of the turn, or -1 when the start was not observed. */
  elapsedMs: number
  /** Whether the document is currently hidden. */
  hidden: boolean
  /** Whether the Session is the one the user is looking at. */
  mainSession: boolean
}

/** Defaults chosen to be useful without being annoying. */
export const DEFAULT_SETTINGS: SoundSettings = {
  enabled: true,
  source: 'builtin',
  url: '',
  volume: 0.7,
  onlyWhenHidden: true,
  onlyMainSession: true,
  minTurnMs: 2000,
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/**
 * Coerce anything (stored JSON, hand-edited YAML, another version's shape) into
 * a valid settings object.
 * @param raw - unknown candidate value.
 * @returns settings with every field in range.
 */
export function normalizeSettings(raw: unknown): SoundSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<Record<keyof SoundSettings, unknown>>
  const source: SoundSource = input.source === 'file' || input.source === 'url' || input.source === 'builtin'
    ? input.source
    : DEFAULT_SETTINGS.source
  return {
    enabled: input.enabled !== false,
    source,
    url: typeof input.url === 'string' ? input.url.trim().slice(0, 2048) : '',
    volume: typeof input.volume === 'number' && Number.isFinite(input.volume)
      ? clamp(input.volume, 0, 1)
      : DEFAULT_SETTINGS.volume,
    onlyWhenHidden: input.onlyWhenHidden !== false,
    onlyMainSession: input.onlyMainSession !== false,
    minTurnMs: typeof input.minTurnMs === 'number' && Number.isFinite(input.minTurnMs)
      ? clamp(Math.round(input.minTurnMs), 0, 600_000)
      : DEFAULT_SETTINGS.minTurnMs,
  }
}

/**
 * Whether a string is a URL this plugin is willing to hand to an `<audio>`.
 * @param value - candidate string.
 * @returns true for absolute http(s) URLs only.
 */
export function isPlayableUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Extensions a browser can usually play directly. */
const AUDIO_EXTENSION = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|weba|webm)$/i

/**
 * Heuristic: does this URL point at an audio file rather than a web page?
 * Used only for advice in the UI — a CDN URL without an extension can still
 * play, so a `false` result never blocks the user.
 * @param value - candidate URL.
 * @returns true when the path ends in a known audio extension.
 */
export function looksLikeAudioUrl(value: string): boolean {
  try {
    return AUDIO_EXTENSION.test(new URL(value).pathname)
  } catch {
    return false
  }
}

/**
 * Decide whether the finished turn should ring.
 * @param settings - current settings.
 * @param context - facts about the finished turn.
 * @returns the reason to stay silent, or `null` to play.
 */
export function skipReason(settings: SoundSettings, context: PlayContext): SkipReason | null {
  if (!settings.enabled) return 'disabled'
  if (settings.onlyWhenHidden && !context.hidden) return 'visible-window'
  if (settings.onlyMainSession && !context.mainSession) return 'background-session'
  if (settings.minTurnMs > 0 && context.elapsedMs >= 0 && context.elapsedMs < settings.minTurnMs) return 'short-turn'
  return null
}

/** Maximum accepted imported file size, in bytes. */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024
/** Maximum accepted clip length, in milliseconds. */
export const MAX_SOUND_MS = 3000

/**
 * Validate a user-selected file before it is stored.
 * @param file - candidate as reported by the file input.
 * @returns an error message, or `null` when acceptable.
 */
export function fileRejection(file: { size: number; type: string; name: string }): string | null {
  if (file.size > MAX_SOUND_BYTES) return 'That file is larger than 2 MB.'
  if (file.size === 0) return 'That file is empty.'
  if (file.type !== '' && !file.type.startsWith('audio/')) {
    const looksAudio = /\.(wav|wave|ogg|oga|mp3|m4a|aac|flac|opus|webm)$/i.test(file.name)
    if (!looksAudio) return 'That does not look like an audio file (use WAV, OGG, or MP3).'
  }
  return null
}
