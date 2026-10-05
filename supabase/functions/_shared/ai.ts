// Server-only booking assistant adapter. Never import into browser code.
import type { AgentTool } from './types.ts';

export const AI_MODEL = 'gpt-6-luna';
const API_URL = 'https://api.openai.com/v1/responses';
type Item = Record<string, unknown>;
export interface AgentResponse {
  response: string | null;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: 'end_turn' | 'tool_use';
  messages: Item[];
}

function isObject(value: unknown): value is Item {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Preserve existing optional tool arguments without changing their meaning.
// Model output is untrusted; reject malformed arguments before any tool executes.
function validateArguments(value: unknown, schema: Item): void {
  const invalid = () => { throw new Error('Invalid AI tool arguments'); };
  if (schema.type === 'object') {
    if (!isObject(value)) return invalid();
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required) && schema.required.some((key) => typeof key !== 'string' || !(key in value))) return invalid();
    for (const [key, field] of Object.entries(value)) {
      if (!Object.hasOwn(properties, key) || !isObject(properties[key])) return invalid();
      validateArguments(field, properties[key]);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || !isObject(schema.items)) return invalid();
    for (const field of value) validateArguments(field, schema.items);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return invalid();
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return invalid();
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return invalid();
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') return invalid();
  } else return invalid();
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return invalid();
}

export function parseAgentResponse(data: unknown, messages: Item[], tools: AgentTool[]): AgentResponse {
  // Never execute partially generated calls or return truncated success messages.
  if (!isObject(data) || data.status !== 'completed' || !Array.isArray(data.output)) {
    throw new Error('AI response was not completed');
  }
  const toolCalls: AgentResponse['toolCalls'] = [];
  const texts: string[] = [];
  for (const item of data.output) {
    if (!isObject(item)) throw new Error('Invalid AI output');
    if (item.type === 'function_call') {
      const tool = tools.find((candidate) => candidate.name === item.name);
      if (!tool || typeof item.call_id !== 'string' || !item.call_id
        || messages.some((previous) => previous.type === 'function_call' && previous.call_id === item.call_id)
        || typeof item.arguments !== 'string' || item.status !== 'completed') {
        throw new Error('Invalid AI tool call');
      }
      let args: unknown;
      try { args = JSON.parse(item.arguments); } catch { throw new Error('Invalid AI tool arguments'); }
      validateArguments(args, tool.input_schema);
      toolCalls.push({ id: item.call_id, name: tool.name, input: args as Item });
    } else if (item.type === 'message') {
      if (item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) {
        throw new Error('Invalid AI message');
      }
      for (const block of item.content) {
        if (!isObject(block)) throw new Error('Invalid AI message content');
        if (block.type === 'refusal') throw new Error('AI request refused');
        if (block.type !== 'output_text' || typeof block.text !== 'string') throw new Error('Invalid AI message content');
        texts.push(block.text);
      }
    } else if (item.type !== 'reasoning') {
      throw new Error('Unexpected AI output type');
    }
  }
  // Sequential calls avoid concurrent booking/message side effects.
  if (toolCalls.length > 1) throw new Error('Parallel AI tool calls are disabled');
  if (!toolCalls.length && !texts.join('').trim()) throw new Error('Empty AI response');
  return {
    response: texts.join('\n') || null,
    toolCalls,
    stopReason: toolCalls.length ? 'tool_use' : 'end_turn',
    messages: [...messages, ...data.output],
  };
}

export async function callAgent(systemPrompt: string, messages: Item[], tools: AgentTool[]): Promise<AgentResponse> {
  // Explicit opt-in for every environment. Compose quarantine sets this false.
  if (Deno.env.get('AI_OUTBOUND_ENABLED') !== 'true') throw new Error('AI outbound access is disabled');
  const apiKey = Deno.env.get('OPENAI_API_KEY')?.trim();
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY environment variable');
  const body = JSON.stringify({
    model: AI_MODEL,
    instructions: systemPrompt,
    input: messages,
    reasoning: { effort: 'none' },
    max_output_tokens: 1024,
    store: false,
    parallel_tool_calls: false,
    tools: tools.map((tool) => ({
      type: 'function', name: tool.name, description: tool.description,
      parameters: tool.input_schema, strict: false,
    })),
  });
  // Bounded attempts and deadlines; errors never include credentials/provider bodies.
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let retry = false;
    try {
      // Keep transport exceptions separate from errors raised by our parser.
      // Never forward arbitrary exception messages that could contain secrets.
      const response = await fetch(API_URL, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body,
      }).catch(() => null);
      if (!response) {
        if (attempt === 2) throw new Error('AI API transport failed');
        retry = true;
      } else if (!response.ok) {
        await response.body?.cancel();
        retry = response.status === 429 || response.status >= 500;
        if (!retry || attempt === 2) throw new Error(`AI API HTTP ${response.status}`);
      } else {
        let data: unknown;
        try { data = await response.json(); } catch { throw new Error('Invalid AI API response'); }
        return parseAgentResponse(data, messages, tools);
      }
    } finally {
      clearTimeout(timer);
    }
    if (retry) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw new Error('AI API unavailable');
}

export function buildMessagesFromHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>, currentUserMessage: string,
): Item[] {
  return [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: currentUserMessage }];
}

export function continueWithToolResults(
  systemPrompt: string, previous: AgentResponse, tools: AgentTool[],
  results: Array<{ tool_use_id: string; content: string; is_error?: boolean }>,
): Promise<AgentResponse> {
  if (previous.stopReason !== 'tool_use' || results.length !== previous.toolCalls.length
    || new Set(results.map((result) => result.tool_use_id)).size !== results.length
    || results.some((result) => !previous.toolCalls.some((call) => call.id === result.tool_use_id))) {
    throw new Error('Invalid AI tool result correlation');
  }
  return callAgent(systemPrompt, [...previous.messages, ...results.map((result) => ({
    type: 'function_call_output', call_id: result.tool_use_id,
    output: result.is_error ? JSON.stringify({ success: false, error: result.content }) : result.content,
  }))], tools);
}
