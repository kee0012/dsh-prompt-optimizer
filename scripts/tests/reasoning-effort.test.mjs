/**
 * Behavioural regression test: the optimize route must follow the model the
 * user selected.
 *
 * The bug this pins down: the client forwards the reasoning effort saved on the
 * session, and the harness validates an explicit effort strictly instead of
 * clamping it. After switching to a custom route that publishes no reasoning
 * metadata, the stale effort made every request die with
 * UNSUPPORTED_REASONING_EFFORT — picking another model disabled the feature.
 *
 * The `llm` stub below mirrors dsh-llm's `resolveCallWithInfo`: when a model
 * advertises no reasoning metadata, ANY explicit effort is rejected.
 *
 * Usage: node scripts/tests/reasoning-effort.test.mjs [module-path]
 * The optional argument points the cases at another artifact (for example
 * `../../lib/index.js`) so the test can be shown to fail on the pre-fix build.
 * Exit code 0 = every case passed, 1 = a case failed.
 */
const { apply } = await import(process.argv[2] ?? '../../src/index.js');

const ROUTE = '/dsh-prompt-optimizer/optimize';

// --------------------------------------------------------------- fake host ---

function makeHost(models, { failLookup = false } = {}) {
  const routes = new Map();
  const calls = [];
  const ctx = {
    effect(fn) {
      fn();
      return () => {};
    },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
    sessions: { get: () => undefined },
    llm: {
      async resolveModelInfo(provider, model) {
        if (failLookup) throw Object.assign(new Error('adapter lookup unavailable'), { code: 'NO_ADAPTER' });
        const info = models[`${provider}/${model}`];
        if (info === undefined) throw Object.assign(new Error(`no adapter for "${provider}"`), { code: 'NO_ADAPTER' });
        return info;
      },
      stream(options) {
        calls.push(options);
        const info = models[`${options.provider}/${options.model}`];
        const efforts = info?.reasoning?.efforts;
        const requested = options.reasoningEffort;
        const rejected = requested !== undefined && (info?.rejectEffort === true || !Array.isArray(efforts) || !efforts.some((e) => e.id === requested));
        if (rejected) {
          throw Object.assign(
            new Error(`provider "${options.provider}" model "${options.model}" does not support reasoning effort "${requested}"`),
            { code: 'UNSUPPORTED_REASONING_EFFORT' },
          );
        }
        return (async function* () {
          yield { type: 'text-delta', text: 'OPTIMIZED' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
    },
  };
  return { ctx, routes, calls };
}

async function post(routes, body) {
  const handler = routes.get(ROUTE);
  if (handler === undefined) throw new Error(`route ${ROUTE} was never registered`);
  const request = {
    method: 'POST',
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
  let status = 0;
  let payload = null;
  const response = {
    writeHead(code) {
      status = code;
    },
    end(text) {
      payload = JSON.parse(text);
    },
  };
  await handler(request, response);
  return { status, payload };
}

// ----------------------------------------------------------------- fixtures ---

/** A hand-declared custom route: reachable, but it publishes no reasoning data. */
const CUSTOM = { provider: 'gpt', model: 'gpt-6.1-sol', info: { provider: 'gpt', id: 'gpt-6.1-sol', name: 'GPT', context: { contextWindow: 128000 } } };
/** A route that advertises the effort the session carries. */
const RICH = { provider: 'deepseek-official', model: 'deepseek-flash', info: { provider: 'deepseek-official', id: 'deepseek-flash', name: 'DeepSeek', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } } };
/** A route that reasons, but not at the requested level. */
const NARROW = { provider: 'openai', model: 'o4-mini', info: { provider: 'openai', id: 'o4-mini', name: 'o4-mini', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }] } } };
/** Advertises the effort yet still rejects it on dispatch (the retry path). */
const LIAR = { provider: 'acme', model: 'liar', info: { provider: 'acme', id: 'liar', name: 'Liar', reasoning: { efforts: [{ id: 'high', name: 'High' }] }, rejectEffort: true } };

function catalogue(...routes) {
  return Object.fromEntries(routes.map((r) => [`${r.provider}/${r.model}`, r.info]));
}

// -------------------------------------------------------------------- cases ---

const results = [];

async function behavioural(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

await behavioural('custom model + stale effort "high" succeeds and drops the effort', async () => {
  const host = makeHost(catalogue(CUSTOM, RICH));
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: CUSTOM.provider, model: CUSTOM.model, text: 'draft', reasoningEffort: 'high' });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(payload.ok === true, 'payload not ok');
  expect(host.calls.length === 1, `expected one dispatch, got ${host.calls.length}`);
  expect(host.calls[0].reasoningEffort === undefined, `effort leaked to the adapter: ${host.calls[0].reasoningEffort}`);
  return 'no reasoningEffort reached ctx.llm.stream';
});

