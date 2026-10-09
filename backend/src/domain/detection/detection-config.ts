/**
 * Configuration UNIQUE du système de détection de potentielle collusion (R-36, D-044).
 *
 * Tous les seuils, poids et bornes vivent ici, et nulle part ailleurs (ni contrôleur, ni
 * dépôt, ni frontend). Étape 1 : seules la structure et les bornes du score sont utilisées ;
 * les seuils des catégories sont PRÉPARÉS pour les étapes suivantes, sans aucun calcul.
 *
 * Le score est un SCORE DE RISQUE, jamais une preuve ni une probabilité de triche. Aucune
 * sanction automatique n'en découle.
 */

/**
 * Version de l'algorithme de calcul des SCORES (`SUSPICION_SCORE_V{n}`), enregistrée avec
 * chaque score. V1 (étape 1, jamais activée en production) : somme par type dans UNE partie.
 * V2 (étape 4, D-048) : par sujet, sur ses signaux valides, chaque type compté une fois.
 */
export const DETECTION_ALGORITHM_VERSION = 2;

/** Score maximal (et plafond) d'un sujet. */
export const MAX_SUSPICION_SCORE = 100;

/** Niveaux de risque, du plus faible au plus élevé : `min` inclus. */
export const RISK_LEVELS = [
  { level: 'low', min: 0, label: 'faible' },
  { level: 'moderate', min: 25, label: 'modéré' },
  { level: 'high', min: 50, label: 'élevé' },
  { level: 'very_high', min: 75, label: 'très élevé' },
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number]['level'];

