/**
 * Persistence: settings in localStorage (small JSON), the imported clip in
 * IndexedDB (binary). Every operation is best-effort — a blocked or missing
 * store degrades to defaults instead of breaking the plugin.
 */

import { normalizeSettings, type SoundSettings } from './settings.ts'

const SETTINGS_KEY = 'dsh-plugin-sound:settings'
const DB_NAME = 'dsh-plugin-sound'
const DB_VERSION = 1
const CLIP_STORE = 'clips'
const CLIP_KEY = 'current'

/** One imported clip plus the metadata the settings page shows. */
export interface StoredClip {
  readonly blob: Blob
  readonly name: string
  /** Decoded length in milliseconds, or 0 when it could not be measured. */
  readonly durationMs: number
  readonly addedAt: number
}

/**
 * Read the saved settings.
 * @returns normalized settings, or defaults when nothing is stored.
 */
export function loadSettings(): SoundSettings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY)
    return normalizeSettings(raw === null || raw === undefined ? undefined : JSON.parse(raw))
  } catch {
    return normalizeSettings(undefined)
  }
}

/**
 * Persist settings.
 * @param settings - values to save.
 */
export function saveSettings(settings: SoundSettings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Private mode or a full quota: the running session keeps its in-memory copy.
  }
}

/** Resolve the clips object store, creating the database on first use. */
function openDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    const factory = globalThis.indexedDB
    if (factory === undefined) { resolve(undefined); return }
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(undefined)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CLIP_STORE)) db.createObjectStore(CLIP_STORE)
    }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { resolve(undefined) }
    request.onblocked = () => { resolve(undefined) }
  })
}

/**
 * Read the stored clip.
 * @returns the clip, or undefined when none is stored or the store is unavailable.
 */
export async function loadClip(): Promise<StoredClip | undefined> {
  const db = await openDatabase()
  if (db === undefined) return undefined
  return new Promise((resolve) => {
    try {
      const request = db.transaction(CLIP_STORE, 'readonly').objectStore(CLIP_STORE).get(CLIP_KEY)
      request.onsuccess = () => {
        const value = request.result as StoredClip | undefined
        resolve(value !== undefined && value !== null && value.blob instanceof Blob ? value : undefined)
      }
      request.onerror = () => { resolve(undefined) }
    } catch {
      resolve(undefined)
    }
  })
}

/**
 * Store the imported clip, replacing any previous one.
 * @param clip - blob and metadata to keep.
 * @returns whether the write succeeded.
 */
export async function saveClip(clip: StoredClip): Promise<boolean> {
  const db = await openDatabase()
  if (db === undefined) return false
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(CLIP_STORE, 'readwrite')
      transaction.objectStore(CLIP_STORE).put(clip, CLIP_KEY)
      transaction.oncomplete = () => { resolve(true) }
      transaction.onerror = () => { resolve(false) }
      transaction.onabort = () => { resolve(false) }
    } catch {
      resolve(false)
    }
  })
}

/**
 * Forget the imported clip.
 * @returns whether the delete succeeded.
 */
export async function clearClip(): Promise<boolean> {
  const db = await openDatabase()
  if (db === undefined) return false
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(CLIP_STORE, 'readwrite')
      transaction.objectStore(CLIP_STORE).delete(CLIP_KEY)
      transaction.oncomplete = () => { resolve(true) }
      transaction.onerror = () => { resolve(false) }
      transaction.onabort = () => { resolve(false) }
    } catch {
      resolve(false)
    }
  })
}
