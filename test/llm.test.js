import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../src/llm.js';

function stubFetch(payload, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { fetchImpl, calls };
}

test('chat returns the assistant message content', async () => {
  const { fetchImpl, calls } = stubFetch({
    choices: [{ message: { role: 'assistant', content: 'hello' } }],
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  const out = await llm.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(out, 'hello');
  assert.equal(calls[0].url, 'http://x/v1/chat/completions');
  assert.equal(calls[0].body.model, 'm');
});

test('embed returns one vector per input', async () => {
  const { fetchImpl } = stubFetch({
    data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  const vectors = await llm.embed({ model: 'e', input: ['a', 'b'] });

  assert.deepEqual(vectors, [[1, 2], [3, 4]]);
});

test('a non-2xx response throws with the status', async () => {
  const { fetchImpl } = stubFetch({ error: 'boom' }, { status: 500 });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });

  await assert.rejects(
    () => llm.chat({ model: 'm', messages: [] }),
    (err) => err.message.includes('500'),
  );
});

// --- Ollama contract ---
//
// Captured from Ollama 0.34 on the deployment host, 2026-09-10. These pin the
// wire format the client depends on: an Ollama upgrade that changes it should
// fail here, loudly, rather than at 2am in a Discord channel.

test('chat parses a real Ollama chat.completion response', async () => {
  const { fetchImpl } = stubFetch({
    id: 'chatcmpl-293',
    object: 'chat.completion',
    created: 1789077699,
    model: 'qwen3:4b-instruct',
    system_fingerprint: 'fp_ollama',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'OK! 😊 How' },
      finish_reason: 'length',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });

  assert.equal(
    await llm.chat({ model: 'qwen3:4b-instruct', messages: [{ role: 'user', content: 'say ok' }] }),
    'OK! 😊 How',
  );
});

test('embed parses a real Ollama embeddings response', async () => {
  const { fetchImpl } = stubFetch({
    object: 'list',
    data: [
      { object: 'embedding', embedding: [0.005299894, -0.0020928506] },
      { object: 'embedding', embedding: [-0.14002158, -0.030111587] },
    ],
    model: 'nomic-embed-text',
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });

  assert.deepEqual(
    await llm.embed({ model: 'nomic-embed-text', input: ['a', 'b'] }),
    [[0.005299894, -0.0020928506], [-0.14002158, -0.030111587]],
  );
});

test('a failure names the endpoint, not a particular vendor', async () => {
  const { fetchImpl } = stubFetch({ error: { message: 'boom' } }, { status: 400 });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });

  await assert.rejects(
    () => llm.chat({ model: 'm', messages: [] }),
    (err) => {
      assert.ok(!/LM Studio/i.test(err.message), `vendor name leaked: ${err.message}`);
      assert.ok(err.message.includes('400'));
      assert.ok(err.message.includes('/chat/completions'));
      return true;
    },
  );
});

// --- Old Lu stage 1: abort, token cap, model list -----------------------------

function recordingFetch(payload, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { fetchImpl, calls };
}

const chatPayload = { choices: [{ message: { role: 'assistant', content: 'YES' } }] };

test('chat passes an abort signal through to fetch', async () => {
  const { fetchImpl, calls } = recordingFetch(chatPayload);
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  const controller = new AbortController();
  await llm.chat({ model: 'm', messages: [], signal: controller.signal });
  assert.equal(calls[0].init.signal, controller.signal);
});

test('chat sends max_tokens only when maxTokens is given', async () => {
  const { fetchImpl, calls } = recordingFetch(chatPayload);
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  await llm.chat({ model: 'm', messages: [], maxTokens: 3 });
  await llm.chat({ model: 'm', messages: [] });
  assert.equal(JSON.parse(calls[0].init.body).max_tokens, 3);
  assert.equal('max_tokens' in JSON.parse(calls[1].init.body), false);
});

test('listModels GETs /models and returns the model ids', async () => {
  const { fetchImpl, calls } = recordingFetch({
    object: 'list',
    data: [
      { id: 'qwen3:4b-instruct', object: 'model', created: 1, owned_by: 'library' },
      { id: 'nomic-embed-text:latest', object: 'model', created: 1, owned_by: 'library' },
    ],
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  assert.deepEqual(await llm.listModels(), ['qwen3:4b-instruct', 'nomic-embed-text:latest']);
  assert.equal(calls[0].url, 'http://x/v1/models');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
});

test('listModels throws with the status on a non-2xx response', async () => {
  const { fetchImpl } = recordingFetch({}, { status: 503 });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  await assert.rejects(() => llm.listModels(), (err) => err.message.includes('503'));
});

// --- Task 14: chatWithFinish reports the finish reason -----------------------

test('chatWithFinish returns the content and finish_reason', async () => {
  const { fetchImpl } = recordingFetch({
    choices: [{ message: { role: 'assistant', content: 'YES' }, finish_reason: 'length' }],
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  const out = await llm.chatWithFinish({ model: 'm', messages: [] });
  assert.deepEqual(out, { content: 'YES', finishReason: 'length' });
});

test('chatWithFinish reports finishReason null when the field is absent', async () => {
  const { fetchImpl } = recordingFetch(chatPayload);
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  const out = await llm.chatWithFinish({ model: 'm', messages: [] });
  assert.equal(out.finishReason, null);
});

test('chatWithFinish sends max_tokens only when maxTokens is given', async () => {
  const { fetchImpl, calls } = recordingFetch(chatPayload);
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  await llm.chatWithFinish({ model: 'm', messages: [], maxTokens: 3 });
  await llm.chatWithFinish({ model: 'm', messages: [] });
  assert.equal(JSON.parse(calls[0].init.body).max_tokens, 3);
  assert.equal('max_tokens' in JSON.parse(calls[1].init.body), false);
});
