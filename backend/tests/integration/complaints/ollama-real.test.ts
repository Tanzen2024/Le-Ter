import { readAssistantEnv } from '../../../src/config/assistant-env';
import {
  ASSISTANT_TOOLS,
  guardReply,
  REPLY_JSON_SCHEMA,
  verifiedValuesOf,
} from '../../../src/domain/complaints/assistant';
import { ModelUnavailableError } from '../../../src/services/ai/language-model';
import { OllamaLanguageModel } from '../../../src/services/ai/ollama-language-model';
import { seedPendingPayment } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import { as, createComplaintTestApp, financialSnapshot, key } from '../../fixtures/complaints';
import { createMigratedDatabase, type TestDatabase } from '../../fixtures/pglite';

/**
 * Test RÉEL et FACULTATIF avec Ollama (D-114, docs/complaints.md §8). Jamais exécuté par défaut :
 * la suite standard n'utilise que le faux modèle. Lancement explicite, Ollama démarré et le
 * modèle téléchargé (`ollama pull qwen2.5:1.5b`) :
 *
 *   RUN_REAL_AI_TESTS=1 npm test -- tests/integration/complaints/ollama-real.test.ts
 *   (variables facultatives : OLLAMA_BASE_URL, défaut http://127.0.0.1:11434 ; OLLAMA_MODEL)
 *
 * Demandé explicitement mais Ollama injoignable : la suite ÉCHOUE avec un message clair (un test
 * réel qui passerait sans modèle ne prouverait rien). Base : PGlite en mémoire uniquement.
 */
const enabled = process.env.RUN_REAL_AI_TESTS === '1';
const describeReal = enabled ? describe : describe.skip;

const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434';
const modelName = process.env.OLLAMA_MODEL?.trim() || 'qwen2.5:1.5b';
// Modèle sur CPU : un appel peut prendre plusieurs dizaines de secondes.
const REAL_TIMEOUT_MS = 240_000;
jest.setTimeout(REAL_TIMEOUT_MS);

function realModel(timeoutMs = 120_000, model = modelName) {
  return new OllamaLanguageModel({
    baseUrl,
    model,
    timeoutMs,
    contextTokens: 4096,
    keepAlive: '5m',
  });
}

describeReal('Ollama réel (facultatif, RUN_REAL_AI_TESTS=1)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    const env = readAssistantEnv({
      AI_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: baseUrl,
      OLLAMA_MODEL: modelName,
    });
    expect(env?.model).toBe(modelName);
    let tags: { models?: { name: string }[] };
    try {
      tags = (await (
        await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
      ).json()) as typeof tags;
    } catch {
      throw new Error(`Ollama injoignable sur ${baseUrl} : démarrez-le (docs/complaints.md §8).`);
    }
    if (
      !(tags.models ?? []).some((m) => m.name === modelName || m.name.startsWith(`${modelName}:`))
    ) {
      throw new Error(`Modèle ${modelName} absent : ollama pull ${modelName}`);
    }
    database = await createMigratedDatabase();
  }, REAL_TIMEOUT_MS);
  afterAll(() => database?.close());

  it("classe une demande, extrait l'identifiant, répond, et la réponse est validée par le serveur", async () => {
    const t = createComplaintTestApp(database.sql, { model: realModel() });
    const player = await registerAndLogin(t.app);
    const { paymentId } = await seedPendingPayment(database.sql, player.userId, { amount: 5000 });
    const before = await financialSnapshot(database.sql, player.userId);
    const api = as(t.app, player.accessToken);
    const conversation = await api.post('/api/support/conversations', { language: 'fr' });
    const res = await api.post(
      `/api/support/conversations/${conversation.body.conversation.id}/messages`,
      {
        content: `Mon paiement MTN Money ${paymentId} de 5000 FCFA a été validé, mais mon compte n'a pas été crédité.`,
        language: 'fr',
      },
      key(),
    );
    expect(res.status).toBe(201);
    const meta = res.body.assistantMessage.meta;
    expect(meta.mode).toBe('AI');
    expect(meta.category).toBe('PAYMENT');
    expect(meta.checks).toEqual(
      expect.arrayContaining([{ tool: 'check_payment', outcome: 'FOUND' }]),
    );
    expect(meta.draft.links).toEqual({ paymentId });
    // La réponse affichée a passé la garde (ou a été remplacée par la réponse déterministe).
    const { rows } = await database.sql.query<{ metadata: { validation: Record<string, string> } }>(
      `SELECT metadata FROM support_messages WHERE id = $1`,
      [res.body.assistantMessage.id],
    );
    expect(rows[0]?.metadata.validation.analysis).toBe('OK');
    expect(['OK', expect.stringMatching(/^REJECTED:/)]).toContainEqual(
      rows[0]?.metadata.validation.reply,
    );
    // Aucun outil d'écriture n'existe ; rien n'a changé dans les données financières.
    expect(ASSISTANT_TOOLS.every((tool) => /^(get|list|check)_/.test(tool))).toBe(true);
    expect(await financialSnapshot(database.sql, player.userId)).toBe(before);
    await t.services.analyzer.idle();
  });

  it('une réponse réelle qui cite un identifiant inventé est refusée par la garde', async () => {
    const invented = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b';
    const raw = await realModel().generate({
      system: `Answer ONLY with JSON matching the schema. In "reply", write one French sentence that mentions the transaction identifier ${invented}.`,
      messages: [{ role: 'user', content: 'Quelle est ma transaction ?' }],
      schema: REPLY_JSON_SCHEMA,
      maxOutputTokens: 120,
    });
    const text = (JSON.parse(raw) as { reply: string }).reply;
    expect(text).toContain(invented);
    expect(guardReply(text, verifiedValuesOf({}, ''))).toEqual({
      ok: false,
      reason: 'UNVERIFIED_IDENTIFIER',
    });
  });

  it('délai dépassé et modèle absent deviennent une indisponibilité contrôlée', async () => {
    const request = {
      system: 'Answer with JSON.',
      messages: [{ role: 'user' as const, content: 'Bonjour' }],
      schema: REPLY_JSON_SCHEMA,
      maxOutputTokens: 50,
    };
    await expect(realModel(1).generate(request)).rejects.toBeInstanceOf(ModelUnavailableError);
    await expect(realModel(30_000, 'modele-inexistant:0b').generate(request)).rejects.toMatchObject(
      {
        failure: 'HTTP_ERROR',
      },
    );
  });
});
