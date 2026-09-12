export function createLlm({ baseUrl, fetchImpl = fetch }) {
  async function request(path, { method = 'POST', body, signal } = {}) {
    const init = { method, signal };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    if (!res.ok) {
      throw new Error(`Model server request to ${path} failed with status ${res.status}`);
    }
    return res.json();
  }

  return {
    async chat({ model, messages, temperature = 0.8, maxTokens, signal }) {
      const body = { model, messages, temperature };
      if (maxTokens !== undefined) body.max_tokens = maxTokens;
      const json = await request('/chat/completions', { body, signal });
      return json.choices[0].message.content;
    },

    // The reply path needs to know whether a reply was cut short by the token
    // cap, so it can trim a half-finished sentence. chat() keeps its simpler
    // string contract for the judges, which never hit the cap.
    async chatWithFinish({ model, messages, temperature = 0.8, maxTokens, signal }) {
      const body = { model, messages, temperature };
      if (maxTokens !== undefined) body.max_tokens = maxTokens;
      const json = await request('/chat/completions', { body, signal });
      const choice = json.choices[0];
      return { content: choice.message.content, finishReason: choice.finish_reason ?? null };
    },

    async embed({ model, input }) {
      const json = await request('/embeddings', { body: { model, input } });
      return json.data.map((d) => d.embedding);
    },

    // Used at startup to warn when the configured judge model is not
    // installed, instead of discovering it as a 404 on the first judge call.
    async listModels() {
      const json = await request('/models', { method: 'GET' });
      return json.data.map((m) => m.id);
    },
  };
}