/** Types de signaux autorisés (R-36 §2). Aucun autre signal sans décision explicite. */
export const SIGNAL_TYPES = [
  'PROXIMITY',
  'REPEATED_PROXIMITY',
  'IMPOSSIBLE_TRAVEL',
  'INCOHERENT_LOCATION',
  'FREQUENT_COPLAY',
  'CARD_CHOICE_ANOMALY',
  'CORRELATED_WINS',
  'CONNECTION_PATTERN',
  'SHARED_IP',
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

/** Gravité d'un signal (indicative ; la contribution au score est explicite). */
export const SIGNAL_SEVERITIES = ['low', 'medium', 'high'] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

/**
 * Par type de signal : activé ou non, et contribution MAXIMALE cumulée au score d'un sujet
 * (plafond par type : un même type ne peut pas à lui seul porter le score à 100).
 *
 * `SHARED_IP` est désactivé : aucune IP n'est collectée (décision en attente).
 */
export const SIGNAL_RULES: Readonly<
  Record<SignalType, { enabled: boolean; maxContribution: number }>
> = {
  PROXIMITY: { enabled: true, maxContribution: 35 },
  REPEATED_PROXIMITY: { enabled: true, maxContribution: 25 },
  IMPOSSIBLE_TRAVEL: { enabled: true, maxContribution: 20 },
  INCOHERENT_LOCATION: { enabled: true, maxContribution: 15 },
  FREQUENT_COPLAY: { enabled: true, maxContribution: 20 },
  CARD_CHOICE_ANOMALY: { enabled: true, maxContribution: 30 },
  CORRELATED_WINS: { enabled: true, maxContribution: 25 },
  CONNECTION_PATTERN: { enabled: true, maxContribution: 15 },
  SHARED_IP: { enabled: false, maxContribution: 0 },
};

/**
 * Seuils PRÉPARÉS des catégories (étapes 2 et 3), valeurs initiales proposées : aucun calcul
 * ne les utilise encore à l'étape 1. Ils seront validés avant leur mise en service.
 */
export const DETECTION_THRESHOLDS = {
  proximity: {
    /** Distance entre deux joueurs sous laquelle la proximité est forte / modérée (m). */
    strongMeters: 50,
    moderateMeters: 200,
    /** Durée minimale d'une proximité pour devenir un signal (ms). */
    minDurationMs: 60_000,
    /** Proximité répétée : nombre de parties distinctes sur la fenêtre. */
    repeatedGames: 3,
    repeatedWindowDays: 30,
  },
  travel: {
    /** Vitesse au-delà de laquelle un déplacement est jugé impossible (km/h). */
    impossibleSpeedKmh: 900,
    /** Positions moins précises que cette valeur ignorées (m). */
    maxAccuracyMeters: 100,
  },
  /*
   * Catégories comportementales (étape 3, D-047). PROVISOIRE : aucun seuil métier validé.
   * L'historique ne contient QUE des parties SURVEILLÉES et terminées, sur la fenêtre.
   */
  coplay: {
    /** Fenêtre d'observation des parties communes (jours). */
    windowDays: 30,
    /** Minimum de parties communes, et part des parties de CHACUN jouées avec l'autre. */
    minGamesTogether: 5,
    minShareOfGames: 0.6,
    /** Répétition sur plusieurs tables : une seule longue table ne suffit pas. */
    minSessionsTogether: 2,
  },
  cardBehavior: {
    windowDays: 30,
    /** Minimum d'occasions observées (avec ce contrôleur, et avec les autres) avant tout signal. */
    minOpportunities: 8,
    minBaselineOpportunities: 8,
    /** Taux de « non-prise de contrôle » face à un même contrôleur jugé inhabituel. */
    anomalyRate: 0.7,
    /** Écart minimal avec le taux personnel face aux autres contrôleurs. */
    minRateGap: 0.4,
    /** Plafond de parties relues par joueur (les plus récentes). */
    maxGamesPerPlayer: 100,
  },
  correlatedWins: {
    windowDays: 30,
    /** Parties communes à 3 ou 4 joueurs (à 2, la paire gagne toujours : non informatif). */
    minGamesTogether: 8,
    /** Parties sans l'autre nécessaires pour utiliser le taux personnel (sinon : hasard 1/n). */
    minBaselineGames: 5,
    /** Écart (taux observé de la paire − taux attendu) et écart réduit (z) minimaux. */
    minWinRateGap: 0.25,
    minZScore: 2.5,
  },
  connection: {
    windowDays: 30,
    /** Arrivées ou connexions « synchronisées » : écart maximal (ms). */
    syncWindowMs: 15_000,
    /** Une connexion compte si elle précède l'arrivée à la table de moins de ce délai (ms). */
    loginLookbackMs: 30 * 60 * 1000,
    /** Tables surveillées communes synchronisées, et leur part minimale. */
    minRepetitions: 3,
    minSyncShare: 0.6,
  },
} as const;

/**
 * Calcul du score de suspicion (R-36, étape 4, D-048) : ACTIVÉ. Un score est un indicateur
 * statistique, jamais une preuve ; il ne déclenche aucune sanction ni accusation.
 */
export const SUSPICION_SCORING_ENABLED = true;

/** Score V2 (D-048). PROVISOIRE : valeurs non validées par le métier. */
export const SCORING_CONFIG = {
  /**
   * Un signal compte pour le score pendant cette durée après sa création (jours). Les
   * fenêtres des analyses elles-mêmes (30 j) ne sont pas modifiées.
   */
  signalValidityDays: 30,
} as const;

/** Alertes INTERNES (D-048). PROVISOIRE : aucune règle métier validée. */
export const ALERT_CONFIG = {
  /** Type d'alerte produit par le score (seul type à l'étape 4). */
  type: 'SUSPICION_LEVEL',
  /** Niveaux qui créent une alerte, et sa priorité. LOW et MODERATE : aucune alerte. */
  levels: {
    high: 'NORMAL',
    very_high: 'PRIORITY',
  } as Partial<Record<RiskLevel, 'NORMAL' | 'PRIORITY'>>,
  /** Un seul signal ne crée jamais d'alerte : types de signaux distincts requis. */
  minDistinctSignalTypes: 2,
  /** Période de déduplication : une alerte par sujet, niveau et version par période (jours). */
  dedupWindowDays: 30,
} as const;

/**
 * Couche géographique (R-36, étape 2, D-046). Valeurs PROVISOIRES, NON VALIDÉES : elles
 * restent configurables ici, et nulle part ailleurs.
 */
export const GEOLOCATION_CONFIG = {
  collection: {
    /** Intervalle entre deux positions envoyées par le téléphone (30 à 60 s). */
    intervalMs: 45_000,
    /** Plafond de positions acceptées par joueur et par minute (anti-abus). */
    maxPerMinute: 4,
  },
  storage: {
    /** Décimales conservées (4 ≈ 11 m) : jamais la position brute du téléphone. */
    coordinateDecimals: 4,
  },
  validation: {
    /** Précision annoncée au-delà de laquelle une position est refusée (m). */
    maxAcceptedAccuracyMeters: 1_000,
    /** Âge maximal d'une position reçue, et avance tolérée de l'horloge du téléphone (ms). */
    maxAgeMs: 120_000,
    maxClockAheadMs: 30_000,
  },
  retention: {
    /** Positions supprimées au plus tard 24 h après la fin de la partie. */
    afterGameEndMs: 24 * 60 * 60 * 1000,
    /** Fréquence du nettoyage automatique. */
    purgeIntervalMs: 60 * 60 * 1000,
  },
  display: {
    /** Une distance n'est affichée que si les deux positions ont moins de cet âge (ms). */
    freshnessMs: 150_000,
    /** Arrondi des distances affichées aux joueurs (m). */
    roundingMeters: 10,
  },
  analysis: {
    /** Positions moins précises ignorées par les analyses (m). */
    maxAccuracyMeters: DETECTION_THRESHOLDS.travel.maxAccuracyMeters,
    /** Écart maximal entre deux positions de joueurs différents pour les comparer (ms). */
    pairingWindowMs: 60_000,
    /** Trou maximal entre deux mesures d'un même épisode de proximité (ms). */
    maxEpisodeGapMs: 120_000,
    /** Une seule mesure ne suffit jamais : minimum de mesures proches par épisode. */
    minProximitySamples: 2,
    /** Déplacement minimal (après marge de précision) pour juger une vitesse (m). */
    minTravelMeters: 1_000,
    /** Intervalle minimal pris en compte entre deux positions (ms). */
    minTravelIntervalMs: 1_000,
    /** Aller-retour incohérent : saut minimal, retour maximal, durée maximale. */
    incoherentJumpMeters: 5_000,
    incoherentReturnMeters: 200,
    incoherentWindowMs: 10 * 60 * 1000,
  },
  /** Contribution enregistrée avec chaque signal géographique (aucun score à l'étape 2). */
  contributions: {
    PROXIMITY: { strong: 20, significant: 10 },
    REPEATED_PROXIMITY: 15,
    IMPOSSIBLE_TRAVEL: 15,
    INCOHERENT_LOCATION: 10,
  },
} as const;

/**
 * Version de l'algorithme de CHAQUE type de signal, enregistrée avec le signal
 * (identifiant lisible : `FREQUENT_COPLAY_V1`…). Changer la signification d'un algorithme =
 * nouvelle version, jamais une modification silencieuse de la version existante.
 */
export const SIGNAL_ALGORITHM_VERSIONS: Readonly<Record<SignalType, number>> = {
  PROXIMITY: 1,
  REPEATED_PROXIMITY: 1,
  IMPOSSIBLE_TRAVEL: 1,
  INCOHERENT_LOCATION: 1,
  FREQUENT_COPLAY: 1,
  CARD_CHOICE_ANOMALY: 1,
  CORRELATED_WINS: 1,
  CONNECTION_PATTERN: 1,
  SHARED_IP: 1,
};

export const algorithmIdOf = (type: SignalType, version = SIGNAL_ALGORITHM_VERSIONS[type]) =>
  `${type}_V${version}`;

/** Contribution enregistrée avec chaque signal comportemental (aucun score à l'étape 3). */
export const BEHAVIOR_CONTRIBUTIONS = {
  FREQUENT_COPLAY: 10,
  CARD_CHOICE_ANOMALY: 20,
  CORRELATED_WINS: 15,
  CONNECTION_PATTERN: 10,
} as const;
