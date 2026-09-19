// PROVIDERS template: a usage meter for an AI provider account.
// A plugin cannot start a CLI or read local files, so this section is about
// what a provider exposes over HTTPS: credit, quota, limits.
promptops.providers.registerUsage({
  async getUsage(sdk) {
    const res = await sdk.http.fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: 'Bearer {{secret:apiKey}}' },
    });
    if (res.status === 401) throw new Error('OpenRouter rejected the API key');
    if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`);
    const key = JSON.parse(res.body).data;

    return {
      provider: 'OpenRouter',
      plan: key.is_free_tier ? 'Free tier' : 'Paid',
      // `limit: null` means "no limit reported": PromptOps then shows the number without a bar.
      meters: [
        { id: 'credit', label: 'Credit used', used: Number(key.usage.toFixed(2)), limit: key.limit, unit: 'USD' },
        { id: 'rate', label: 'Requests per interval', used: 0, limit: key.rate_limit?.requests ?? null, unit: `req / ${key.rate_limit?.interval ?? 'interval'}` },
      ],
    };
  },
});
