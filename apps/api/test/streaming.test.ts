import assert from 'node:assert/strict';

import type { ChatAgent, ChatCompletionInput } from '@packages/agents';
import { CompletionsController } from '../src/modules/chat/completions/completions.controller';
import type { FinishReason, LanguageModelUsage } from 'ai';

type StreamResult = ReturnType<ChatAgent['stream']>;

function createSuccessfulStream(options: {
  deltas: string[];
  finishReason?: FinishReason;
  usage?: LanguageModelUsage;
}): StreamResult {
  const { deltas, finishReason = 'stop', usage } = options;

  async function* generator() {
    for (const delta of deltas) {
      yield delta;
    }
  }

  const stream = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    textStream: generator() as any,
    finishReason: Promise.resolve(finishReason),
    ...(usage ? { totalUsage: Promise.resolve(usage) } : {})
  };

  return stream as StreamResult;
}

function createErrorStream(options: { deltas: string[] }): StreamResult {
  const { deltas } = options;

  async function* generator() {
    if (deltas.length > 0) {
      yield deltas[0];
    }
    throw new Error('stream failure');
  }

  const stream = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    textStream: generator() as any,
    finishReason: Promise.resolve<FinishReason>('stop')
  };

  return stream as StreamResult;
}

function createMockResponse() {
  const headers: Record<string, string> = {};
  const writes: string[] = [];
  let resolveClose: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  const res = {
    writableEnded: false,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
    },
    write(chunk: string) {
      writes.push(chunk);
    },
    end() {
      res.writableEnded = true;
      resolveClose();
    }
  };

  return { res, headers, writes, closed };
}

function parseSseEvents(chunks: string[]) {
  const events = chunks
    .filter((chunk) => chunk.startsWith('data: ') && chunk !== 'data: [DONE]\n\n')
    .map((chunk) => {
      const json = chunk.slice('data: '.length).trim();
      return JSON.parse(json);
    });

  const doneCount = chunks.filter((chunk) => chunk === 'data: [DONE]\n\n').length;

  return { events, doneCount };
}

async function testSuccessfulStreamingFlow() {
  const deltas = ['Hello', ' world'];
  const usage: LanguageModelUsage = { inputTokens: 4, outputTokens: 6, totalTokens: 10 };

  const agent: ChatAgent = {
    async run() {
      throw new Error('run not implemented in tests');
    },
    stream() {
      return createSuccessfulStream({ deltas, usage });
    }
  };

  const controller = new CompletionsController(agent);
  const { res, headers, writes, closed } = createMockResponse();

  const payload: ChatCompletionInput = {
    agent: 'chat',
    stream: true,
    messages: [{ role: 'user', content: 'hello' }]
  };

  await controller.createCompletion(payload, res as unknown);
  await closed;

  assert.equal(headers['content-type'], 'text/event-stream');
  assert.equal(headers['cache-control'], 'no-cache');
  assert.equal(headers['connection'], 'keep-alive');

  const { events, doneCount } = parseSseEvents(writes);

  const expectedChunks = deltas.length + 2;
  assert.equal(events.length, expectedChunks, `expected ${expectedChunks} SSE payloads`);
  assert.equal(doneCount, 1, 'expected single [DONE] sentinel');

  const [initial, ...others] = events;
  const finalChunk = others.pop();

  if (!finalChunk) {
    throw new Error('Final chunk missing from streaming output');
  }

  assert.deepEqual(initial.choices[0].delta, { role: 'assistant' });
  assert.equal(initial.choices[0].finish_reason, null);

  others.forEach((chunk, index) => {
    assert.deepEqual(chunk.choices[0].delta, { content: deltas[index] });
    assert.equal(chunk.choices[0].finish_reason, null);
  });

  assert.deepEqual(finalChunk.choices[0].delta, {});
  assert.equal(finalChunk.choices[0].finish_reason, 'stop');
  assert.deepEqual(finalChunk.usage, {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens
  });
}

async function testErrorStreamingFlow() {
  const agent: ChatAgent = {
    async run() {
      throw new Error('run not implemented in tests');
    },
    stream() {
      return createErrorStream({ deltas: ['Hello'] });
    }
  };

  const controller = new CompletionsController(agent);
  const { res, writes, closed } = createMockResponse();

  const payload: ChatCompletionInput = {
    agent: 'chat',
    stream: true,
    messages: [{ role: 'user', content: 'hello' }]
  };

  await controller.createCompletion(payload, res as unknown);
  await closed;

  const { events, doneCount } = parseSseEvents(writes);

  assert.equal(events.length, 3, 'expected initial chunk, delta, and error chunk');
  assert.equal(doneCount, 1, 'expected [DONE] sentinel even on error');

  const [initial, deltaChunk, errorChunk] = events;

  assert.deepEqual(initial.choices[0].delta, { role: 'assistant' });
  assert.deepEqual(deltaChunk.choices[0].delta, { content: 'Hello' });

  assert.equal(errorChunk.choices[0].finish_reason, 'error');
  assert.equal(errorChunk.usage, undefined);
}

async function main() {
  await testSuccessfulStreamingFlow();
  await testErrorStreamingFlow();
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
