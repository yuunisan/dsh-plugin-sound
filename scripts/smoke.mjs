/**
 * Bundle-format smoke test.
 *
 * DSH serves client bundles to `window.__ModuleLoader__`, which calls
 * `load({ id, factory })` and expects `factory(require)` to return the module
 * exports. This script loads the built artifact exactly that way, with no DOM,
 * and asserts the registration shape — catching a broken wrapper, a renamed
 * bundle id, or an unexpected external import before the app ever sees it.
 */

import { readFileSync } from 'node:fs'

let registered
const windowStub = {
  __ModuleLoader__: {
    load(entry) { registered = entry },
  },
}

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
new Function('window', `${source}\n//# sourceURL=dsh-plugin-sound/client.js`)(windowStub)

if (registered === undefined) throw new Error('bundle did not register with __ModuleLoader__')
if (registered.id !== 'dsh-plugin-sound') throw new Error(`unexpected bundle id: ${registered.id}`)
if (typeof registered.factory !== 'function') throw new Error('factory is not a function')

const exports_ = registered.factory((specifier) => {
  throw new Error(`unexpected external require: ${specifier}`)
})

if (typeof exports_.apply !== 'function') throw new Error('missing apply export')
if (!Array.isArray(exports_.inject) || !exports_.inject.includes('remote')) {
  throw new Error(`unexpected inject list: ${JSON.stringify(exports_.inject)}`)
}

console.log('ok: bundle registers as dsh-plugin-sound with apply() and inject:', exports_.inject.join(', '))
