/**
 * Aucun message d'erreur technique n'est montré au joueur. Les textes d'erreur affichés passent
 * par ce filtre : un message du serveur reste affiché s'il est rédigé pour le joueur, sinon il
 * est remplacé par une phrase simple. Les détails techniques (code, statut, cause) restent dans
 * les journaux de développement, jamais à l'écran.
 */

/** Repli commun : rien de technique, une action possible. */
export const GENERIC_ERROR_MESSAGE = 'Une erreur est survenue. Réessayez.';
export const SERVER_ERROR_MESSAGE = 'Le serveur a rencontré une erreur. Réessayez dans un instant.';
const INVALID_VALUE_MESSAGE = 'Valeur invalide.';

/**
 * Refus dont le message du serveur décrit un mécanisme interne (version, idempotence,
 * transition d'état, identifiant…) : reformulés pour le joueur, à partir du `code` stable.
 */
const TECHNICAL_CODE_MESSAGES: Record<string, string> = {
  VERSION_CONFLICT: 'La partie vient de changer. Réessayez.',
  IDEMPOTENCY_KEY_REUSED: 'Cette demande a déjà été envoyée. Réessayez.',
  INVALID_STATUS_TRANSITION: 'Action impossible pour le moment.',
  INVALID_CARD: 'Cette carte ne peut pas être jouée.',
  NOTIFICATION_REJECTED: GENERIC_ERROR_MESSAGE,
  RULE_NOT_DEFINED: 'Cette action n’est pas disponible.',
};

const TECHNICAL_PATTERNS: readonly RegExp[] = [
  // Erreurs JavaScript, réseau, pilote ou analyseur, en anglais.
  /\b(error|exception|undefined|null|nan|stack|typeerror|syntaxerror|referenceerror|rangeerror)\b/i,
  // Phrases de validation ou de bibliothèque en anglais (les messages du jeu sont en français).
  /\b(expected|received|invalid|must|required|cannot|can't|failed|unable|not|the|is|are|of)\b/i,
  /\b(fetch|json|unexpected token|network request failed|aborted?|timeout|socket|econn\w*|etimedout|epipe)\b/i,
  /\b(sql|sqlstate|postgres|redis|query|constraint|relation|column)\b/i,
  // Réponses HTTP brutes d'un proxy ou d'un serveur.
  /\b(bad gateway|not found|forbidden|unauthorized|too many requests|service unavailable|gateway timeout|internal server)\b/i,
  /\b(status code|http\s*\d{3})\b/i,
  // Vocabulaire interne de l'API (D-033 : la session est un concept technique).
  /\b(idempoten\w*|identifiant de (session|partie)|transition|payload|endpoint|token)\b/i,
  // Identifiants, traces, structures et adresses.
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\bat \S+ \(|\n\s+at /,
  /[{}<>[\]`]|=>|::/,
  /https?:\/\/|localhost|\b\d{1,3}(\.\d{1,3}){3}\b/i,
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, // CODE_INTERNE
];

/** Le texte trahit-il un détail technique (anglais système, code, trace, identifiant…) ? */
export function looksTechnical(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return TECHNICAL_PATTERNS.some((p) => p.test(t));
}

/** Message d'une réponse refusée par l'API, tel qu'il peut être montré au joueur. */
export function playerFacingApiMessage(status: number, code: string, message: string): string {
  const reworded = TECHNICAL_CODE_MESSAGES[code];
  if (reworded) return reworded;
  // Message absent : laissé vide, l'écran affiche alors son propre texte de secours.
  if (!message.trim()) return '';
  // Les messages du serveur, même en 5xx (paiement, maintenance), sont rédigés pour le joueur ;
  // seul un texte technique (proxy, panne, exception) est remplacé.
  if (looksTechnical(message)) return status >= 500 ? SERVER_ERROR_MESSAGE : GENERIC_ERROR_MESSAGE;
  return message;
}

/** Messages par champ : un message technique devient « Valeur invalide. ». */
export function playerFacingFieldMessages(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, text]) => [
      field,
      typeof text === 'string' && !looksTechnical(text) ? text : INVALID_VALUE_MESSAGE,
    ]),
  );
}
