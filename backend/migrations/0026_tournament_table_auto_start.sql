-- Démarrage des tables de tournoi (D-065) : délai de démarrage manuel, puis démarrage
-- automatique par le serveur.
--
-- `auto_start_delay_ms` : délai de démarrage de la partie, fixé à sa création (tables de
--   tournoi : 20 000 ms). NULL pour toutes les autres parties (parties privées : inchangées,
--   seul le créateur démarre, sans échéance).
-- `start_deadline_at` : échéance PERSISTÉE du démarrage automatique, posée quand la partie en
--   attente atteint 2 joueurs, jamais repoussée par les arrivées suivantes, retirée si elle
--   redescend sous 2 joueurs et au démarrage. Reconstruite par DeadlineSupervisor après un
--   redémarrage, comme l'échéance de tour (D-034).
--
-- Ajout seulement : aucune donnée existante n'est modifiée (les deux colonnes restent NULL).

ALTER TABLE games
  ADD COLUMN auto_start_delay_ms integer CHECK (auto_start_delay_ms > 0),
  ADD COLUMN start_deadline_at timestamptz;

-- Une échéance seulement sur une partie EN ATTENTE dotée d'un délai de démarrage.
ALTER TABLE games ADD CONSTRAINT games_start_deadline_when_waiting
  CHECK (start_deadline_at IS NULL OR (status = 'waiting' AND auto_start_delay_ms IS NOT NULL));

CREATE INDEX games_start_deadline_at_idx ON games (start_deadline_at)
  WHERE status = 'waiting' AND start_deadline_at IS NOT NULL;
