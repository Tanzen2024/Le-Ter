/**
 * Présentation de la distribution COMMUNE aux jeux de la plateforme (D-102, D-126) : temps
 * techniques de l'animation des téléphones, sans aucune règle de jeu. Utilisés par le moteur
 * de Fap-Fap (`rules/rule-set.ts`, qui les réexporte) et par celui de GARAM TIA, sans que l'un
 * dépende de l'autre.
 *
 * Calqué sur le calendrier des téléphones : premier lot à 250 ms, un lot toutes les 420 ms
 * (Fap-Fap), vol + pose 510 ms, plus une marge de réception réseau.
 */
export const DEAL_FIRST_BATCH_DELAY_MS = 250;
export const DEAL_BATCH_STEP_MS = 420;
export const DEAL_BATCH_LANDING_MS = 510;
export const DEAL_DELIVERY_MARGIN_MS = 500;
