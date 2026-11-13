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
    if (this.element !== undefined) {
      try {
        this.element.pause()
        this.element.removeAttribute('src')
        this.element.load()
      } catch {
        // Element already torn down.
      }
      this.element = undefined
    }
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
   * @param url - absolute http(s) URL.
   * @param volume - gain, 0–1.
   * @returns whether playback started, plus a user-facing reason when it did not.
   */
  async playUrl(url: string, volume: number): Promise<{ ok: boolean, reason?: string }> {
    this.stop()
    const element = new Audio()
    element.preload = 'auto'
    element.volume = Math.min(1, Math.max(0, volume))
    element.src = url
    this.element = element

    return await new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: { ok: boolean, reason?: string }): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        element.removeEventListener('playing', onPlaying)
        element.removeEventListener('error', onError)
        resolve(result)
      }
      const onPlaying = (): void => { finish({ ok: true }) }
      const onError = (): void => { finish({ ok: false, reason: mediaErrorText(element.error) }) }
      element.addEventListener('playing', onPlaying)
      element.addEventListener('error', onError)
      timer = setTimeout(() => { finish({ ok: false, reason: 'Timed out loading that URL.' }) }, 12_000)
      // Autoplay policy and a not-yet-supported source both reject here; the
      // `error` event carries the media-specific detail when it exists.
      void element.play().catch((error: unknown) => { finish({ ok: false, reason: playRejectionText(error) }) })
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
