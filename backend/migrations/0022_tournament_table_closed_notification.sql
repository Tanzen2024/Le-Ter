-- Fin d'un tournoi (D-056) : plus aucune nouvelle partie aux tables du tournoi ; les joueurs
-- encore assis en sont informés. Ajout d'un type de notification, rien d'autre.

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'TOURNAMENT_APPROVED', 'TOURNAMENT_REGISTRATION_CONFIRMED', 'TOURNAMENT_CANCELLED',
  'TOURNAMENT_STARTED', 'TOURNAMENT_RESULTS_AVAILABLE', 'TOURNAMENT_PRIZE_CREDITED',
  'TOURNAMENT_TABLE_CLOSED'));
