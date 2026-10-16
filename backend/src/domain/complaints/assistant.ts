import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_REFERENCE_PATTERN,
  isComplaintCategory,
  type ComplaintCategory,
} from './complaint';

/**
 * Assistant automatisé des réclamations (D-114) : règles PURES, sans fournisseur ni SQL.
 *
 * Le modèle de langage ne fait que trois choses : classer la demande, en extraire des
 * identifiants, rédiger une réponse. Tout ce qu'il produit est une donnée NON FIABLE :
 * - l'analyse est validée champ par champ (`parseAnalysis`) ; un identifiant n'est retenu que
 *   s'il figure MOT POUR MOT dans les messages du joueur (le modèle ne peut pas en inventer) ;
 * - les outils demandés sont filtrés par une liste blanche et exécutés par le SERVEUR avec
 *   l'identité du jeton (jamais avec un identifiant de joueur venant du modèle) ;
 * - la réponse est contrôlée (`guardReply`) : aucun identifiant, montant ou référence absent des
 *   faits vérifiés, aucune action prétendument exécutée, aucun délai promis, aucune identité
 *   humaine revendiquée. Refusée, elle est remplacée par une réponse déterministe.
 */

export type AssistantLanguage = 'fr' | 'en';

export const ASSISTANT_TOOLS = [
  'get_game',
  'list_recent_games',
  'get_wallet_history',
  'check_payment',
  'check_withdrawal',
  'get_tournament_status',
  'get_complaint_status',
] as const;
export type AssistantToolName = (typeof ASSISTANT_TOOLS)[number];

export function isAssistantTool(value: unknown): value is AssistantToolName {
  return (ASSISTANT_TOOLS as readonly unknown[]).includes(value);
}

/** Outils exécutés au plus par message (coût, minimisation des données). */
export const MAX_TOOLS_PER_TURN = 3;

export interface ExtractedReferences {
  gameId?: string;
  tournamentId?: string;
  transactionId?: string;
  paymentId?: string;
  withdrawalId?: string;
  complaintReference?: string;
}

export interface AssistantAnalysis {
  category: ComplaintCategory;
  confidence: 'low' | 'medium' | 'high';
  references: ExtractedReferences;
  /** Heure approximative telle que dite par le joueur (texte libre, jamais vérifié). */
  approximateTime?: string;
  tools: AssistantToolName[];
  needsHuman: boolean;
  playerWantsComplaint: boolean;
  clarifyingQuestion?: string;
}

/** Schéma JSON imposé au modèle (sortie structurée Ollama `format`). */
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...COMPLAINT_CATEGORIES] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    references: {
      type: 'object',
      properties: {
        gameId: { type: 'string' },
        tournamentId: { type: 'string' },
        transactionId: { type: 'string' },
        paymentId: { type: 'string' },
        withdrawalId: { type: 'string' },
        complaintReference: { type: 'string' },
      },
    },
    approximateTime: { type: 'string' },
    tools: { type: 'array', items: { type: 'string', enum: [...ASSISTANT_TOOLS] } },
    needsHuman: { type: 'boolean' },
    playerWantsComplaint: { type: 'boolean' },
    clarifyingQuestion: { type: 'string' },
  },
  required: ['category', 'confidence', 'tools', 'needsHuman', 'playerWantsComplaint'],
} as const;

export const REPLY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggestComplaint: { type: 'boolean' },
  },
  required: ['reply', 'suggestComplaint'],
} as const;

export const ASSISTANT_LIMITS = {
  replyMax: 1200,
  questionMax: 400,
  approximateTimeMax: 80,
} as const;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /RCL-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}/gi;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Analyse renvoyée par le modèle, validée. `playerText` : TOUS les messages du joueur de la
 * conversation ; un identifiant absent de ce texte est un identifiant inventé → refus.
 */
