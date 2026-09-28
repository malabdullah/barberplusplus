import { AI_MODEL, buildMessagesFromHistory, callAgent, continueWithToolResults, parseAgentResponse } from './ai.ts';
import type { AgentTool } from './types.ts';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}
async function rejects(fn: () => unknown, expected: string) {
  try { await fn(); } catch (error) {
    assert(error instanceof Error && error.message.includes(expected), 'Unexpected error');
    return;
  }
  throw new Error('Expected rejection');
}
const tools: AgentTool[] = [{
  name: 'check_slots', description: 'Synthetic availability tool',
  input_schema: { type: 'object', properties: {
    date: { type: 'string' }, services: { type: 'array', items: { type: 'string' } },
    language: { type: 'string', enum: ['ar', 'en'] }, count: { type: 'number' },
  }, required: ['date'] },
}];
const toolOutput = (id = 'call_1') => ({
  type: 'function_call', id: `fc_${id}`, call_id: id, name: 'check_slots',
  arguments: '{"date":"2026-10-01"}', status: 'completed',
});
const textOutput = (text = 'Available') => ({
  type: 'message', id: 'msg_1', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});
const completed = (output: unknown[]) => ({ status: 'completed', output });

async function mockApi(callback: (requests: Record<string, unknown>[]) => Promise<void>, responses: Response[]) {
  const oldFetch = globalThis.fetch;
  const saved = ['OPENAI_API_KEY', 'AI_OUTBOUND_ENABLED'].map((name) => [name, Deno.env.get(name)]);
  const requests: Record<string, unknown>[] = [];
  Deno.env.set('OPENAI_API_KEY', 'synthetic-key');
  Deno.env.set('AI_OUTBOUND_ENABLED', 'true');
  globalThis.fetch = ((url: string | URL | Request, options?: RequestInit) => {
    assert(url === 'https://api.openai.com/v1/responses');
    assert(options?.redirect === 'error');
    assert(new Headers(options?.headers).get('Authorization') === 'Bearer synthetic-key');
    requests.push(JSON.parse(String(options?.body)));
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request');
    return Promise.resolve(response);
  }) as typeof fetch;
  try { await callback(requests); } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name!); else Deno.env.set(name!, value);
    }
  }
}

Deno.test('Luna request is server-only, stateless, bounded and sequential', async () => {
  await mockApi(async (requests) => {
    const history = buildMessagesFromHistory([{ role: 'assistant', content: 'هلا' }], 'ابي موعد باجر');
    const result = await callAgent('Synthetic system prompt', history, tools);
    const request = requests[0];
    assert(request.model === AI_MODEL && AI_MODEL === 'gpt-6-luna');
    assert(request.store === false && request.parallel_tool_calls === false);
    assert(request.max_output_tokens === 1024);
    assert(JSON.stringify(request.reasoning) === '{"effort":"none"}');
    assert(!('temperature' in request) && !('previous_response_id' in request));
    assert(JSON.stringify(request.input) === JSON.stringify(history));
    assert(JSON.stringify(request.tools).includes('"strict":false'));
    assert(result.response === 'متوفر' && result.stopReason === 'end_turn');
  }, [Response.json(completed([textOutput('متوفر')]))]);
});

Deno.test('multi-step tool loop retains all calls, outputs and their call IDs', async () => {
  await mockApi(async (requests) => {
    let result = await callAgent('system', buildMessagesFromHistory([], 'Book'), tools);
    result = await continueWithToolResults('system', result, tools, [{ tool_use_id: 'call_1', content: '{"slots":[]}' }]);
    result = await continueWithToolResults('system', result, tools, [{ tool_use_id: 'call_2', content: 'unavailable', is_error: true }]);
    const input = requests[2].input as Record<string, unknown>[];
    assert(input.length === 5);
    assert(input[1].call_id === 'call_1' && input[2].call_id === 'call_1');
    assert(input[3].call_id === 'call_2' && input[4].call_id === 'call_2');
    assert(String(input[4].output).includes('"success":false'));
    assert(result.response === 'Try another time');
  }, [Response.json(completed([toolOutput()])), Response.json(completed([toolOutput('call_2')])), Response.json(completed([textOutput('Try another time')]))]);
});

