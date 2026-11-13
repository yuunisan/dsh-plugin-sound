/**
 * Build configuration.
 *
 * Two artifacts, two module systems:
 * - `lib/index.js` — the Node half the Loader imports (ESM).
 * - `lib/client.js` — the browser bundle. DSH serves client bundles to
 *   `window.__ModuleLoader__`, which expects a CJS factory registration rather
 *   than an ES module: the banner opens the factory, the footer returns its
 *   exports, and `require(...)` inside resolves against the loader's frozen
 *   module table.
 *
 * The browser half imports nothing external, so no module-table requests need
 * declaring; if a future version imports React or Cordis, add them to
 * `external` in the second config and to `dsh.client.external` if they are not
 * part of the platform baseline.
 */

import type { UserConfig } from 'tsdown'

const configs: UserConfig[] = [
  {
    name: 'dsh-plugin-sound',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: true,
  },
  {
    name: 'dsh-plugin-sound/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-plugin-sound", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]

export default configs
