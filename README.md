# dsh-plugin-sound

Play a notification sound in the DeepSeek Harness web GUI when a turn finishes — so you can look away while the agent works.

- 🔔 Fires once per prompt, on the host's own turn boundary (`api-session/status`), not on every token or tool call.
- 🎵 Built-in chime, **your own WAV/OGG/MP3**, or a direct audio URL.
- 🤫 Quiet by default when you're looking at the window; optional filter for short turns and background subagent sessions.
- 📦 No bundled audio, no telemetry, no network requests except a URL you paste yourself.

## Install

The plugin is a profile bundle: it declares a `dsh.bundle.patch`, so the Plugins page can install and toggle it like any other bundle.

Either:

- **Settings → Plugins → Install** and paste `dsh-plugin-sound`, or
- add the dependency to `~/.dsh/profiles/<profile>/package.json` and run `pnpm install` in that directory:

```json
{
  "dependencies": {
    "dsh-plugin-sound": "^0.1.5"
  }
}
```

The bundle patch ships the Loader row, so installing the bundle is normally enough. If you are adding the row by hand instead, it goes in `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: sound-notify
      name: dsh-plugin-sound
```

Prefer not to depend on the registry? Pin a reviewed commit, so an update is a decision instead of a surprise:

```json
{
  "dependencies": {
    "dsh-plugin-sound": "github:yuunisan/dsh-plugin-sound#<commit-sha>"
  }
}
```

Restart the app (or let the profile's HMR reload) and a 🔔 button appears at the bottom-right of the page.

## Update

With a range in `package.json` (`^0.1.5`, which accepts `0.1.x` but not `0.2.0`), one command moves you to the newest release:

```bash
pnpm update dsh-plugin-sound
```

`pnpm install` on its own will not move it — it honours the lockfile. If your dependency is an exact pin (`"0.1.5"`), `pnpm add dsh-plugin-sound` reports "Already up to date" and leaves it there; name the version you want instead:

```bash
pnpm add dsh-plugin-sound@0.1.5
```

Either style is fine. A range takes fixes automatically; an exact pin makes every update deliberate, which is a reasonable default for a plugin that runs inside the host process.

## Use

Click 🔔 to open the settings panel:

| Control | Meaning |
|---|---|
| Play a sound when a turn finishes | master switch |
| Built-in chime | synthesized two-note rise, ships with the plugin |
| Imported file | pick a WAV/OGG/MP3 up to 2 MB and 3 s |
| Direct audio URL | absolute `https` URL, e.g. a hosted `.mp3`; plain `http` only for localhost |
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

Both sources are held to the same 3 s limit. An imported file's duration is read from its container metadata *before* it is decoded, so a small, very low-bitrate file cannot expand into hundreds of megabytes of PCM. A URL is measured after `loadedmetadata`, before playback, and a watchdog stops the element at the cap so an endless stream cannot ring — or download — past it.

The bundle is CJS wrapped in `window.__ModuleLoader__.load({ id, factory })`, which is what the harness's client module loader expects; `react` and `@deepseek-ai/cordis` stay external against the loader's frozen module table.

## Develop

```bash
npm ci
npm test         # unit tests for the policy and tracker
npm run typecheck
npm run build    # emits lib/index.js (host half) and lib/client.js (browser bundle)
```

`lib/` is committed. Build before committing, and let CI confirm the two agree.

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

## Supply chain

`lib/` is committed so that installing the bundle needs no build step — which also means the committed bundle, not `src/`, is what runs on a user's machine. `.github/workflows/verify.yml` rebuilds from `src/` on every push and fails if `lib/` differs, so the shipped artifact cannot silently drift from the source a reviewer reads.

- Install by commit (`github:yuunisan/dsh-plugin-sound#<sha>`), not by a moving branch; `main` is not a release channel.
- `v*` tags are the reviewed states, and `.github/workflows/publish.yml` publishes them with npm provenance so the tarball is tied to this repository and commit.
- An install runs the package's Node half inside the DSH host process (and its browser half as same-origin page script). Treat every plugin — this one included — as code you are granting that access.

The npm package is published from this repository by CI, so `npm view dsh-plugin-sound repository.url` should always point back here. Check that field before installing anything that claims to be this plugin.

## Troubleshooting

- **No 🔔 button.** Check that your DSH is 0.2.x and that `dsh-plugin-sound` appears in `dsh.profile.bundles` in `~/.dsh/profiles/<profile>/package.json`. Restart the app rather than refreshing: the desktop profile has no live patch reload.
- **Button appears, but no sound at a turn end.** Browsers block audio until the page has had a user gesture. Click anywhere on the page once, then press **Test sound**.
- **A remote URL stays silent.** It must be a *direct* audio URL, not a page that links to one, and it must be `https` (plain `http` is accepted only for localhost).
- **"That clip is Ns — keep notification sounds under 3s".** Both imported files and URLs are capped at 3 s; that is deliberate, so a stray URL cannot ring for minutes.
- **"That file has no readable audio duration".** The file's container does not declare a length; convert it to WAV, OGG, or MP3 and import again.

## License

MIT — see [LICENSE](./LICENSE). No audio assets are included; the built-in chime is synthesized at runtime.
