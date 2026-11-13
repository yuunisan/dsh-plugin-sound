/**
 * The settings surface.
 *
 * Rendered into a shadow root rather than a host slot: this package is meant to
 * be installable from npm by any DSH profile, so it cannot depend on a slot id
 * that a given DSH release may or may not declare. A shadow root also keeps the
 * styles out of the host page in both directions.
 *
 * Everything here is plain DOM — no React import — which keeps the browser
 * bundle free of runtime dependencies.
 */

import type { SoundSettings, SoundSource } from './settings.ts'

/** Callbacks the page wires to storage and playback. */
export interface PanelOptions {
  /** Current settings, read on every render. */
  getSettings(): SoundSettings
  /** Persist a changed settings object. */
  save(settings: SoundSettings): void
  /** Import and validate a chosen file; resolves to an error message or null. */
  importFile(file: File): Promise<string | null>
  /** Forget the imported file. */
  clearFile(): Promise<void>
  /** Label for the imported clip, or '' when none is stored. */
  clipLabel(): string
  /** Play the current sound. */
  test(): Promise<void>
}

const STYLE = `
:host { all: initial; }
.panel {
  position: fixed; right: 20px; bottom: 64px; z-index: 2147483000;
  width: 320px; max-height: 80vh; overflow: auto;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e6e8ee; background: #1b1e26; border: 1px solid #2f3542;
  border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.45); padding: 14px 16px;
}
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.title { font-weight: 600; font-size: 14px; }
.close { background: none; border: 0; color: #9aa4b8; font-size: 16px; cursor: pointer; padding: 2px 6px; }
.close:hover { color: #e6e8ee; }
.row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.row.column { flex-direction: column; align-items: stretch; gap: 4px; }
label { color: #c3c9d6; }
input[type=text], input[type=number] {
  width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px;
  border: 1px solid #39414f; background: #12151b; color: #e6e8ee; font: inherit;
}
input[type=range] { width: 100%; }
button.action {
  padding: 6px 10px; border-radius: 6px; border: 1px solid #39414f;
  background: #232936; color: #e6e8ee; font: inherit; cursor: pointer;
}
button.action:hover { background: #2b3342; }
button.primary { background: #2f6feb; border-color: #2f6feb; }
button.primary:hover { background: #3b7bf5; }
.hint { color: #8792a6; font-size: 11.5px; margin-top: 6px; }
.status { color: #7dd3a0; font-size: 12px; min-height: 16px; margin-top: 6px; }
.error { color: #f08a8a; }
.trigger {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 36px; height: 36px; border-radius: 18px; cursor: pointer;
  border: 1px solid #39414f; background: #1b1e26; color: #e6e8ee; font-size: 16px;
  box-shadow: 0 6px 20px rgba(0,0,0,.35);
}
.trigger:hover { background: #2b3342; }
.hidden { display: none; }
`

/** Build one labelled checkbox bound to a settings field. */
function checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const row = document.createElement('label')
  row.className = 'row'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  input.addEventListener('change', () => { onChange(input.checked) })
  const text = document.createElement('span')
  text.textContent = label
  row.append(input, text)
  return row
}

/**
 * Mount the floating bell and its settings panel.
 * @param options - storage and playback callbacks.
 * @returns disposer that removes every node it created.
 */
