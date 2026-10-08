/**
 * Build step for dsh-prompt-optimizer.
 *
 * Both halves are hand-written ESM that Node and the browser loader can consume
 * as-is, so "building" is a deliberate copy from source to the published
 * `lib/` paths declared in package.json#exports. Keeping the copy explicit
 * preserves the skill contract: `src/` is what you edit, `lib/` is what ships.
 *
 * Usage: node scripts/build.mjs   (also exposed as `pnpm run bundle`)
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Client-half externals — must NEVER be inlined into `lib/client.js`.
 *
 * The page loads every client bundle through `window.__ModuleLoader__`, which
 * hands out ONE shared React runtime. Shipping a second copy inside our bundle
 * breaks hooks at runtime ("Invalid hook call"; `useState` resolves to null),
 * so these four specifiers have to stay external:
 *
 *   ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']
 *
 * This build inlines no dependency at all (it copies hand-written ESM verbatim),
 * so the contract holds by construction. The list is declared and exported so it
 * stays explicit for readers and for `scripts/gates/run.mjs`, and so a future
 * switch to a real bundler knows exactly what to pass as `external`.
 */
export const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
];

const targets = [
  ['src/index.js', 'lib/index.js'],
  ['client/client.js', 'lib/client.js'],
];

for (const [from, to] of targets) {
  const source = resolve(root, from);
  const destination = resolve(root, to);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  const bytes = readFileSync(destination).length;
  console.log(`[build] ${from} -> ${to} (${bytes} bytes)`);
}

console.log('[build] done');
