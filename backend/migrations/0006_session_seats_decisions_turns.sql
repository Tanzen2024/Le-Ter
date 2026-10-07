-- Sessions : capacité, sièges fixes, décision Poursuivre/Quitter, timer de tour (D-034).
--
-- 1. `sessions.max_players` : 2, 3 ou 4, choisi à la création, IMMUABLE (trigger).
-- 2. Sièges FIXES 0..max_players-1. Un siège quitté devient VACANT et sera réutilisé :
--    l'unicité ne porte plus que sur les joueurs PRÉSENTS. Une ligne d'un joueur parti
--    garde le dernier siège occupé (historique).
-- 3. Un joueur n'est présent que dans UNE session à la fois (index unique partiel).
-- 4. Après chaque partie, une « ronde de décision » (10 s) : chaque joueur présent choisit
--    Poursuivre ou Quitter ; sans réponse à l'échéance, il quitte automatiquement.
-- 5. Timer de tour (10 s) : début, échéance et joueur attendu persistés, pour reconstruire
--    les timers après un redémarrage.

-- --- 1. Capacité de la session ---------------------------------------------------------

ALTER TABLE sessions ADD COLUMN max_players smallint;

-- Sessions existantes : la capacité de leurs parties (identique pour toutes en pratique).
UPDATE sessions s
SET max_players = COALESCE((SELECT max(g.max_players) FROM games g WHERE g.session_id = s.id), 4);

ALTER TABLE sessions ALTER COLUMN max_players SET NOT NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_max_players_allowed CHECK (max_players IN (2, 3, 4));

CREATE FUNCTION sessions_max_players_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.max_players <> OLD.max_players THEN
    RAISE EXCEPTION 'sessions.max_players est immuable (session %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_max_players_immutable
  BEFORE UPDATE OF max_players ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_max_players_immutable();

-- --- 2. Sièges fixes, réutilisables ------------------------------------------------------

ALTER TABLE session_players DROP CONSTRAINT session_players_seat_unique;
CREATE UNIQUE INDEX session_players_active_seat_unique
  ON session_players (session_id, seat) WHERE active;

-- Un joueur présent occupe un siège existant de la table : 0 <= seat < max_players. Avec
-- l'unicité ci-dessus, la base garantit qu'une session n'a jamais plus de max_players
-- joueurs présents, même si deux arrivées concurrentes visent la dernière place.
CREATE FUNCTION session_players_seat_in_table() RETURNS trigger AS $$
DECLARE
  capacity smallint;
BEGIN
  IF NEW.active AND (TG_OP = 'INSERT' OR NOT OLD.active OR NEW.seat <> OLD.seat) THEN
    SELECT max_players INTO capacity FROM sessions WHERE id = NEW.session_id;
    IF NEW.seat >= capacity THEN
      RAISE EXCEPTION 'siège % hors de la table (session %, % places)',
        NEW.seat, NEW.session_id, capacity
        USING ERRCODE = 'check_violation', CONSTRAINT = 'session_players_seat_in_table';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER session_players_seat_in_table
  BEFORE INSERT OR UPDATE ON session_players
  FOR EACH ROW EXECUTE FUNCTION session_players_seat_in_table();

-- --- 3. Une seule session active par joueur ---------------------------------------------

-- Données antérieures : un joueur présent dans plusieurs sessions ouvertes ne reste que
-- dans la plus récente ; une session ainsi vidée est fermée. Rien n'est supprimé.
WITH ranked AS (
  SELECT sp.session_id, sp.player_id,
         row_number() OVER (PARTITION BY sp.player_id ORDER BY s.created_at DESC, s.id DESC) AS rn
  FROM session_players sp JOIN sessions s ON s.id = sp.session_id
  WHERE sp.active
)
UPDATE session_players sp
SET active = false, left_at = now()
FROM ranked r
WHERE r.session_id = sp.session_id AND r.player_id = sp.player_id AND r.rn > 1;

UPDATE sessions s
SET status = 'closed', closed_at = now(), updated_at = now(), version = version + 1
WHERE s.status = 'open'
  AND NOT EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = s.id AND sp.active);

CREATE UNIQUE INDEX session_players_one_active_session_per_player
  ON session_players (player_id) WHERE active;

-- --- 4. Décision Poursuivre / Quitter entre deux parties ---------------------------------

-- Une ronde par partie terminée d'une session. Ouverte quand la partie se termine,
-- résolue quand tous les joueurs présents ont décidé ou à l'échéance (auto-départ).
CREATE TABLE session_decision_rounds (
  game_id     uuid        PRIMARY KEY REFERENCES games (id),
  session_id  uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  opened_at   timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK (deadline_at > opened_at)
);

-- Au plus une ronde non résolue par session.
CREATE UNIQUE INDEX session_decision_rounds_one_open_per_session
  ON session_decision_rounds (session_id) WHERE resolved_at IS NULL;

-- Réarmement des timers de décision au redémarrage.
CREATE INDEX session_decision_rounds_open_deadline_idx
  ON session_decision_rounds (deadline_at) WHERE resolved_at IS NULL;

CREATE TABLE session_decisions (
  game_id    uuid        NOT NULL REFERENCES session_decision_rounds (game_id) ON DELETE CASCADE,
  player_id  uuid        NOT NULL REFERENCES users (id),
  -- continue = Poursuivre ; leave = Quitter ; auto_leave = sans réponse à l'échéance.
  choice     text        NOT NULL CHECK (choice IN ('continue', 'leave', 'auto_leave')),
  decided_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

-- --- 5. Timer de tour ---------------------------------------------------------------------

ALTER TABLE games
  ADD COLUMN turn_started_at      timestamptz,
  ADD COLUMN active_player_id     uuid REFERENCES users (id),
  -- Échéance dépassée et constatée par le serveur (TURN_TIMEOUT) : le coup automatique
  -- reste à jouer. Remis à NULL dès que le tour change.
  ADD COLUMN turn_timed_out_at    timestamptz;

ALTER TABLE games ADD CONSTRAINT games_turn_consistency CHECK (
  (turn_deadline_at IS NULL OR turn_started_at IS NOT NULL)
  AND (turn_deadline_at IS NULL OR turn_deadline_at > turn_started_at)
);

-- Tours dont le coup automatique est en attente (reprise après redémarrage).
CREATE INDEX games_turn_timed_out_idx ON games (turn_timed_out_at)
  WHERE status = 'in_progress' AND turn_timed_out_at IS NOT NULL;
