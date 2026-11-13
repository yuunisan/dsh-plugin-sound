/**
 * Playback.
 *
 * Two paths on purpose:
 * - imported files decode into an `AudioBuffer` (gapless, gain-controllable,
 *   lowest latency);
 * - URLs play through an `HTMLAudioElement`, because decoding a cross-origin
 *   fetch needs CORS headers the user's host may not send. Element playback
 *   works regardless.
 *
 * The built-in chime is synthesized, so the package ships no audio and carries
 * no third-party licence obligation.
 */

import { MAX_SOUND_MS } from './settings.ts'

/** A decoded clip, cached until the stored blob changes. */
interface DecodedClip {
  readonly buffer: AudioBuffer
  readonly durationMs: number
}

let sharedContext: AudioContext | undefined

/** Lazily create (or resume) the page's single AudioContext. */
function audioContext(): AudioContext | undefined {
  const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctor === undefined) return undefined
  if (sharedContext === undefined) {
    try {
      sharedContext = new Ctor()
    } catch {
      return undefined
    }
  }
  if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => {})
  return sharedContext
}

/**
 * Decode a stored blob, reporting its length.
 * @param blob - audio file contents.
 * @returns the decoded buffer and duration.
 * @throws when the browser cannot decode the file.
 */
export async function decodeClip(blob: Blob): Promise<DecodedClip> {
  const context = audioContext()
  if (context === undefined) throw new Error('Web Audio is unavailable in this browser')
  const bytes = await blob.arrayBuffer()
  const buffer = await context.decodeAudioData(bytes.slice(0))
  return { buffer, durationMs: Math.round(buffer.duration * 1000) }
}

/**
 * Read a clip's length from its container metadata, without decoding a sample.
 *
 * The 2 MB import cap bounds compressed bytes, not decoded ones: a small, very
 * low-bitrate file can expand to hundreds of megabytes of PCM. Reading
 * `duration` first means an over-long file is refused before the decoder —
 * and the `AudioBuffer` it would allocate — ever runs.
 * @param blob - audio file contents.
 * @returns the reported length in milliseconds.
 * @throws when the file has no readable duration or is not audio.
 */
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const element = new Audio()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      element.removeEventListener('loadedmetadata', onMetadata)
      element.removeEventListener('error', onError)
      URL.revokeObjectURL(url)
      try {
        element.removeAttribute('src')
        element.load()
      } catch {
        // The element was never given a source.
      }
      complete()
    }
    const onMetadata = (): void => {
      const durationMs = Math.round(element.duration * 1000)
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        finish(() => reject(new Error('no duration metadata')))
        return
      }
      finish(() => resolve(durationMs))
    }
    const onError = (): void => { finish(() => reject(new Error('not readable as audio'))) }

    timer = setTimeout(() => { finish(() => reject(new Error('timed out reading metadata'))) }, 5_000)
    element.preload = 'metadata'
    element.addEventListener('loadedmetadata', onMetadata)
    element.addEventListener('error', onError)
    element.src = url
  })
}

/** Plays at most one sound at a time, so a burst of finishes cannot stack. */
export class SoundPlayer {
  private decoded: DecodedClip | undefined
  private decodedFrom: Blob | undefined
  private source: AudioBufferSourceNode | undefined
  private element: HTMLAudioElement | undefined

  /**
   * Decode and cache a clip for `playClip` / `playBuffer`.
   * @param blob - audio file contents.
   * @returns the decoded length in milliseconds.
   */
  async prepare(blob: Blob): Promise<number> {
    const decoded = await decodeClip(blob)
    this.decoded = decoded
    this.decodedFrom = blob
    return decoded.durationMs
  }

  /** Whether a clip is prepared and ready to play. */
  get ready(): boolean {
    return this.decoded !== undefined
  }

  /** Stop whatever is playing. */
  stop(): void {
    try {
      this.source?.stop()
    } catch {
      // Already stopped.
    }
    this.source = undefined
    if (this.element !== undefined) this.stopElement(this.element)
  }

  /**
   * Tear down one specific element, even when a newer sound has replaced it.
   * @param element - the element this call owns.
   */
  private stopElement(element: HTMLAudioElement): void {
    try {
      element.pause()
      element.removeAttribute('src')
      element.load()
    } catch {
      // Element already torn down.
    }
    if (this.element === element) this.element = undefined
  }

  /**
   * Play the prepared clip.
   * @param volume - gain, 0–1.
   * @returns whether playback started.
   */
  playClip(volume: number): boolean {
    const decoded = this.decoded
    const context = audioContext()
    if (decoded === undefined || context === undefined) return false
    this.stop()
    const source = context.createBufferSource()
    source.buffer = decoded.buffer
    const gain = context.createGain()
    gain.gain.value = volume
    source.connect(gain).connect(context.destination)
    try {
      source.start()
    } catch {
      return false
    }
    this.source = source
    source.onended = () => { if (this.source === source) this.source = undefined }
    return true
  }

