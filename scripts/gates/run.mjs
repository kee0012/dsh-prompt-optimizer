/**
 * Consistency gates for dsh-prompt-optimizer.
 *
 * Checks the DSH plugin contract that would otherwise fail silently at load
 * time: manifest fields, exports wiring, patch/bundle wiring, the three-way
 * name rule (package name == patch id == client ModuleLoader id), inject
 * coverage for every ctx.* service the host half touches, and the React
 * external rule for the client bundle.
 *
 * Usage: node scripts/gates/run.mjs   (also exposed as `pnpm run gates`)
 * Exit code 0 = all gates passed, 1 = at least one gate failed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];

function gate(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
}

function read(relative) {
  const path = resolve(root, relative);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// ---------------------------------------------------------------- manifest ---
let manifest = null;
try {
  manifest = JSON.parse(read('package.json'));
} catch (error) {
  gate('package.json is valid JSON', false, error.message);
}
if (manifest === null) manifest = {};
const pkgName = typeof manifest.name === 'string' ? manifest.name : '';

gate('package.json name is lowercase-hyphenated', /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pkgName), pkgName);
gate('package.json type is "module"', manifest.type === 'module', manifest.type);
// `main` may be written with or without the leading `./`: Node accepts both, and
// DSH resolves the bundle through `exports` anyway. What matters here is that it
// names the built host artifact, not a source file.
const mainField = manifest.main;
gate(
  'main points at lib/index.js',
  mainField === 'lib/index.js' || mainField === './lib/index.js',
  mainField,
);
gate('exports["."] points at ./lib/index.js', manifest.exports?.['.'] === './lib/index.js', manifest.exports?.['.']);
gate('exports["./client"] points at ./lib/client.js', manifest.exports?.['./client'] === './lib/client.js', manifest.exports?.['./client']);
gate('exports["./package.json"] is exposed', manifest.exports?.['./package.json'] === './package.json');
gate('exports["./cordis.patch.yml"] is exposed', manifest.exports?.['./cordis.patch.yml'] === './cordis.patch.yml');
gate('dsh.bundle.patch is declared', typeof manifest.dsh?.bundle?.patch === 'string', manifest.dsh?.bundle?.patch);
gate('dsh.client.platform is "web"', manifest.dsh?.client?.platform === 'web', manifest.dsh?.client?.platform);

const forbidden = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const declaredCore = forbidden.flatMap((field) =>
  Object.keys(manifest[field] ?? {}).filter((dep) => dep.startsWith('@deepseek-ai/')),
);
gate('no @deepseek-ai/* dependency is declared', declaredCore.length === 0, declaredCore.join(', '));

// ------------------------------------------------------------------- patch ---
const patchRelative = typeof manifest.dsh?.bundle?.patch === 'string' ? manifest.dsh.bundle.patch : 'cordis.patch.yml';
const patchText = read(patchRelative);
gate('cordis.patch.yml exists', patchText !== '', patchRelative);
gate(
  'patch insert id equals package name',
  new RegExp(`\\bid:\\s*${pkgName}\\s*$`, 'm').test(patchText),
  pkgName,
);
gate(
  'patch insert name equals package name',
  new RegExp(`\\bname:\\s*${pkgName}\\s*$`, 'm').test(patchText),
  pkgName,
);

// ------------------------------------------------------------- build output ---
const hostText = read('lib/index.js');
const clientText = read('lib/client.js');
gate('lib/index.js exists (run `node scripts/build.mjs`)', hostText !== '');
gate('lib/client.js exists (run `node scripts/build.mjs`)', clientText !== '');
gate(
  'client ModuleLoader id equals package name',
  clientText.includes(`__ModuleLoader__.load({ id: "${pkgName}"`),
  pkgName,
);
gate(
  'client keeps React external (no inlined copy)',
  clientText.includes('require("react")') &&
    !clientText.includes('__SECRET_INTERNALS') &&
    !clientText.includes('react-dom.production'),
);

// ------------------------------------------------------------ inject coverage ---
const injectMatch = /export const inject = \[([^\]]*)\]/.exec(hostText);
const injectList = (injectMatch?.[1] ?? '')
  .split(',')
  .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
  .filter((entry) => entry !== '');
const usedServices = [...new Set([...hostText.matchAll(/\bctx\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((match) => match[1]))]
  .filter((service) => service !== 'effect');
const missing = usedServices.filter((service) => !injectList.includes(service));
gate('host inject covers every ctx.* service', missing.length === 0, missing.join(', '));

// ------------------------------------------------------------------- report ---
let failures = 0;
for (const result of results) {
  if (!result.ok) failures += 1;
  const mark = result.ok ? 'PASS' : 'FAIL';
  const detail = result.detail === '' ? '' : ` (${result.detail})`;
  console.log(`[${mark}] ${result.name}${detail}`);
}
console.log(`\n[gates] ${results.length - failures}/${results.length} passed`);
if (failures > 0) {
  console.error(`[gates] FAILED: ${failures} gate(s) not satisfied`);
  process.exit(1);
}
console.log('[gates] OK');
