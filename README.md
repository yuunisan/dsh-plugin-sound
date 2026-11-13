# dsh-plugin-sound

Play a notification sound in the DeepSeek Harness web GUI when a turn finishes — so you can look away while the agent works.

- 🔔 Fires once per prompt, on the host's own turn boundary (`api-session/status`), not on every token or tool call.
- 🎵 Built-in chime, **your own WAV/OGG/MP3**, or a direct audio URL.
- 🤫 Quiet by default when you're looking at the window; optional filter for short turns and background subagent sessions.
- 📦 No bundled audio, no telemetry, no network requests except a URL you paste yourself.

## Install

The plugin is a profile bundle: it declares a `dsh.bundle.patch`, so the Plugins page can install and toggle it like any other bundle.

```bash
# from npm (once published)
npm install dsh-plugin-sound

# or straight from this repository
gh repo clone yuunisan/dsh-plugin-sound
```

Then either:

- **Settings → Plugins → Install** and paste `dsh-plugin-sound` (or the git URL / a local tarball), or
- add the row yourself in `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: sound-notify
      name: dsh-plugin-sound
```

The bundle patch ships that row, so installing the bundle is normally enough.

Restart the app (or let the profile's HMR reload) and a 🔔 button appears at the bottom-right of the page.

## Use

Click 🔔 to open the settings panel:

| Control | Meaning |
|---|---|
| Play a sound when a turn finishes | master switch |
| Built-in chime | synthesized two-note rise, ships with the plugin |
| Imported file | pick a WAV/OGG/MP3 up to 2 MB and 3 s |
| Direct audio URL | absolute `http(s)` URL, e.g. a hosted `.mp3` |
| Volume | 0–100 % |
| Only when this window is not focused | don't ring while you're watching |
| Ignore background sessions | don't ring for subagent sessions |
| Skip turns shorter than *N* s | avoids a beep for a 3-second answer |
| Test sound | plays the current choice immediately |

Settings live in `localStorage`; an imported clip lives in IndexedDB. Both are per-browser, never uploaded.

## Bring your own sound

Import the file yourself, or paste a **direct** audio URL (`.mp3`, `.ogg`, `.wav`). A page link — for example a MyInstants clip page — is not an audio file; download it and import the file instead. Those clips are usually other people's copyright: your download, your disk, your call. This plugin ships no third-party audio and takes no position on what you choose to import.

Getting a legal default: synthesize it, or use a CC0 pack (Kenney, Freesound filtered to CC0).

## How it works

The Node half is a no-op so the package is an ordinary Loader row. The browser half registers one listener:

```ts
ctx.remote.$on('api-session/status', (sessionId, running) => { /* running === false → turn finished */ })
```

Turn duration is reconstructed locally (the first `running: true` opens an interval, `running: false` closes it) and passed through a pure policy function, `skipReason()`, before anything plays. Playback uses an `AudioBuffer` for imported files and an `HTMLAudioElement` for URLs — the element path avoids the CORS requirement that `decodeAudioData` would impose on a remote host.

The bundle is CJS wrapped in `window.__ModuleLoader__.load({ id, factory })`, which is what the harness's client module loader expects; `react` and `@deepseek-ai/cordis` stay external against the loader's frozen module table.

## Develop

```bash
pnpm install
pnpm test        # unit tests for the policy and tracker
pnpm typecheck
pnpm build       # emits lib/index.js (host half) and lib/client.js (browser bundle)
```

Layout:

```
src/index.ts            host half: no-op apply()
src/client/index.ts     wiring: status listener → policy → playback
src/client/settings.ts  settings model + policy (pure, unit-tested)
src/client/tracker.ts   turn duration bookkeeping (pure, unit-tested)
src/client/audio.ts     WebAudio chime + decoded clips + URL element
src/client/storage.ts   localStorage + IndexedDB, best-effort
src/client/ui.ts        shadow-root settings panel (plain DOM)
cordis.patch.yml        the bundle row
```

The settings panel is a shadow-root overlay rather than a Plugins-page slot on purpose: a third-party package cannot rely on a slot id that a given DSH release may not declare. A slot-based page can be added later without changing the storage or policy layers.

## Compatibility

Built against the DSH 0.2.x browser-plugin surface. `package.json` declares a peer range; the installer refuses an incompatible install before downloading anything. If a DSH release renames the status channel, only `src/client/dsh.ts` and the one `$on` call need updating.

## License

MIT — see [LICENSE](./LICENSE). No audio assets are included; the built-in chime is synthesized at runtime.
