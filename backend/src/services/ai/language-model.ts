/**
 * Port du modèle de langage (D-114). Le reste du backend ne connaît que cette interface :
 * Ollama aujourd'hui (modèle open-weight exécuté sur nos machines), un faux modèle dans les
 * tests, et aucun modèle quand rien n'est configuré (mode dégradé).
 *
 * Le modèle ne reçoit QUE le texte nécessaire (consignes, messages de la conversation, faits
 * vérifiés minimisés) et ne renvoie qu'une chaîne JSON, validée ensuite par le domaine.
 */
export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  /** Consignes du système : jamais de secret, de jeton ni de donnée d'un autre joueur. */
  system: string;
  messages: ModelMessage[];
  /** Schéma JSON de la réponse (sortie structurée). */
  schema: object;
  /** Borne de la réponse, en jetons du modèle. */
  maxOutputTokens: number;
}

export interface LanguageModel {
  /** Nom technique affichable (« ollama »), jamais une URL ni une clé. */
  readonly provider: string;
  readonly model: string;
  generate(request: ModelRequest): Promise<string>;
}

export type ModelFailure =
  'TIMEOUT' | 'NETWORK' | 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'BUSY' | 'CIRCUIT_OPEN';

/** Le modèle n'a pas répondu de façon exploitable : le service bascule en mode dégradé. */
export class ModelUnavailableError extends Error {
  constructor(
    readonly failure: ModelFailure,
    detail?: string,
  ) {
    super(`Modèle indisponible : ${failure}${detail ? ` (${detail})` : ''}`);
    this.name = 'ModelUnavailableError';
  }
}