Deno.test('AI quarantine and missing key deny outbound before fetch', async () => {
  await mockApi(async (requests) => {
    Deno.env.set('AI_OUTBOUND_ENABLED', 'false');
    await rejects(() => callAgent('system', [], tools), 'disabled');
    Deno.env.set('AI_OUTBOUND_ENABLED', 'true');
    Deno.env.delete('OPENAI_API_KEY');
    await rejects(() => callAgent('system', [], tools), 'Missing OPENAI_API_KEY');
    assert(requests.length === 0);
  }, []);
});

Deno.test('reject incomplete, refused, empty, unknown and parallel outputs', async () => {
  const cases = [
    [{ status: 'incomplete', output: [toolOutput()] }, 'not completed'],
    [completed([]), 'Empty'],
    [completed([{ ...toolOutput(), name: 'delete_all' }]), 'Invalid AI tool call'],
    [completed([{ ...toolOutput(), status: 'in_progress' }]), 'Invalid AI tool call'],
    [completed([toolOutput(), toolOutput('call_2')]), 'Parallel'],
    [completed([{ type: 'web_search_call' }]), 'Unexpected'],
    [completed([{ ...textOutput(), content: [{ type: 'refusal', refusal: 'no' }] }]), 'refused'],
  ] as const;
  for (const [data, error] of cases) await rejects(() => parseAgentResponse(data, [], tools), error);
});

Deno.test('reject malformed/unknown/missing/wrong-type tool arguments before execution', async () => {
  for (const args of ['{', 'null', '[]', '{}', '{"date":2}', '{"date":"x","extra":true}',
    '{"date":"x","language":"fr"}', '{"date":"x","services":[2]}', '{"date":"x","count":"2"}']) {
    await rejects(() => parseAgentResponse(completed([{ ...toolOutput(), arguments: args }]), [], tools), 'Invalid AI tool arguments');
  }
  const valid = parseAgentResponse(completed([toolOutput()]), [], tools);
  assert(valid.toolCalls[0].input.date === '2026-10-01');
  await rejects(() => parseAgentResponse(completed([toolOutput()]), valid.messages, tools), 'Invalid AI tool call');
  await rejects(() => continueWithToolResults('system', valid, tools, [{ tool_use_id: 'wrong_id', content: 'ok' }]), 'correlation');
});

Deno.test('retry transient HTTP failures but sanitize provider errors', async () => {
  await mockApi(async (requests) => {
    const result = await callAgent('system', [], tools);
    assert(requests.length === 3 && result.response === 'Available');
  }, [new Response('private details', { status: 429 }), new Response('private details', { status: 503 }), Response.json(completed([textOutput()]))]);
  await mockApi(async (requests) => {
    await rejects(() => callAgent('system', [], tools), 'AI API HTTP 401');
    assert(requests.length === 1);
  }, [new Response('private details and secrets', { status: 401 })]);
});

Deno.test('malformed API JSON is not retried or echoed', async () => {
  await mockApi(async (requests) => {
    await rejects(() => callAgent('system', [], tools), 'Invalid AI API response');
    assert(requests.length === 1);
  }, [new Response('private non-JSON body')]);
});

Deno.test('transport exceptions are bounded and never disclose their message', async () => {
  await mockApi(async () => {
    let calls = 0;
    globalThis.fetch = () => { calls++; return Promise.reject(new Error('AI secret-key-in-transport')); };
    await rejects(() => callAgent('system', [], tools), 'AI API transport failed');
    assert(calls === 3);
  }, []);
});

Deno.test('each hung transport is aborted at its configured deadline', async () => {
  await mockApi(async () => {
    const originalTimeout = globalThis.setTimeout;
    let deadlines = 0;
    globalThis.setTimeout = ((handler: () => void, timeout?: number) => {
      if (timeout === 15_000) deadlines++;
      return originalTimeout(handler, timeout === 15_000 ? 1 : timeout);
    }) as typeof setTimeout;
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('synthetic deadline')), { once: true });
    });
    try {
      await rejects(() => callAgent('system', [], tools), 'AI API transport failed');
      assert(deadlines === 3);
    } finally { globalThis.setTimeout = originalTimeout; }
  }, []);
});
