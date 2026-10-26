/**
 * Aucun message d'erreur système n'est montré au joueur (D-146, D-168). Seules restent les
 * indications qu'il peut corriger lui-même : refus 4xx rédigés pour lui (saisie invalide,
 * solde insuffisant, partie complète…). Réseau coupé, délai dépassé, panne 5xx ou texte
 * technique : AUCUN texte (chaîne vide), l'écran n'affiche rien. Les pannes du serveur sont
 * regroupées dans le back-office (page Erreurs) ; les détails restent dans les journaux.
 */

const INVALID_VALUE_MESSAGE = 'Valeur invalide.';

/** Erreur système (réseau, délai, panne 5xx) : jamais montrée au joueur. */
export function isSystemFailure(status: number): boolean {
  return status === 0 || status >= 500;
}

/**
 * Refus dont le message du serveur décrit un mécanisme interne (version, idempotence,
 * transition d'état, identifiant…) : reformulés pour le joueur, à partir du `code` stable.
 */
const TECHNICAL_CODE_MESSAGES: Record<string, string> = {
  VERSION_CONFLICT: 'La partie vient de changer. Réessayez.',
  IDEMPOTENCY_KEY_REUSED: 'Cette demande a déjà été envoyée. Réessayez.',
  INVALID_STATUS_TRANSITION: 'Action impossible pour le moment.',
  INVALID_CARD: 'Cette carte ne peut pas être jouée.',
  NOTIFICATION_REJECTED: '',
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

/**
 * Message d'une réponse refusée par l'API, tel qu'il peut être montré au joueur : vide pour une
 * erreur système (réseau, délai, 5xx, même rédigée) ou un texte technique.
 */
export function playerFacingApiMessage(status: number, code: string, message: string): string {
  if (isSystemFailure(status)) return '';
  const reworded = TECHNICAL_CODE_MESSAGES[code];
  if (reworded !== undefined) return reworded;
  if (!message.trim() || looksTechnical(message)) return '';
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