export function parseAnalysis(raw: string, playerText: string): ParseResult<AssistantAnalysis> {
  const data = parseJson(raw);
  if (!isRecord(data)) return { ok: false, reason: 'NOT_JSON_OBJECT' };
  if (!isComplaintCategory(data.category)) return { ok: false, reason: 'INVALID_CATEGORY' };
  const confidence = data.confidence;
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
    return { ok: false, reason: 'INVALID_CONFIDENCE' };
  }
  if (typeof data.needsHuman !== 'boolean' || typeof data.playerWantsComplaint !== 'boolean') {
    return { ok: false, reason: 'INVALID_FLAGS' };
  }
  if (!Array.isArray(data.tools)) return { ok: false, reason: 'INVALID_TOOLS' };

  const known = new Set((playerText.match(UUID) ?? []).map((id) => id.toLowerCase()));
  const knownReferences = new Set((playerText.match(REFERENCE) ?? []).map((r) => r.toUpperCase()));
  const references: ExtractedReferences = {};
  if (data.references !== undefined) {
    if (!isRecord(data.references)) return { ok: false, reason: 'INVALID_REFERENCES' };
    for (const field of [
      'gameId',
      'tournamentId',
      'transactionId',
      'paymentId',
      'withdrawalId',
    ] as const) {
      const value = data.references[field];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' || !UUID_EXACT.test(value)) {
        return { ok: false, reason: 'INVALID_IDENTIFIER' };
      }
      // Identifiant que le joueur n'a jamais écrit : inventé par le modèle.
      if (!known.has(value.toLowerCase())) return { ok: false, reason: 'INVENTED_IDENTIFIER' };
      references[field] = value.toLowerCase();
    }
    const reference = data.references.complaintReference;
    if (reference !== undefined && reference !== null && reference !== '') {
      if (
        typeof reference !== 'string' ||
        !COMPLAINT_REFERENCE_PATTERN.test(reference.toUpperCase())
      ) {
        return { ok: false, reason: 'INVALID_REFERENCE' };
      }
      if (!knownReferences.has(reference.toUpperCase())) {
        return { ok: false, reason: 'INVENTED_REFERENCE' };
      }
      references.complaintReference = reference.toUpperCase();
    }
  }

  const question =
    typeof data.clarifyingQuestion === 'string' ? data.clarifyingQuestion.trim() : undefined;
  const time = typeof data.approximateTime === 'string' ? data.approximateTime.trim() : undefined;
  return {
    ok: true,
    value: {
      category: data.category,
      confidence,
      references,
      ...(time && { approximateTime: time.slice(0, ASSISTANT_LIMITS.approximateTimeMax) }),
      // Liste blanche : un outil inconnu est ignoré (jamais exécuté).
      tools: [...new Set(data.tools.filter(isAssistantTool))],
      needsHuman: data.needsHuman,
      playerWantsComplaint: data.playerWantsComplaint,
      ...(question && { clarifyingQuestion: question.slice(0, ASSISTANT_LIMITS.questionMax) }),
    },
  };
}

export function parseReply(raw: string): ParseResult<{ reply: string; suggestComplaint: boolean }> {
  const data = parseJson(raw);
  if (!isRecord(data)) return { ok: false, reason: 'NOT_JSON_OBJECT' };
  if (typeof data.reply !== 'string' || data.reply.trim().length === 0) {
    return { ok: false, reason: 'EMPTY_REPLY' };
  }
  if (data.reply.length > ASSISTANT_LIMITS.replyMax) return { ok: false, reason: 'REPLY_TOO_LONG' };
  if (typeof data.suggestComplaint !== 'boolean') return { ok: false, reason: 'INVALID_FLAGS' };
  return { ok: true, value: { reply: data.reply.trim(), suggestComplaint: data.suggestComplaint } };
}

/** Valeurs vérifiées que la réponse a le droit de citer. */
export interface VerifiedValues {
  identifiers: Set<string>;
  references: Set<string>;
  numbers: Set<number>;
  /**
   * Constats déterministes du serveur (codes, ex. `PAYMENT_PENDING`). Présents : la réponse est
   * aussi confrontée à ces constats (affirmation contradictoire, crédit non vérifié).
   */
  findings?: ReadonlySet<string>;
}

