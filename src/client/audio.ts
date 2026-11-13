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
   * @param url - absolute http(s) URL.
   * @param volume - gain, 0–1.
   * @returns whether playback started (a rejected promise reports `false`).
   */
  async playUrl(url: string, volume: number): Promise<boolean> {
    this.stop()
    try {
      const element = new Audio()
      element.crossOrigin = 'anonymous'
      element.preload = 'auto'
      element.volume = Math.min(1, Math.max(0, volume))
      element.src = url
      this.element = element
      await element.play()
      return true
    } catch {
      return false
    }
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
