import { ModelUnavailableError, type LanguageModel, type ModelRequest } from './language-model';

export interface OllamaOptions {
  /** URL INTERNE du serveur Ollama (jamais exposée au client), ex. http://127.0.0.1:11434. */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Fenêtre de contexte (`num_ctx`) : bornée pour tenir dans la mémoire disponible. */
  contextTokens: number;
  /** Durée de maintien du modèle en mémoire entre deux appels (`keep_alive`, ex. « 10m »). */
  keepAlive: string;
  fetchImpl?: typeof fetch;
}

/** Réponse au-delà de laquelle on refuse de lire (protection mémoire). */
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Appel à Ollama (`POST /api/chat`, sans flux) avec sortie structurée (`format` = schéma JSON),
 * température 0 (réponses stables), délai maximal et taille de réponse bornée. Aucune clé
 * n'est nécessaire : Ollama n'est joignable que sur le réseau interne (docs/complaints.md).
 */
export class OllamaLanguageModel implements LanguageModel {
  readonly provider = 'ollama';
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaOptions) {
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(request: ModelRequest): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          format: request.schema,
          keep_alive: this.options.keepAlive,
          options: {
            temperature: 0,
            num_predict: request.maxOutputTokens,
            num_ctx: this.options.contextTokens,
          },
          messages: [{ role: 'system', content: request.system }, ...request.messages],
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      const timeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new ModelUnavailableError(timeout ? 'TIMEOUT' : 'NETWORK');
    }
    if (!response.ok) {
      // Le corps d'erreur n'est pas recopié (il peut citer la requête).
      throw new ModelUnavailableError('HTTP_ERROR', String(response.status));
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ModelUnavailableError('NETWORK');
    }
    if (text.length > MAX_RESPONSE_BYTES)
      throw new ModelUnavailableError('INVALID_RESPONSE', 'too large');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ModelUnavailableError('INVALID_RESPONSE', 'not json');
    }
    const content = (body as { message?: { content?: unknown } } | null)?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new ModelUnavailableError('INVALID_RESPONSE', 'no content');
    }
    return content;
  }
}
