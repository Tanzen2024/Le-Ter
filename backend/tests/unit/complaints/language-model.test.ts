import { readAssistantEnv, readSupportLimits } from '../../../src/config/assistant-env';
import { GuardedLanguageModel } from '../../../src/services/ai/guarded-language-model';
import { ModelUnavailableError, type LanguageModel } from '../../../src/services/ai/language-model';
import { OllamaLanguageModel } from '../../../src/services/ai/ollama-language-model';

const REQUEST = {
  system: 'consignes',
  messages: [{ role: 'user' as const, content: 'bonjour' }],
  schema: { type: 'object' },
  maxOutputTokens: 100,
};

function ollama(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return new OllamaLanguageModel({
    baseUrl: 'http://ollama.internal:11434/',
    model: 'qwen2.5:1.5b',
    timeoutMs,
    contextTokens: 4096,
    keepAlive: '10m',
    fetchImpl,
  });
}

describe('fournisseur Ollama (faux serveur, aucun appel réseau)', () => {
  it('envoie une requête bornée, sans flux, en sortie structurée, sans aucun secret', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ message: { content: '{"ok":true}' } }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(ollama(fetchImpl).generate(REQUEST)).resolves.toBe('{"ok":true}');
    expect(calls[0]?.url).toBe('http://ollama.internal:11434/api/chat');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toMatchObject({
      model: 'qwen2.5:1.5b',
      stream: false,
      format: { type: 'object' },
      options: { temperature: 0, num_predict: 100, num_ctx: 4096 },
    });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'consignes' });
    expect(JSON.stringify(calls[0]?.init.headers)).not.toMatch(/authorization/i);
  });

  it('transforme un délai dépassé, une erreur HTTP ou une réponse invalide en indisponibilité', async () => {
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
        ),
      )) as unknown as typeof fetch;
    await expect(ollama(slow, 20).generate(REQUEST)).rejects.toMatchObject({ failure: 'TIMEOUT' });

    const http500 = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(ollama(http500).generate(REQUEST)).rejects.toMatchObject({
      failure: 'HTTP_ERROR',
    });

    const garbage = (async () =>
      new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(ollama(garbage).generate(REQUEST)).rejects.toMatchObject({
      failure: 'INVALID_RESPONSE',
    });

    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(ollama(down).generate(REQUEST)).rejects.toMatchObject({ failure: 'NETWORK' });
  });
});

describe('protection de coût et de disponibilité', () => {
  it('ouvre le disjoncteur après des échecs consécutifs, puis le referme', async () => {
    let now = 0;
    let calls = 0;
    const failing: LanguageModel = {
      provider: 'fake',
      model: 'fake',
      generate: () => {
        calls += 1;
        return Promise.reject(new ModelUnavailableError('TIMEOUT'));
      },
    };
    const guarded = new GuardedLanguageModel(failing, {
      maxConcurrent: 1,
      maxQueued: 1,
      failureThreshold: 2,
      cooldownMs: 60_000,
      clock: () => now,
    });
    await expect(guarded.generate(REQUEST)).rejects.toThrow();
    await expect(guarded.generate(REQUEST)).rejects.toThrow();
    expect(guarded.available()).toBe(false);
    await expect(guarded.generate(REQUEST)).rejects.toMatchObject({ failure: 'CIRCUIT_OPEN' });
    expect(calls).toBe(2);
    now = 60_001;
    expect(guarded.available()).toBe(true);
  });

  it('répond « occupé » au-delà de la file plutôt que d’empiler les appels', async () => {
    let release!: () => void;
    const slow: LanguageModel = {
      provider: 'fake',
      model: 'fake',
      generate: () => new Promise((resolve) => (release = () => resolve('{}'))),
    };
    const guarded = new GuardedLanguageModel(slow, {
      maxConcurrent: 1,
      maxQueued: 0,
      failureThreshold: 3,
      cooldownMs: 1000,
    });
    const first = guarded.generate(REQUEST);
    await expect(guarded.generate(REQUEST)).rejects.toMatchObject({ failure: 'BUSY' });
    release();
    await expect(first).resolves.toBe('{}');
  });
});

describe('configuration', () => {
  it('sans AI_PROVIDER : aucun fournisseur (mode dégradé), rien n’est supposé configuré', () => {
    expect(readAssistantEnv({})).toBeUndefined();
    expect(readAssistantEnv({ AI_PROVIDER: 'none' })).toBeUndefined();
  });

  it('Ollama : URL requise, sans identifiant, modèle léger par défaut', () => {
    expect(() => readAssistantEnv({ AI_PROVIDER: 'ollama' })).toThrow(/OLLAMA_BASE_URL/);
    expect(() =>
      readAssistantEnv({ AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://user:secret@host:11434' }),
    ).toThrow(/identifiant/);
    expect(() => readAssistantEnv({ AI_PROVIDER: 'openai-cloud' })).toThrow(/AI_PROVIDER/);
    expect(
      readAssistantEnv({ AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://127.0.0.1:11434' }),
    ).toMatchObject({
      provider: 'ollama',
      model: 'qwen2.5:1.5b',
      maxConcurrent: 1,
    });
  });

  it('limites de requêtes bornées', () => {
    expect(readSupportLimits({})).toEqual({
      playerMessagesPerHour: 20,
      maxTurnsPerConversation: 15,
    });
    expect(() => readSupportLimits({ AI_PLAYER_MESSAGES_PER_HOUR: '0' })).toThrow();
  });
});
