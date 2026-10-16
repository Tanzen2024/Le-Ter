/**
 * Configuration de l'assistant automatisé des réclamations (D-114, docs/complaints.md).
 *
 * `AI_PROVIDER` vide ou `none` (défaut) : AUCUN modèle — les réclamations restent entièrement
 * utilisables (dépôt, suivi, réponses du support) et l'assistant répond en mode dégradé
 * (classement par mots-clés, vérifications serveur, réponses fixes). Rien n'est inventé : aucun
 * fournisseur n'est supposé configuré.
 *
 * `AI_PROVIDER=ollama` : modèle open-weight servi par Ollama sur NOS machines. `OLLAMA_BASE_URL`
 * est une adresse INTERNE (jamais renvoyée au client ni journalisée).
 */
export interface AssistantEnv {
  provider: 'ollama';
  baseUrl: string;
  model: string;
  timeoutMs: number;
  contextTokens: number;
  maxOutputTokens: number;
  keepAlive: string;
  maxConcurrent: number;
  maxQueued: number;
}

export interface SupportLimitsEnv {
  /** Messages envoyés à l'assistant par joueur et par heure (`AI_PLAYER_MESSAGES_PER_HOUR`). */
  playerMessagesPerHour: number;
  /** Messages du joueur par conversation (`AI_MAX_TURNS_PER_CONVERSATION`). */
  maxTurnsPerConversation: number;
}

/** Modèle par défaut : léger, multilingue (FR/EN), sorties JSON fiables, sans GPU. */
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:1.5b';

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} invalide : entier attendu entre ${min} et ${max}`);
  }
  return parsed;
}

export function readAssistantEnv(
  source: NodeJS.ProcessEnv = process.env,
): AssistantEnv | undefined {
  const provider = (source.AI_PROVIDER ?? '').trim().toLowerCase();
  if (provider === '' || provider === 'none') return undefined;
  if (provider !== 'ollama') {
    throw new Error(`AI_PROVIDER invalide : "${provider}" (valeurs : none, ollama)`);
  }
  const raw = source.OLLAMA_BASE_URL?.trim();
  if (!raw) throw new Error('OLLAMA_BASE_URL requis quand AI_PROVIDER=ollama');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('OLLAMA_BASE_URL invalide : URL http(s) attendue');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OLLAMA_BASE_URL invalide : URL http(s) attendue');
  }
  // Aucun identifiant dans l'URL (il finirait dans un journal ou un message d'erreur).
  if (url.username || url.password) {
    throw new Error('OLLAMA_BASE_URL ne doit contenir aucun identifiant');
  }
  const model = source.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  if (!/^[A-Za-z0-9._:/-]{1,100}$/.test(model)) throw new Error('OLLAMA_MODEL invalide');
  const keepAlive = source.OLLAMA_KEEP_ALIVE?.trim() || '10m';
  if (!/^-?\d+(ms|s|m|h)?$/.test(keepAlive))
    throw new Error('OLLAMA_KEEP_ALIVE invalide (ex. 10m)');
  return {
    provider: 'ollama',
    baseUrl: url.toString().replace(/\/$/, ''),
    model,
    timeoutMs: integer(source.AI_TIMEOUT_MS, 60_000, 'AI_TIMEOUT_MS', 2_000, 180_000),
    contextTokens: integer(source.AI_CONTEXT_TOKENS, 4096, 'AI_CONTEXT_TOKENS', 1024, 32_768),
    maxOutputTokens: integer(source.AI_MAX_OUTPUT_TOKENS, 350, 'AI_MAX_OUTPUT_TOKENS', 64, 2048),
    keepAlive,
    maxConcurrent: integer(source.AI_MAX_CONCURRENCY, 1, 'AI_MAX_CONCURRENCY', 1, 16),
    maxQueued: integer(source.AI_MAX_QUEUE, 4, 'AI_MAX_QUEUE', 0, 100),
  };
}

export function readSupportLimits(source: NodeJS.ProcessEnv = process.env): SupportLimitsEnv {
  return {
    playerMessagesPerHour: integer(
      source.AI_PLAYER_MESSAGES_PER_HOUR,
      20,
      'AI_PLAYER_MESSAGES_PER_HOUR',
      1,
      1000,
    ),
    maxTurnsPerConversation: integer(
      source.AI_MAX_TURNS_PER_CONVERSATION,
      15,
      'AI_MAX_TURNS_PER_CONVERSATION',
      2,
      100,
    ),
  };
}
