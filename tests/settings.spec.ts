import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  fileRejection,
  isPlayableUrl,
  looksLikeAudioUrl,
  MAX_SOUND_BYTES,
  normalizeSettings,
  skipReason,
} from '../src/client/settings.ts'

describe('normalizeSettings', () => {
  it('returns the defaults for missing or non-object input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps numeric fields into range', () => {
    const settings = normalizeSettings({ volume: 4, minTurnMs: -50 })
    expect(settings.volume).toBe(1)
    expect(settings.minTurnMs).toBe(0)
    expect(normalizeSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_SETTINGS.volume)
  })

  it('rejects an unknown source and keeps a known one', () => {
    expect(normalizeSettings({ source: 'loud' }).source).toBe('builtin')
    expect(normalizeSettings({ source: 'file' }).source).toBe('file')
  })

  it('trims the URL and drops non-strings', () => {
    expect(normalizeSettings({ url: '  https://x.test/a.mp3  ' }).url).toBe('https://x.test/a.mp3')
    expect(normalizeSettings({ url: 42 }).url).toBe('')
  })

  it('treats only explicit false as disabled', () => {
    expect(normalizeSettings({}).enabled).toBe(true)
    expect(normalizeSettings({ enabled: false }).enabled).toBe(false)
  })
})

describe('isPlayableUrl', () => {
  it('accepts any https URL', () => {
    expect(isPlayableUrl('https://cdn.test/a.mp3')).toBe(true)
    expect(isPlayableUrl('https://cdn.test/stream?id=7')).toBe(true)
  })

  it('accepts plain http only for the local machine', () => {
    expect(isPlayableUrl('http://localhost:3000/ding.mp3')).toBe(true)
    expect(isPlayableUrl('http://127.0.0.1:3000/ding.mp3')).toBe(true)
    expect(isPlayableUrl('http://127.0.0.2/ding.mp3')).toBe(true)
    expect(isPlayableUrl('http://[::1]:3000/ding.mp3')).toBe(true)
    // A remote or LAN host over plain http would be fetched in the clear.
    expect(isPlayableUrl('http://cdn.test/a.mp3')).toBe(false)
    expect(isPlayableUrl('http://192.168.1.5/a.mp3')).toBe(false)
  })

  it('rejects other schemes, embedded credentials, and junk', () => {
    expect(isPlayableUrl('javascript:alert(1)')).toBe(false)
    expect(isPlayableUrl('file:///C:/a.wav')).toBe(false)
    expect(isPlayableUrl('data:audio/mp3;base64,AAAA')).toBe(false)
    expect(isPlayableUrl('https://user:secret@cdn.test/a.mp3')).toBe(false)
    expect(isPlayableUrl('not a url')).toBe(false)
    expect(isPlayableUrl('')).toBe(false)
  })
})

describe('looksLikeAudioUrl', () => {
  it('recognises direct audio links', () => {
    expect(looksLikeAudioUrl('https://cdn.test/boom.mp3')).toBe(true)
    expect(looksLikeAudioUrl('https://cdn.test/a/b/ding.OGG')).toBe(true)
    expect(looksLikeAudioUrl('https://cdn.test/x.wav?token=1')).toBe(true)
  })

  it('flags page links and extensionless paths as suspicious', () => {
    expect(looksLikeAudioUrl('https://www.myinstants.com/en/instant/vine-boom-12345/')).toBe(false)
    expect(looksLikeAudioUrl('https://cdn.test/stream?id=7')).toBe(false)
    expect(looksLikeAudioUrl('nonsense')).toBe(false)
  })
})

describe('skipReason', () => {
  const base = { elapsedMs: 5000, hidden: true, mainSession: true }

  it('returns null when everything allows a sound', () => {
    expect(skipReason(DEFAULT_SETTINGS, base)).toBeNull()
  })

  it('stays silent when disabled', () => {
    expect(skipReason({ ...DEFAULT_SETTINGS, enabled: false }, base)).toBe('disabled')
  })

  it('stays silent for a focused window when asked', () => {
    expect(skipReason({ ...DEFAULT_SETTINGS, onlyWhenHidden: true }, { ...base, hidden: false }))
      .toBe('visible-window')
    expect(skipReason({ ...DEFAULT_SETTINGS, onlyWhenHidden: false }, { ...base, hidden: false }))
      .toBeNull()
  })

  it('stays silent for background sessions when asked', () => {
    expect(skipReason({ ...DEFAULT_SETTINGS, onlyMainSession: true }, { ...base, mainSession: false }))
      .toBe('background-session')
    expect(skipReason({ ...DEFAULT_SETTINGS, onlyMainSession: false }, { ...base, mainSession: false }))
      .toBeNull()
  })

  it('skips short turns, but never punishes an unknown duration', () => {
    expect(skipReason({ ...DEFAULT_SETTINGS, minTurnMs: 10_000 }, { ...base, elapsedMs: 1200 }))
      .toBe('short-turn')
    expect(skipReason({ ...DEFAULT_SETTINGS, minTurnMs: 10_000 }, { ...base, elapsedMs: -1 }))
      .toBeNull()
    expect(skipReason({ ...DEFAULT_SETTINGS, minTurnMs: 0 }, { ...base, elapsedMs: 1 }))
      .toBeNull()
  })
})

describe('fileRejection', () => {
  it('accepts a plausible audio file', () => {
    expect(fileRejection({ size: 4096, type: 'audio/ogg', name: 'boom.ogg' })).toBeNull()
  })

  it('rejects oversize and empty files', () => {
    expect(fileRejection({ size: MAX_SOUND_BYTES + 1, type: 'audio/ogg', name: 'a.ogg' })).toContain('2 MB')
    expect(fileRejection({ size: 0, type: 'audio/wav', name: 'a.wav' })).toContain('empty')
  })

  it('accepts an audio extension when the browser reports no MIME type', () => {
    expect(fileRejection({ size: 100, type: '', name: 'meme.WAV' })).toBeNull()
    expect(fileRejection({ size: 100, type: 'text/plain', name: 'notes.txt' })).toContain('audio file')
  })
})
