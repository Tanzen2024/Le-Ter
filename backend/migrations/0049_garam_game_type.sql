-- GARAM TIA, deuxième jeu de la plateforme (D-119).
--
-- 1. Type de jeu, porté par la SESSION (une partie GARAM = une session) et recopié sur chaque
--    partie (manche) : 'TER' (Le Ter) ou 'GARAM'. Tout ce qui existe déjà est du Ter : la
--    valeur par défaut le reconnaît exactement comme avant, rien n'est réécrit ni supprimé.
-- 2. Nouvelles raisons de fin : victoire automatique ou meilleur total, manche nulle.
-- 3. La manche qui rejoue une égalité attend la réponse à la proposition de doubler la mise
--    (§3.15) avec une échéance de démarrage persistée, sans être une table de tournoi.
-- 4. Règle « moins de 15 » (§1.5) : sommes supplémentaires versées au gagnant SANS commission,
--    enregistrées à part dans le règlement.

ALTER TABLE sessions
  ADD COLUMN game_type text NOT NULL DEFAULT 'TER' CHECK (game_type IN ('TER', 'GARAM'));

ALTER TABLE games
  ADD COLUMN game_type text NOT NULL DEFAULT 'TER' CHECK (game_type IN ('TER', 'GARAM'));

-- Une partie a toujours le jeu de sa session (vérifié à l'écriture, jamais modifié ensuite).
CREATE FUNCTION games_game_type_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.game_type IS DISTINCT FROM OLD.game_type THEN
    RAISE EXCEPTION 'games.game_type est immuable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.session_id IS NOT NULL AND NEW.game_type IS DISTINCT FROM
      (SELECT s.game_type FROM sessions s WHERE s.id = NEW.session_id) THEN
    RAISE EXCEPTION 'games.game_type différent de celui de la session'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER games_game_type_guard
  BEFORE INSERT OR UPDATE OF game_type, session_id ON games
  FOR EACH ROW EXECUTE FUNCTION games_game_type_guard();

CREATE FUNCTION sessions_game_type_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.game_type IS DISTINCT FROM OLD.game_type THEN
    RAISE EXCEPTION 'sessions.game_type est immuable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_game_type_guard
  BEFORE UPDATE OF game_type ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_game_type_guard();

-- Liste « Rechercher une partie » filtrée par jeu.
CREATE INDEX sessions_open_game_type_idx ON sessions (game_type) WHERE status = 'open';

-- --- Raisons de fin --------------------------------------------------------------------

ALTER TABLE games DROP CONSTRAINT games_end_reason_check;
ALTER TABLE games ADD CONSTRAINT games_end_reason_check CHECK (
  end_reason IN (
    'INSTANT_WIN', 'CONTROL_AFTER_LAST_TRICK', 'OPPONENT_FLED', 'INSTANT_WIN_TIE', 'ADMIN_STOP',
    'GARAM_AUTOMATIC_WIN', 'GARAM_BEST_SCORE', 'GARAM_TIE'
  )
);

ALTER TABLE games DROP CONSTRAINT games_winner_iff_victory;
ALTER TABLE games ADD CONSTRAINT games_winner_iff_victory
  CHECK (
    CASE WHEN end_reason IS NULL THEN winner_id IS NULL
         ELSE (end_reason IN ('INSTANT_WIN', 'CONTROL_AFTER_LAST_TRICK', 'OPPONENT_FLED',
                              'GARAM_AUTOMATIC_WIN', 'GARAM_BEST_SCORE'))
              = (winner_id IS NOT NULL)
    END
  );

-- --- Échéance de la proposition de doubler la mise (§3.15) ------------------------------

ALTER TABLE games DROP CONSTRAINT games_start_deadline_when_waiting;
ALTER TABLE games ADD CONSTRAINT games_start_deadline_when_waiting
  CHECK (start_deadline_at IS NULL OR (
    status = 'waiting' AND (auto_start_delay_ms IS NOT NULL OR game_type = 'GARAM')));

-- --- Règlement : sommes « moins de 15 » (§1.5, §6.5) -----------------------------------

ALTER TABLE game_settlements
  ADD COLUMN penalty_amount bigint NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0);

-- Brut = mises des perdants ; la commission n'est prise que sur le brut ; le gagnant reçoit
-- brut − commission + sommes « moins de 15 ». Lignes existantes : pénalité 0, inchangées.
ALTER TABLE game_settlements DROP CONSTRAINT game_settlements_settled_amounts_check;
ALTER TABLE game_settlements ADD CONSTRAINT game_settlements_settled_amounts_check CHECK (
  status <> 'SETTLED' OR (
    outcome IN ('SIMPLE', 'KORA') AND winner_id IS NOT NULL AND participants >= 2
    AND gross_amount + penalty_amount = commission_amount + net_gain
    AND (
      (applied_commission_bps IS NULL AND gross_amount = unit_amount * participants
       AND penalty_amount = 0)
      OR (applied_commission_bps IS NOT NULL
          AND gross_amount = unit_amount * (participants - 1)))));
