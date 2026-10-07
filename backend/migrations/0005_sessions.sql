-- Sessions multi-parties (D-033).
--
-- Une SESSION est une table de jeu persistante : plusieurs parties (games) s'y
-- succèdent. `session_players` = joueurs présents dans la session ; `game_players` =
-- joueurs d'UNE partie (sous-ensemble des joueurs actifs de la session au moment où ils
-- la rejoignent).
--
-- L'ordre des places (`session_players.seat` croissant) est le sens ANTIHORAIRE du jeu.
-- Chaque joueur d'une partie garde une copie de sa place (`game_players.table_position`) :
-- l'ordre d'une partie reste figé dans l'historique même si la session évolue ensuite.

CREATE TABLE sessions (
  id          uuid        PRIMARY KEY,
  version     integer     NOT NULL CHECK (version >= 1),
  status      text        NOT NULL CHECK (status IN ('open', 'closed')),
  creator_id  uuid        NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  closed_at   timestamptz,
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE TABLE session_players (
  session_id uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  player_id  uuid        NOT NULL REFERENCES users (id),
  -- Place à la table ; jamais réutilisée dans la session (un retour = nouvelle place).
  seat       integer     NOT NULL CHECK (seat >= 0),
  active     boolean     NOT NULL,
  joined_at  timestamptz NOT NULL,
  left_at    timestamptz,
  PRIMARY KEY (session_id, player_id),
  CONSTRAINT session_players_seat_unique UNIQUE (session_id, seat),
  CHECK (active = (left_at IS NULL))
);

-- Sessions où un joueur est présent (écran d'accueil).
CREATE INDEX session_players_active_player_idx ON session_players (player_id) WHERE active;

-- --- Parties : rattachement à une session, premier joueur, gagnant ----------------------

ALTER TABLE games
  ADD COLUMN session_id      uuid REFERENCES sessions (id),
  ADD COLUMN first_player_id uuid REFERENCES users (id),
  ADD COLUMN winner_id       uuid REFERENCES users (id);

ALTER TABLE game_players ADD COLUMN table_position integer CHECK (table_position >= 0);

-- Parties existantes (avant D-033) : une session par partie, de même identifiant, fermée
-- si la partie est terminée. Rien n'est supprimé.
INSERT INTO sessions (id, version, status, creator_id, created_at, updated_at, closed_at)
SELECT g.id, 1,
       CASE WHEN g.status = 'finished' THEN 'closed' ELSE 'open' END,
       g.creator_id, g.created_at, g.updated_at,
       CASE WHEN g.status = 'finished' THEN COALESCE(g.finished_at, g.updated_at) END
FROM games g;

INSERT INTO session_players (session_id, player_id, seat, active, joined_at, left_at)
SELECT p.game_id, p.player_id, p.seat, g.status <> 'finished', p.joined_at,
       CASE WHEN g.status = 'finished' THEN COALESCE(g.finished_at, g.updated_at) END
FROM game_players p JOIN games g ON g.id = p.game_id;

UPDATE games
SET session_id = id,
    first_player_id = COALESCE((state -> 'play' -> 'dealOrder' ->> 0)::uuid, creator_id),
    winner_id = (state -> 'result' ->> 'winnerId')::uuid;

UPDATE game_players SET table_position = seat;

ALTER TABLE games ALTER COLUMN session_id SET NOT NULL;
ALTER TABLE games ALTER COLUMN first_player_id SET NOT NULL;
ALTER TABLE game_players ALTER COLUMN table_position SET NOT NULL;

-- Parties SUCCESSIVES : au plus une partie active (waiting ou in_progress) par session,
-- garanti par la base même en cas de créations concurrentes.
CREATE UNIQUE INDEX games_one_active_per_session
  ON games (session_id) WHERE status <> 'finished';

-- Historique d'une session, et « dernière partie terminée » (choix de J1).
CREATE INDEX games_session_created_idx ON games (session_id, created_at);
CREATE INDEX games_session_finished_idx ON games (session_id, finished_at DESC)
  WHERE status = 'finished';