export interface GuardOptions {
  /**
   * Résumé destiné au support : il peut rapporter ce que le joueur DÉCLARE (« le joueur dit
   * avoir été remboursé »). Les règles sur l'état du compte sont alors levées ; identifiants,
   * montants, actions, délais et identité restent contrôlés.
   */
  declarations?: boolean;
}

/** Collecte identifiants, références et nombres des faits vérifiés (et du texte du joueur). */
export function verifiedValuesOf(facts: unknown, playerText: string): VerifiedValues {
  const values: VerifiedValues = {
    identifiers: new Set((playerText.match(UUID) ?? []).map((id) => id.toLowerCase())),
    references: new Set((playerText.match(REFERENCE) ?? []).map((r) => r.toUpperCase())),
    numbers: new Set(),
  };
  const visit = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) values.numbers.add(value);
    else if (typeof value === 'string') {
      for (const id of value.match(UUID) ?? []) values.identifiers.add(id.toLowerCase());
      for (const ref of value.match(REFERENCE) ?? []) values.references.add(ref.toUpperCase());
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (isRecord(value)) Object.values(value).forEach(visit);
  };
  visit(facts);
  return values;
}

/** Action prétendument exécutée par l'assistant (il n'en exécute aucune). */
const ACTION_CLAIMS = [
  /\b(j['’]ai|je viens d['’]|nous avons|on a)\s+(bien\s+)?(crédit|débit|rembours|corrig|annul|modifi|ajout|restaur|rétabli|valid|transf[ée]r|vers|accord|suspend|bloqu|débloqu|réactiv)/i,
  /\b(i\s+have|i['’]ve|we\s+have|we['’]ve|i\s+just|i)\s+(just\s+)?(credited|debited|refunded|fixed|corrected|cancel+ed|modified|added|restored|validated|transferred|paid|granted|suspended|blocked|unblocked|reactivated|changed)\b/i,
];

