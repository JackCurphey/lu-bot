export function createLlm({ baseUrl, fetchImpl = fetch }) {
  async function post(path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Model server request to ${path} failed with status ${res.status}`);
    }
    return res.json();
  }

  return {
    async chat({ model, messages, temperature = 0.8 }) {
      const json = await post('/chat/completions', { model, messages, temperature });
      return json.choices[0].message.content;
    },

    async embed({ model, input }) {
      const json = await post('/embeddings', { model, input });
      return json.data.map((d) => d.embedding);
    },
  };
}
