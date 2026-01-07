// Anthropic Claude API client for AI Agent
import type { AgentTool } from './types.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001'; // Claude 4.5 Haiku - fast and cost-effective

/**
 * Fetch with retry logic for rate limiting (429) and transient errors
 * Uses exponential backoff: 1s, 2s, 4s
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // If rate limited (429), wait and retry
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitTime = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.pow(2, attempt) * 1000; // exponential backoff: 1s, 2s, 4s

        console.log(`Rate limited (429). Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // If server error (5xx), retry with backoff
      if (response.status >= 500) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`Server error (${response.status}). Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Fetch attempt ${attempt + 1} failed:`, error);

      if (attempt < maxRetries - 1) {
        const waitTime = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Call Claude API with tools support
 */
export async function callClaude(
  systemPrompt: string,
  messages: ClaudeMessage[],
  tools: AgentTool[]
): Promise<{
  response: string | null;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');

  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  const requestBody = {
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
  };

  try {
    const response = await fetchWithRetry(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Claude API error:', errorData);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data: ClaudeResponse = await response.json();

    // Extract text response and tool calls
    let textResponse: string | null = null;
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        textResponse = block.text || null;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id!,
          name: block.name!,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      response: textResponse,
      toolCalls,
      stopReason: data.stop_reason,
    };
  } catch (error) {
    console.error('Claude API call failed:', error);
    throw error;
  }
}

/**
 * Continue conversation after tool execution
 */
export async function continueWithToolResults(
  systemPrompt: string,
  messages: ClaudeMessage[],
  tools: AgentTool[],
  toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }>
): Promise<{
  response: string | null;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}> {
  // Add tool results as a user message
  const updatedMessages: ClaudeMessage[] = [
    ...messages,
    {
      role: 'user',
      content: toolResults.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.tool_use_id,
        content: result.content,
        is_error: result.is_error,
      })),
    },
  ];

  return callClaude(systemPrompt, updatedMessages, tools);
}

/**
 * Build messages array for Claude from conversation history
 */
export function buildMessagesFromHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentUserMessage: string
): ClaudeMessage[] {
  const messages: ClaudeMessage[] = [];

  // Add conversation history
  for (const msg of history) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Add current user message
  messages.push({
    role: 'user',
    content: currentUserMessage,
  });

  return messages;
}

/**
 * Build messages with assistant's tool use and tool results
 */
export function buildMessagesWithToolUse(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentUserMessage: string,
  assistantToolUse: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  textBeforeTools?: string
): ClaudeMessage[] {
  const messages = buildMessagesFromHistory(history, currentUserMessage);

  // Build assistant message with tool use
  const assistantContent: ClaudeContentBlock[] = [];

  if (textBeforeTools) {
    assistantContent.push({
      type: 'text',
      text: textBeforeTools,
    });
  }

  for (const tool of assistantToolUse) {
    assistantContent.push({
      type: 'tool_use',
      id: tool.id,
      name: tool.name,
      input: tool.input,
    });
  }

  messages.push({
    role: 'assistant',
    content: assistantContent,
  });

  return messages;
}
