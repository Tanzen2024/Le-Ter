import type { TournamentSettings } from '@/types/admin';

/**
 * Règles de création d'un tournoi réglées dans les Paramètres des tournois (D-103, D-104,
 * D-105), en clair : « durée de 45 à 120 minutes, au moins 20 participants, prix d'entrée d'au
 * moins 500 FCFA ». Le serveur les applique ; ce texte ne fait que les afficher. Paramètres pas
 * encore lus : renvoi aux Paramètres.
 */
export function creationRulesText(settings: TournamentSettings | undefined): string {
  if (!settings) {
    return 'durée, nombre de participants et prix d’entrée minimal selon les Paramètres des tournois';
  }
  const {
    tournamentMinimumDurationMinutes: minMinutes,
    tournamentMaximumDurationMinutes: maxMinutes,
    tournamentMinimumPlayers: minPlayers,
    tournamentMaximumPlayers: maxPlayers,
    tournamentMinimumEntryFee: minFee,
  } = settings;
  const players =
    maxPlayers === null
      ? `au moins ${minPlayers} participants`
      : `${minPlayers} à ${maxPlayers} participants`;
  return `durée de ${minMinutes} à ${maxMinutes} minutes, ${players}, prix d’entrée d’au moins ${minFee} FCFA`;
}
