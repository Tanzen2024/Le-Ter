import type { AssistantEnv } from '../../config/assistant-env';
import { GuardedLanguageModel } from './guarded-language-model';
import type { LanguageModel } from './language-model';
import { OllamaLanguageModel } from './ollama-language-model';

/**
 * Seul endroit qui connaît les fournisseurs (D-114). Les services métier ne reçoivent qu'un
 * `LanguageModel` : ajouter un fournisseur = une branche ici et une valeur d'`AI_PROVIDER`,
 * sans toucher aux réclamations. `override` (tests) remplace le fournisseur ; sans
 * configuration ni override : aucun modèle (mode dégradé).
 */
export function createLanguageModel(
  env: AssistantEnv | undefined,
  override?: LanguageModel,
): GuardedLanguageModel | undefined {
  const inner = override ?? (env ? providerOf(env) : undefined);
  if (!inner) return undefined;
  return new GuardedLanguageModel(inner, {
    maxConcurrent: env?.maxConcurrent ?? 1,
    maxQueued: env?.maxQueued ?? 4,
    failureThreshold: 3,
    cooldownMs: 60_000,
  });
}

function providerOf(env: AssistantEnv): LanguageModel {
  switch (env.provider) {
    case 'ollama':
      return new OllamaLanguageModel({
        baseUrl: env.baseUrl,
        model: env.model,
        timeoutMs: env.timeoutMs,
        contextTokens: env.contextTokens,
        keepAlive: env.keepAlive,
      });
  }
}