/** Délai de résolution promis : jamais connu de l'assistant. */
const PROMISED_DELAYS = [
  /\b(sous|dans|d['’]ici|en moins de)\s+\d+\s*(minutes?|min|heures?|h|jours?|semaines?)\b/i,
  /\b(within|in|under)\s+\d+\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i,
  // Délai vague mais promis, ou date annoncée.
  /(sous|dans|d['’]ici)\s+(quelques|peu de)\s+(minutes|heures|jours)/iu,
  /\b(within|in)\s+(a few|some|the next)\s+(minutes|hours|days)\b/i,
  /(^|[^\p{L}])(demain|après-demain|ce soir|aujourd['’]hui même)([^\p{L}]|$)/iu,
  /\b(tomorrow|tonight|by the end of (the )?(day|week))\b/i,
  /(^|[^\p{L}])(avant|d['’]ici)\s+(le\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}(er)?\s+\p{L}+)/iu,
  /\b(by|before)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(st|nd|rd|th)?\s+\w+)/i,
];

/** Décision humaine prétendument connue : l'assistant ne la connaît jamais. */
const DECISION_CLAIMS = [
  /(réclamation|dossier|demande|contestation)[^.!?]{0,40}(a été|est|sera)\s+(acceptée?|approuvée?|validée?|rejetée?|refusée?|résolue?|retenue?)/iu,
  /(claim|complaint|request|dispute)[^.!?]{0,40}(has been|was|is|will be)\s+(accepted|approved|validated|rejected|denied|resolved|upheld)/i,
  /(le support|l['’]équipe|l['’]administration|un administrateur)[^.!?]{0,30}(a décidé|a validé|a accepté|a refusé|a rejeté|a approuvé|va (vous )?(rembourser|créditer))/iu,
  /(support|the team|an? admin\w*)[^.!?]{0,30}(has decided|has approved|has rejected|has accepted|will refund|will credit)/i,
];

/** Remboursement ou correction prétendument effectués : aucun constat ne le confirme jamais. */
const REFUND_OR_CORRECTION_CLAIMS = [
  /(a été|ont été|avez été|est|sont)\s+(bien\s+)?(remboursée?s?|corrigée?s?|rectifiée?s?|ajustée?s?|rétablie?s?|restaurée?s?)/iu,
  /(remboursement|correction|rectification)[^.!?]{0,30}(a été|est)\s+(effectuée?|réalisée?|traitée?|appliquée?)/iu,
  /(has been|have been|was|were)\s+(refunded|corrected|fixed|adjusted|restored|reimbursed)/i,
  /(refund|correction|reimbursement)[^.!?]{0,30}(has been|was)\s+(processed|completed|issued|made|applied)/i,
];

/** Crédit affirmé : admis seulement si un constat du serveur établit un crédit réel. */
const CREDIT_CLAIMS = [
  /(a été|ont été|avez été|est|sont)\s+(bien\s+)?(créditée?s?|versée?s?|payée?s?)/iu,
  /(has been|have been|was|were)\s+(credited|paid|deposited)/i,
];
const CREDITED_FINDINGS = [
  'PAYMENT_CREDITED',
  'GAME_WON_CREDITED',
  'TOURNAMENT_PRIZE_PAID',
  'WITHDRAWAL_SUCCEEDED',
];

/** Affirmations incompatibles avec un constat du serveur : [constats, motif]. */
const CONTRADICTIONS: readonly [readonly string[], RegExp][] = [
  [
    ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'NO_PAYMENTS', 'PAYMENT_NOT_FOUND'],
    /(paiement|recharge|payment|top-up)[^.!?]{0,40}(est|a été|is|has been|was)\s+(bien\s+)?(confirmée?|validée?|réussie?|abouti|confirmed|successful|completed|validated)/iu,
  ],
  [
    ['WITHDRAWAL_IN_PROGRESS', 'WITHDRAWAL_FAILED', 'NO_WITHDRAWALS', 'WITHDRAWAL_NOT_FOUND'],
    /(retrait|withdrawal)[^.!?]{0,40}(est|a été|is|has been|was)\s+(bien\s+)?(effectuée?|confirmée?|réussie?|completed|confirmed|successful)/iu,
  ],
  [['GAME_LOST', 'GAME_NO_WINNER'], /(vous avez gagné|you won|you have won)/iu],
  [
    [
      'GAME_WON_CREDITED',
      'GAME_WON_SETTLEMENT_PENDING',
      'GAME_WON_NOT_CREDITED',
      'GAME_WON_TOURNAMENT',
    ],
    /(vous avez perdu|you lost|you have lost)/iu,
  ],
];

/** Identité humaine revendiquée. */
const HUMAN_CLAIMS = [
  /\bje\s+suis\s+(un|une)\s+(administrat|agent|conseill|humain|membre\s+de\s+l['’]équipe)/i,
  /\bi\s+am\s+(an?\s+)?(human|administrator|admin|agent|support\s+agent|member\s+of\s+the\s+team)\b/i,
];

/** Montant cité dans une réponse : nombre suivi d'une unité monétaire. */
const AMOUNT = /(\d[\d\s.,]*)\s*(jetons?|tokens?|fcfa|f\s?cfa|xaf|francs?)/gi;

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Contrôle d'une réponse générée avant de la montrer au joueur. */
export function guardReply(
  reply: string,
  verified: VerifiedValues,
  options: GuardOptions = {},
): GuardResult {
  for (const id of reply.match(UUID) ?? []) {
    if (!verified.identifiers.has(id.toLowerCase()))
      return { ok: false, reason: 'UNVERIFIED_IDENTIFIER' };
  }
  for (const ref of reply.match(REFERENCE) ?? []) {
    if (!verified.references.has(ref.toUpperCase()))
      return { ok: false, reason: 'UNVERIFIED_REFERENCE' };
  }
  for (const match of reply.matchAll(AMOUNT)) {
    const amount = Number((match[1] ?? '').replace(/[\s.,]/g, ''));
    if (!Number.isFinite(amount) || !verified.numbers.has(amount)) {
      return { ok: false, reason: 'UNVERIFIED_AMOUNT' };
    }
  }
  if (ACTION_CLAIMS.some((pattern) => pattern.test(reply)))
    return { ok: false, reason: 'ACTION_CLAIM' };
  if (PROMISED_DELAYS.some((pattern) => pattern.test(reply)))
    return { ok: false, reason: 'PROMISED_DELAY' };
  if (HUMAN_CLAIMS.some((pattern) => pattern.test(reply)))
    return { ok: false, reason: 'HUMAN_CLAIM' };
  if (options.declarations) return { ok: true };
  if (DECISION_CLAIMS.some((pattern) => pattern.test(reply)))
    return { ok: false, reason: 'DECISION_CLAIM' };
  if (REFUND_OR_CORRECTION_CLAIMS.some((pattern) => pattern.test(reply)))
    return { ok: false, reason: 'UNVERIFIED_CORRECTION' };
  const findings = verified.findings ?? new Set<string>();
  if (
    CREDIT_CLAIMS.some((pattern) => pattern.test(reply)) &&
    !CREDITED_FINDINGS.some((code) => findings.has(code))
  ) {
    return { ok: false, reason: 'UNVERIFIED_CREDIT' };
  }
  for (const [codes, pattern] of CONTRADICTIONS) {
    if (codes.some((code) => findings.has(code)) && pattern.test(reply)) {
      return { ok: false, reason: 'CONTRADICTS_FACTS' };
    }
  }
  return { ok: true };
}

// --- Repli déterministe (fournisseur absent, indisponible ou réponse invalide) ---------------

const KEYWORDS: readonly [ComplaintCategory, RegExp][] = [
  ['TOURNAMENT_REWARD', /(récompense|recompense|gain du tournoi|prix du tournoi|reward|prize)/i],
  ['WITHDRAWAL', /(retrait|retirer|withdraw|cash ?out|rembours|refund)/i],
  [
    'PAYMENT',
    /(recharg|paiement|payé|paye|achat|acheter|mtn|orange money|momo|mobile money|top.?up|payment|paid|deposit|cinetpay)/i,
  ],
  ['TOURNAMENT', /(tournoi|tournament|classement|ranking|inscription|registration)/i],
  ['FRAUD', /(trich|fraud|suspect|collusion|cheat|arnaq|scam|complice)/i],
  [
    'ACCOUNT_SECURITY',
    /(mot de passe|password|piraté|pirate|hack|connexion impossible|can.?t log|compte bloqué|locked|sécurité|security|suspendu|suspended)/i,
  ],
  [
    'TECHNICAL',
    /(déconnect|deconnect|connexion perdue|perdu (la |ma )?connexion|lost (my )?connection|disconnect|bug|crash|plant|freeze|figé|lag|erreur|error)/i,
  ],
  [
    'BALANCE',
    /(solde|jetons?|tokens?|balance|débité|debite|diminué|baissé|disparu|missing coins)/i,
  ],
  [
    'GAME_RESULT',
    /(partie|victoire|gagné|gagne|défaite|perdu|résultat|game|won|win|lost|result|score)/i,
  ],
];

/** Classement par mots-clés (repli sans modèle) : la première catégorie reconnue l'emporte. */
export function heuristicCategory(text: string): ComplaintCategory {
  for (const [category, pattern] of KEYWORDS) if (pattern.test(text)) return category;
  return 'OTHER';
}

const ASKS_COMPLAINT =
  /(réclamation|reclamation|plainte|contester|contestation|complaint|dispute|file a claim|ouvrir un dossier|parler à un humain|human|agent|support humain)/i;

/** Analyse de repli : mots-clés et identifiants écrits par le joueur, sans aucun modèle. */
export function heuristicAnalysis(playerText: string, lastMessage: string): AssistantAnalysis {
  const fromLast = heuristicCategory(lastMessage);
  const category = fromLast !== 'OTHER' ? fromLast : heuristicCategory(playerText);
  const ids = [...new Set((playerText.match(UUID) ?? []).map((id) => id.toLowerCase()))];
  const references: ExtractedReferences = {};
  // Un identifiant sans contexte : rattaché à la catégorie (l'outil vérifie l'appartenance).
  if (ids.length > 0) {
    const id = ids[ids.length - 1];
    if (category === 'GAME_RESULT' || category === 'TECHNICAL') references.gameId = id;
    else if (category === 'PAYMENT') references.paymentId = id;
    else if (category === 'WITHDRAWAL') references.withdrawalId = id;
    else if (category === 'TOURNAMENT' || category === 'TOURNAMENT_REWARD')
      references.tournamentId = id;
    else if (category === 'BALANCE') references.transactionId = id;
  }
  const ref = playerText.match(REFERENCE)?.at(-1);
  if (ref) references.complaintReference = ref.toUpperCase();
  return {
    category,
    confidence: 'low',
    references,
    tools: [],
    needsHuman: category === 'FRAUD' || category === 'ACCOUNT_SECURITY',
    playerWantsComplaint: ASKS_COMPLAINT.test(lastMessage),
  };
}

/** Outils pertinents pour une catégorie, complétés par ceux demandés (bornés). */
export function toolsFor(analysis: AssistantAnalysis): AssistantToolName[] {
  const refs = analysis.references;
  const base: AssistantToolName[] = [];
  if (refs.complaintReference) base.push('get_complaint_status');
  switch (analysis.category) {
    case 'GAME_RESULT':
    case 'TECHNICAL':
      base.push(refs.gameId ? 'get_game' : 'list_recent_games');
      break;
    case 'BALANCE':
      base.push('get_wallet_history', refs.gameId ? 'get_game' : 'list_recent_games');
      break;
    case 'PAYMENT':
      base.push('check_payment');
      break;
    case 'WITHDRAWAL':
      base.push('check_withdrawal');
      break;
    case 'TOURNAMENT':
    case 'TOURNAMENT_REWARD':
      base.push('get_tournament_status');
      break;
    case 'FRAUD':
      if (refs.gameId) base.push('get_game');
      break;
    case 'ACCOUNT_SECURITY':
    case 'OTHER':
      break;
  }
  // Minimisation : un outil demandé par le modèle n'est exécuté que s'il sert la catégorie
  // (ex. jamais le solde complet pour une question de tournoi).
  const relevant = RELEVANT_TOOLS[analysis.category];
  const requested = analysis.tools.filter((tool) => relevant.includes(tool));
  return [...new Set([...base, ...requested])].slice(0, MAX_TOOLS_PER_TURN);
}

/** Outils qu'une catégorie justifie (les outils demandés hors de cette liste sont ignorés). */
export const RELEVANT_TOOLS: Readonly<Record<ComplaintCategory, readonly AssistantToolName[]>> = {
  GAME_RESULT: ['get_game', 'list_recent_games', 'get_complaint_status'],
  TECHNICAL: ['get_game', 'list_recent_games', 'get_complaint_status'],
  BALANCE: ['get_wallet_history', 'get_game', 'list_recent_games', 'get_complaint_status'],
  PAYMENT: ['check_payment', 'get_complaint_status'],
  WITHDRAWAL: ['check_withdrawal', 'get_complaint_status'],
  TOURNAMENT: ['get_tournament_status', 'get_complaint_status'],
  TOURNAMENT_REWARD: ['get_tournament_status', 'get_complaint_status'],
  FRAUD: ['get_game', 'list_recent_games', 'get_complaint_status'],
  ACCOUNT_SECURITY: ['get_complaint_status'],
  OTHER: ['get_complaint_status'],
};

/** Catégories qui exigent toujours une décision humaine si un écart est constaté. */
export function requiresHuman(category: ComplaintCategory): boolean {
  return category === 'FRAUD' || category === 'ACCOUNT_SECURITY';
}
