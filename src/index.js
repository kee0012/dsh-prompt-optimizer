/**
 * dsh-prompt-optimizer — server half.
 *
 * Exposes a small same-origin HTTP route that calls the user's currently
 * selected model (provider/model are sent from the browser client) and returns
 * an optimized prompt. The client places the result back into the composer.
 */
import { randomUUID } from 'node:crypto';

export const name = 'dsh-prompt-optimizer';

export const inject = ['webServer', 'llm', 'sessions'];

const ROUTE_PATH = '/dsh-prompt-optimizer/optimize';
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB is enough for long drafts.
const OPTIMIZER_TEMPERATURE = 0.4; // stable, focused rewrites without being too rigid
const CONTEXT_MESSAGE_LIMIT = 6; // recent messages used when "结合上下文" is enabled

const OPTIMIZER_SYSTEM_PROMPT = `You are a world-class prompt engineering expert. The user gives you a draft prompt. Your job is to deeply understand it, then rewrite it into a high-quality, ready-to-use prompt.

FIRST, silently analyze the user's input as thoroughly as possible. Consider at least:

1. Literal meaning: What is the user literally asking for?
2. True intent: What outcome does the user actually want? What problem are they trying to solve?
3. Role: What role or identity should the AI take? Is one implied?
4. Task: What exact actions should the AI perform? Break vague verbs into concrete steps.
5. Context: What background, domain, or situation is implied? What does the AI need to know?
6. Audience: Who will consume the output? What tone and depth are appropriate?
7. Inputs: What materials or information will be provided? What is still missing?
8. Constraints: What limits, forbidden actions, or requirements can be inferred?
9. Output format: What structure, length, style, or format does the user likely need?
10. Ambiguities: Which phrases are vague, contradictory, or could be interpreted in multiple ways?

Use this analysis to rewrite the draft. Do not output the analysis.

Rules for the rewritten prompt:
- Output ONLY the optimized prompt. No commentary, explanation, preface, or markdown code fences.
- Keep the same language as the user's input.
- Preserve the user's original intent and all explicit requirements.
- Make implicit assumptions explicit only when they are safe and strongly implied; otherwise mark missing information with 【placeholder】.
- Convert vague instructions into concrete, actionable, verifiable instructions.
- Use structure (short paragraphs, numbered steps, clear sections) only when it improves clarity.
- Do not invent facts, goals, constraints, or data the user did not express or clearly imply.
- If the original is already excellent, make only a light polish.

The final output must be a prompt that a person could paste directly and get a better result than the original.
`;

const STYLE_INSTRUCTIONS = {
  concise: `
Optimization style: concise.
- Keep the rewrite as short as possible while preserving the original intent and key requirements.
- Remove filler, redundant phrasing, and low-value words.
- Do not add extra sections unless they are essential.
`,
  standard: `
Optimization style: standard.
- Balance completeness with brevity.
- Add structure and missing useful elements only when they clearly improve clarity.
- Keep the result natural and easy to paste.
`,
  detailed: `
Optimization style: detailed.
- Produce a comprehensive, self-contained prompt.
- Explicitly cover role, task, context, constraints, steps, output format, and quality criteria.
- Use 【placeholder】 for any key information the user did not provide.
`,
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

/** Refuse cross-origin writes; the web UI is same-origin. */
function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === undefined || host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Read a size-capped JSON request body. */
async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error('request body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Consume an LLM chunk stream and return the assembled visible text.
 * We deliberately ignore reasoning deltas and tool calls: the optimizer is a
 * plain text-to-text call.
 */
async function collectText(stream) {
  let text = '';
  let failure = null;
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason;
      if (reason?.kind === 'error' || reason?.kind === 'aborted') {
        failure = reason.failure ?? new Error(reason.kind);
      }
    }
  }
  if (failure !== null) throw failure;
  return text.trim();
}

function errorPayload(error) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String(error.message);
    const code = typeof error.code === 'string' ? error.code : 'LLM_ERROR';
    return { ok: false, error: { code, message } };
  }
  return { ok: false, error: { code: 'LLM_ERROR', message: String(error) } };
}

function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ');
}

function buildRecentContext(session, limit = CONTEXT_MESSAGE_LIMIT) {
  if (!session || typeof session.deriveMessages !== 'function') return '';
  const messages = session.deriveMessages();
  const recent = messages.slice(-limit).filter((message) => messageText(message).trim() !== '');
  if (recent.length === 0) return '';
  return recent
    .map((message) => `${message.role === 'user' ? 'user' : 'assistant'}: ${messageText(message)}`)
    .join('\n');
}

function buildSystemPrompt(style, contextText) {
  const styleInstruction = STYLE_INSTRUCTIONS[style] ?? STYLE_INSTRUCTIONS.standard;
  const contextSection = contextText === ''
    ? ''
    : `\n\nRecent conversation context, to help you understand the user's draft:\n${contextText}\n`;
  return `${OPTIMIZER_SYSTEM_PROMPT}${contextSection}\n\n${styleInstruction}`;
}


export function apply(ctx) {
  ctx.effect(() => {
    const handler = async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, {
          ok: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' },
        });
        return;
      }

      if (!sameOrigin(request)) {
        sendJson(response, 403, {
          ok: false,
          error: { code: 'FORBIDDEN', message: 'Cross-origin requests are not allowed' },
        });
        return;
      }

      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        sendJson(response, 400, errorPayload(error));
        return;
      }

      const provider = typeof body?.provider === 'string' ? body.provider : '';
      const model = typeof body?.model === 'string' ? body.model : '';
      const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
      const reasoningEffort = typeof body?.reasoningEffort === 'string' ? body.reasoningEffort : undefined;
      const style = typeof body?.style === 'string' ? body.style : 'standard';
      const includeContext = body?.includeContext === true;
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;

      if (provider === '' || model === '' || rawText === '') {
        sendJson(response, 400, {
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'provider, model and non-empty text are required',
          },
        });
        return;
      }

      let contextText = '';
      if (includeContext && sessionId !== undefined) {
        const session = ctx.sessions.get(sessionId);
        contextText = buildRecentContext(session);
      }


      const messages = [{
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: rawText }],
        source: { kind: 'plugin', plugin: name },
      }];

      try {
        const options = {
          provider,
          model,
          messages,
          system: buildSystemPrompt(style, contextText),
          temperature: OPTIMIZER_TEMPERATURE,
        };
        if (reasoningEffort !== undefined) options.reasoningEffort = reasoningEffort;
        const stream = ctx.llm.stream(options);
        const optimized = await collectText(stream);
        if (optimized === '') {
          throw new Error('the model returned an empty optimized prompt');
        }
        sendJson(response, 200, { ok: true, optimized });
      } catch (error) {
        sendJson(response, 500, errorPayload(error));
      }
    };

    const unregister = ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler,
    });
    return () => {
      unregister();
    };
  }, 'dsh-prompt-optimizer: optimize route');
}