await behavioural('a supported effort is still honoured', async () => {
  const host = makeHost(catalogue(CUSTOM, RICH));
  apply(host.ctx);
  const { status } = await post(host.routes, { provider: RICH.provider, model: RICH.model, text: 'draft', reasoningEffort: 'high' });
  expect(status === 200, `expected 200, got ${status}`);
  expect(host.calls.length === 1, `expected one dispatch, got ${host.calls.length}`);
  expect(host.calls[0].reasoningEffort === 'high', `effort was not forwarded: ${host.calls[0].reasoningEffort}`);
  return 'reasoningEffort "high" forwarded unchanged';
});

await behavioural('an unsupported level on a reasoning model is dropped, not refused', async () => {
  const host = makeHost(catalogue(NARROW));
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: NARROW.provider, model: NARROW.model, text: 'draft', reasoningEffort: 'high' });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(host.calls[0].reasoningEffort === undefined, 'effort leaked to a model that cannot honour it');
  return 'model default applies instead';
});

await behavioural('a failing capability lookup does not fail the request', async () => {
  const host = makeHost(catalogue(CUSTOM), { failLookup: true });
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: CUSTOM.provider, model: CUSTOM.model, text: 'draft', reasoningEffort: 'high' });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(host.calls[0].reasoningEffort === undefined, 'effort was sent after a failed lookup');
  return 'lookup failure degrades to the model default';
});

await behavioural('a rejected effort is retried once without it', async () => {
  const host = makeHost(catalogue(LIAR));
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: LIAR.provider, model: LIAR.model, text: 'draft', reasoningEffort: 'high' });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(host.calls.length === 2, `expected a retry, got ${host.calls.length} dispatch(es)`);
  expect(host.calls[0].reasoningEffort === 'high', 'first attempt should carry the effort');
  expect(host.calls[1].reasoningEffort === undefined, 'retry must drop the effort');
  return 'second attempt carried no effort';
});

await behavioural('no requested effort sends none and does not retry', async () => {
  const host = makeHost(catalogue(CUSTOM));
  apply(host.ctx);
  const { status } = await post(host.routes, { provider: CUSTOM.provider, model: CUSTOM.model, text: 'draft' });
  expect(status === 200, `expected 200, got ${status}`);
  expect(host.calls.length === 1, `expected one dispatch, got ${host.calls.length}`);
  expect('reasoningEffort' in host.calls[0] === false, 'an effort key was added without a request');
  return 'single dispatch, no reasoningEffort key';
});

await behavioural('request validation is unchanged', async () => {
  const host = makeHost(catalogue(CUSTOM));
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: CUSTOM.provider, model: CUSTOM.model, text: '   ' });
  expect(status === 400, `expected 400, got ${status}`);
  expect(payload.error.code === 'INVALID_REQUEST', `expected INVALID_REQUEST, got ${payload.error.code}`);
  expect(host.calls.length === 0, 'an invalid request reached the model');
  return '400 INVALID_REQUEST, no dispatch';
});

// ------------------------------------------------------------------- report ---

let failures = 0;
for (const result of results) {
  if (!result.ok) failures += 1;
  const mark = result.ok ? 'PASS' : 'FAIL';
  const detail = result.detail === '' ? '' : ` — ${result.detail}`;
  console.log(`[${mark}] ${result.name}${detail}`);
}
console.log(`\n[reasoning-effort] ${results.length - failures}/${results.length} passed`);
if (failures > 0) {
  console.error(`[reasoning-effort] FAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log('[reasoning-effort] OK');
