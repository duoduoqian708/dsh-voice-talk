// Build the two release artifacts:
//   lib/index.js  — Node half (ESM): speak-protocol prompt section + settings namespace.
//   lib/client.js — browser half (CJS wrapped in the module-loader factory the
//                   web shell serves at /plugins/<id>/client.js).
// Externals mirror the two module systems exactly: the Node half keeps its
// production dependencies external (a real install has them on disk), the
// browser half keeps only the web shell's seeded module-table rows external
// (react + jsx-runtime) and inlines everything else.
import { build } from 'esbuild'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8'))
const outDir = join(root, '..', 'lib')
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [join(root, '..', 'src/index.ts')],
  outfile: join(outDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  sourcemap: false,
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-settings', 'schemastery', 'ws'],
})

await build({
  entryPoints: [join(root, '..', 'src/client/index.ts')],
  outfile: join(outDir, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  jsx: 'automatic',
  sourcemap: false,
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis'],
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: 'return module.exports; } });' },
})

console.log('[dsh-voice-talk] built lib/index.js and lib/client.js')