  /**
   * Synthesize the built-in two-tone chime.
   * @param volume - gain, 0–1.
   * @returns whether playback started.
   */
  playBuiltin(volume: number): boolean {
    const context = audioContext()
    if (context === undefined) return false
    this.stop()
    const start = context.currentTime
    const gain = context.createGain()
    gain.connect(context.destination)
    // A short, soft two-note rise: enough to notice across a room, not a klaxon.
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55)
    for (const [frequency, offset] of [[880, 0], [1318.5, 0.12]] as const) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, start + offset)
      const voice = context.createGain()
      voice.gain.setValueAtTime(0.0001, start + offset)
      voice.gain.exponentialRampToValueAtTime(0.9, start + offset + 0.02)
      voice.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.4)
      oscillator.connect(voice).connect(gain)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.45)
    }
    return true
  }

  /**
   * Play a remote audio URL.
   *
   * Deliberately a plain `<audio>`: no `crossOrigin`, because most hosts that
   * serve a loose `.mp3` send no `Access-Control-Allow-Origin`, and asking for
   * CORS turns a playable file into a load error. Nothing here samples the
   * bytes, so the media element's own security model is the right one.
   *
   * The clip is held to the same length limit as an imported file. Duration is
   * read from metadata before any playback, and a watchdog stops the element at
   * the cap, so a host that streams an endless (or very long) file cannot keep
   * ringing — or keep downloading — past the limit.
   * @param url - absolute http(s) URL.
   * @param volume - gain, 0–1.
   * @returns whether playback started, plus a user-facing reason when it did not.
   */
  async playUrl(url: string, volume: number): Promise<{ ok: boolean, reason?: string }> {
    this.stop()
    const element = new Audio()
    // Metadata first: a clip this code is about to refuse must not be fetched whole.
    element.preload = 'metadata'
    element.volume = Math.min(1, Math.max(0, volume))
    this.element = element

    return await new Promise((resolve) => {
      let settled = false
      let loadTimer: ReturnType<typeof setTimeout> | undefined
      let capTimer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: { ok: boolean, reason?: string }): void => {
        if (settled) return
        settled = true
        if (loadTimer !== undefined) clearTimeout(loadTimer)
        element.removeEventListener('loadedmetadata', onMetadata)
        element.removeEventListener('playing', onPlaying)
        element.removeEventListener('error', onError)
        if (!result.ok) {
          if (capTimer !== undefined) clearTimeout(capTimer)
          this.stopElement(element)
        }
        resolve(result)
      }
      const onMetadata = (): void => {
        const seconds = element.duration
        if (Number.isFinite(seconds) && seconds * 1000 > MAX_SOUND_MS) {
          finish({
            ok: false,
            reason: `That clip is ${seconds.toFixed(1)}s — keep notification sounds under ${MAX_SOUND_MS / 1000}s.`,
          })
          return
        }
        // A live stream reports no finite duration; the watchdog below still bounds it.
        capTimer = setTimeout(() => { this.stopElement(element) }, MAX_SOUND_MS)
        // Autoplay policy and a not-yet-supported source both reject here; the
        // `error` event carries the media-specific detail when it exists.
        void element.play().catch((error: unknown) => { finish({ ok: false, reason: playRejectionText(error) }) })
      }
      const onPlaying = (): void => { finish({ ok: true }) }
      const onError = (): void => { finish({ ok: false, reason: mediaErrorText(element.error) }) }
      element.addEventListener('loadedmetadata', onMetadata)
      element.addEventListener('playing', onPlaying)
      element.addEventListener('error', onError)
      loadTimer = setTimeout(() => { finish({ ok: false, reason: 'Timed out loading that URL.' }) }, 12_000)
      element.src = url
    })
  }

  /** Forget the decoded clip (the stored blob changed or was removed). */
  reset(): void {
    this.stop()
    this.decoded = undefined
    this.decodedFrom = undefined
  }

  /** Whether the decoded cache still matches the given blob. */
  matches(blob: Blob): boolean {
    return this.decodedFrom === blob
  }

  /** Release the shared AudioContext. */
  static dispose(): void {
    const context = sharedContext
    sharedContext = undefined
    void context?.close().catch(() => {})
  }
}

/** Turn a `MediaError` into advice the user can act on. */
function mediaErrorText(error: MediaError | null): string {
  switch (error?.code) {
    case 2: return 'Network error loading that URL — the host may be down or blocking hotlinks.'
    case 3: return 'That URL could not be decoded. It may be a web page rather than an audio file.'
    case 4: return 'That URL is not a supported audio file — use a direct .mp3/.ogg/.wav link.'
    default: return 'That URL could not be played.'
  }
}

/** Turn a rejected `play()` into advice the user can act on. */
function playRejectionText(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError') return 'The browser blocked playback — click anywhere on the page once, then retry.'
  if (name === 'NotSupportedError') return 'That URL is not a supported audio file — use a direct .mp3/.ogg/.wav link.'
  return 'That URL could not be played.'
}