export function mountSettingsPanel(options: PanelOptions): () => void {
  const host = document.createElement('div')
  host.setAttribute('data-dsh-plugin-sound', '')
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLE

  const trigger = document.createElement('button')
  trigger.className = 'trigger'
  trigger.type = 'button'
  trigger.title = 'Notification sound settings'
  trigger.setAttribute('aria-label', 'Notification sound settings')
  trigger.textContent = '🔔'

  const panel = document.createElement('div')
  panel.className = 'panel hidden'

  const status = document.createElement('div')
  status.className = 'status'
  const setStatus = (text: string, isError = false): void => {
    status.textContent = text
    status.classList.toggle('error', isError)
    if (text !== '') window.setTimeout(() => { if (status.textContent === text) status.textContent = '' }, 4000)
  }

  const render = (): void => {
    const settings = options.getSettings()
    panel.replaceChildren()

    const header = document.createElement('div')
    header.className = 'header'
    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = 'Notification sound'
    const close = document.createElement('button')
    close.className = 'close'
    close.type = 'button'
    close.textContent = '✕'
    close.addEventListener('click', () => { panel.classList.add('hidden') })
    header.append(title, close)

    const enabled = checkbox('Play a sound when a turn finishes', settings.enabled, (value) => {
      update({ enabled: value })
    })

    const sourceRow = document.createElement('div')
    sourceRow.className = 'row column'
    const sourceLabel = document.createElement('label')
    sourceLabel.textContent = 'Sound'
    const sources: Array<[SoundSource, string]> = [
      ['builtin', 'Built-in chime (no file needed)'],
      ['file', 'Imported file (WAV / OGG / MP3)'],
      ['url', 'Direct audio URL'],
    ]
    sourceRow.append(sourceLabel)
    for (const [value, text] of sources) {
      const option = document.createElement('label')
      option.className = 'row'
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'dsh-sound-source'
      radio.checked = settings.source === value
      radio.addEventListener('change', () => { if (radio.checked) update({ source: value }) })
      const label = document.createElement('span')
      label.textContent = text
      option.append(radio, label)
      sourceRow.append(option)
    }

    const fileRow = document.createElement('div')
    fileRow.className = 'row column'
    const fileLabel = document.createElement('label')
    fileLabel.textContent = options.clipLabel() === '' ? 'No file imported yet' : `Imported: ${options.clipLabel()}`
    const fileActions = document.createElement('div')
    fileActions.className = 'row'
    const picker = document.createElement('input')
    picker.type = 'file'
    picker.accept = 'audio/*,.wav,.ogg,.mp3,.m4a,.flac'
    picker.className = 'hidden'
    picker.addEventListener('change', () => {
      const file = picker.files?.[0]
      if (file === undefined) return
      void options.importFile(file).then((error) => {
        if (error !== null) { setStatus(error, true); return }
        update({ source: 'file' })
        setStatus('Imported.')
        render()
      })
    })
    const importButton = document.createElement('button')
    importButton.className = 'action'
    importButton.type = 'button'
    importButton.textContent = 'Choose file…'
    importButton.addEventListener('click', () => { picker.click() })
    fileActions.append(importButton)
    if (options.clipLabel() !== '') {
      const clearButton = document.createElement('button')
      clearButton.className = 'action'
      clearButton.type = 'button'
      clearButton.textContent = 'Remove'
      clearButton.addEventListener('click', () => {
        void options.clearFile().then(() => { setStatus('Removed.'); render() })
      })
      fileActions.append(clearButton)
    }
    fileRow.append(fileLabel, fileActions, picker)

    const urlRow = document.createElement('div')
    urlRow.className = 'row column'
    const urlLabel = document.createElement('label')
    urlLabel.textContent = 'Audio URL (https, .mp3/.ogg/.wav)'
    const urlInput = document.createElement('input')
    urlInput.type = 'text'
    urlInput.placeholder = 'https://example.com/ding.mp3'
    urlInput.value = settings.url
    urlInput.addEventListener('change', () => { update({ url: urlInput.value, source: 'url' }) })
    urlRow.append(urlLabel, urlInput)

    const volumeRow = document.createElement('div')
    volumeRow.className = 'row column'
    const volumeLabel = document.createElement('label')
    volumeLabel.textContent = `Volume: ${Math.round(settings.volume * 100)}%`
    const volume = document.createElement('input')
    volume.type = 'range'
    volume.min = '0'
    volume.max = '100'
    volume.step = '5'
    volume.value = String(Math.round(settings.volume * 100))
    volume.addEventListener('input', () => {
      volumeLabel.textContent = `Volume: ${volume.value}%`
      update({ volume: Number(volume.value) / 100 }, false)
    })
    volumeRow.append(volumeLabel, volume)

    const hiddenOnly = checkbox('Only when this window is not focused', settings.onlyWhenHidden, (value) => {
      update({ onlyWhenHidden: value })
    })
    const mainOnly = checkbox('Ignore background sessions (subagents)', settings.onlyMainSession, (value) => {
      update({ onlyMainSession: value })
    })

    const minRow = document.createElement('div')
    minRow.className = 'row'
    const minLabel = document.createElement('label')
    minLabel.textContent = 'Skip turns shorter than'
    const minInput = document.createElement('input')
    minInput.type = 'number'
    minInput.min = '0'
    minInput.max = '600'
    minInput.step = '1'
    minInput.value = String(Math.round(settings.minTurnMs / 1000))
    minInput.style.width = '72px'
    minInput.addEventListener('change', () => {
      update({ minTurnMs: Math.max(0, Math.min(600, Number(minInput.value) || 0)) * 1000 })
    })
    const seconds = document.createElement('span')
    seconds.textContent = 's'
    minRow.append(minLabel, minInput, seconds)

    const actions = document.createElement('div')
    actions.className = 'row'
    const testButton = document.createElement('button')
    testButton.className = 'action primary'
    testButton.type = 'button'
    testButton.textContent = 'Test sound'
    testButton.addEventListener('click', () => { void options.test() })
    actions.append(testButton)

    const hint = document.createElement('div')
    hint.className = 'hint'
    hint.textContent = 'You are responsible for the rights to any audio you import or link. Nothing is uploaded anywhere.'

    panel.append(header, enabled, sourceRow, fileRow, urlRow, volumeRow, hiddenOnly, mainOnly, minRow, actions, status, hint)
  }

  /** Apply one change, persist it, and re-render the panel. */
  function update(patch: Partial<SoundSettings>, rerender = true): void {
    options.save({ ...options.getSettings(), ...patch })
    if (rerender) render()
  }

  trigger.addEventListener('click', () => {
    const open = panel.classList.contains('hidden')
    if (open) render()
    panel.classList.toggle('hidden', !open)
  })

  shadow.append(style, trigger, panel)
  document.body.append(host)

  return () => {
    host.remove()
  }
}
