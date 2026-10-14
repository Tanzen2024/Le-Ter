-- Phase de distribution (D-102) : le premier tour ne commence qu'après la confirmation
-- serveur de la distribution (COMPLETE_DEAL). `deal_ends_at` est l'échéance PERSISTÉE de la
-- phase de distribution d'une partie en cours ; tant qu'elle est posée, aucune échéance de
-- tour n'existe (aucun temps de décision ne court). Reconstruite au démarrage par
-- DeadlineSupervisor, comme les échéances de tour et de démarrage.
--
-- Ajout de colonne seulement : aucune donnée existante n'est lue, modifiée ni supprimée
-- (les parties déjà en cours gardent leur échéance de tour, `deal_ends_at` reste NULL).

ALTER TABLE games ADD COLUMN deal_ends_at timestamptz;

ALTER TABLE games ADD CONSTRAINT games_deal_phase_without_turn
  CHECK (deal_ends_at IS NULL OR (status = 'in_progress' AND turn_deadline_at IS NULL));

CREATE INDEX games_deal_ends_at_idx ON games (deal_ends_at)
  WHERE status = 'in_progress' AND deal_ends_at IS NOT NULL;
