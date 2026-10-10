-- Jetons de départ et mise par partie calculés depuis des COEFFICIENTS du prix d'entrée (D-071).
--
-- Jetons de départ = prix d'entrée × `tournament_initial_tokens_coefficient` ;
-- mise par partie  = prix d'entrée × `tournament_stake_per_game_coefficient` ;
-- en entiers, arrondis à l'entier inférieur, calculés par le serveur seul.
--
-- Nouvelles clés seulement : aucune ligne n'est insérée. Tant qu'une clé n'a jamais été
-- enregistrée, le serveur applique la valeur initiale du code (coefficients 10 et 0,5 ;
-- commission 15 % et poids 60 % / 40 % pour les clés elles aussi jamais enregistrées). Un
-- réglage déjà enregistré par l'administration n'est jamais modifié.
--
-- Anciennes clés `initial_tournament_tokens` et `default_tournament_stake` : des NOMBRES FIXES
-- de jetons, sans lien avec le prix d'entrée. Les convertir en coefficients serait ambigu
-- (1000 jetons fixes ≠ coefficient 1000) : elles ne sont pas converties, plus lues, et restent
-- autorisées pour conserver les lignes existantes.
--
-- Tournois : aucun n'est modifié. Les publiés gardent les valeurs figées à leur publication ;
-- les non publiés (DRAFT, PENDING_APPROVAL) suivent les coefficients et sont recalculés à
-- l'approbation. Les colonnes `initial_tokens_customized` / `stake_customized` (0027, D-069)
-- ne sont plus utilisées ; conservées pour l'historique.

ALTER TABLE system_settings DROP CONSTRAINT system_settings_key_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_check CHECK (key IN (
  'detection_enabled', 'tournament_platform_fee_percent', 'initial_tournament_tokens',
  'default_tournament_stake', 'maximum_pending_tournaments_per_player',
  'tournament_transition_minutes', 'tournament_ranking_tokens_weight_percent',
  'tournament_ranking_games_weight_percent', 'tournament_initial_tokens_coefficient',
  'tournament_stake_per_game_coefficient'));
