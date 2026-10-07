-- Fin de partie et reprise immédiate après égalité de priorité (D-035).
--
-- `end_reason` : pourquoi une partie terminée s'est terminée.
--   INSTANT_WIN               victoire instantanée (déclarée ou automatique), avec gagnant
--   CONTROL_AFTER_LAST_TRICK  contrôle détenu à la fin du 5e tour, avec gagnant
--   INSTANT_WIN_TIE           plusieurs mains gagnantes au même meilleur rang : aucun
--                             gagnant, partie rejouée immédiatement (nouvelle partie)
--   ADMIN_STOP                arrêt administratif, sans résultat de jeu
--
-- `replay_of_game_id` : la partie annulée qu'une partie rejoue. Unique : une partie
-- annulée n'est rejouée qu'UNE fois, même si plusieurs instances traitent l'égalité.

ALTER TABLE games
  ADD COLUMN end_reason text CHECK (
    end_reason IN ('INSTANT_WIN', 'CONTROL_AFTER_LAST_TRICK', 'INSTANT_WIN_TIE', 'ADMIN_STOP')
  ),
  ADD COLUMN replay_of_game_id uuid REFERENCES games (id);

-- Parties terminées existantes : la méthode du résultat, sinon un arrêt administratif.
UPDATE games
SET end_reason = COALESCE(state -> 'result' ->> 'method', 'ADMIN_STOP')
WHERE status = 'finished';

-- Une raison exactement quand la partie est terminée ; un gagnant exactement pour une
-- victoire.
ALTER TABLE games ADD CONSTRAINT games_end_reason_when_finished
  CHECK ((status = 'finished') = (end_reason IS NOT NULL));
ALTER TABLE games ADD CONSTRAINT games_winner_iff_victory
  CHECK (
    CASE WHEN end_reason IS NULL THEN winner_id IS NULL
         ELSE (end_reason IN ('INSTANT_WIN', 'CONTROL_AFTER_LAST_TRICK')) = (winner_id IS NOT NULL)
    END
  );

CREATE UNIQUE INDEX games_one_replay_per_game
  ON games (replay_of_game_id) WHERE replay_of_game_id IS NOT NULL;
