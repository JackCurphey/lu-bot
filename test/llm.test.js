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
