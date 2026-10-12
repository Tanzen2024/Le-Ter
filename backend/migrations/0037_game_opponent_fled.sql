-- Fuite dans une partie à 2 (R-30, D-086) : celui qui se couche perd, le joueur restant gagne
-- aussitôt (victoire SIMPLE). Nouvelle raison de fin `OPPONENT_FLED`, avec gagnant.
--
-- Seules les contraintes CHECK de `games` sont élargies : aucune donnée existante n'est lue,
-- modifiée ni supprimée (aucune partie n'a pu se terminer ainsi : la fuite à 2 était refusée).

ALTER TABLE games DROP CONSTRAINT games_end_reason_check;
ALTER TABLE games ADD CONSTRAINT games_end_reason_check CHECK (
  end_reason IN (
    'INSTANT_WIN', 'CONTROL_AFTER_LAST_TRICK', 'OPPONENT_FLED', 'INSTANT_WIN_TIE', 'ADMIN_STOP'
  )
);

ALTER TABLE games DROP CONSTRAINT games_winner_iff_victory;
ALTER TABLE games ADD CONSTRAINT games_winner_iff_victory
  CHECK (
    CASE WHEN end_reason IS NULL THEN winner_id IS NULL
         ELSE (end_reason IN ('INSTANT_WIN', 'CONTROL_AFTER_LAST_TRICK', 'OPPONENT_FLED'))
              = (winner_id IS NOT NULL)
    END
  );
