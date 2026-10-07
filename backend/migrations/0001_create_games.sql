-- Parties (D-022, D-023). Une ligne par partie dans `games`, un siège par ligne
-- dans `game_players`. L'état de jeu propre à la partie (paquet, mains, plis,
-- contrôle, résultat, idempotence) est un instantané JSONB : il est toujours lu
-- et écrit d'un bloc, sous le contrôle de version de la ligne `games`.
--
-- `player_id` est un texte tant que la table `users` n'existe pas ; il deviendra
-- une clé étrangère vers `users(id)` avec la migration des comptes.

CREATE TABLE games (
  id               uuid        PRIMARY KEY,
  version          integer     NOT NULL CHECK (version >= 1),
  status           text        NOT NULL CHECK (status IN ('waiting', 'in_progress', 'finished')),
  creator_id       text        NOT NULL,
  max_players      smallint    NOT NULL CHECK (max_players BETWEEN 2 AND 4),
  -- Unité (FCFA ou jetons) à définir : R-13.
  stake_amount     bigint      CHECK (stake_amount >= 0),
  -- { play?, result?, recentCommandIds } : voir PostgresGameRepository.
  state            jsonb       NOT NULL,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  started_at       timestamptz,
  finished_at      timestamptz,
  turn_deadline_at timestamptz
);

CREATE TABLE game_players (
  game_id   uuid        NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  player_id text        NOT NULL,
  seat      smallint    NOT NULL CHECK (seat BETWEEN 0 AND 3),
  joined_at timestamptz NOT NULL,
  fled_at   timestamptz,
  PRIMARY KEY (game_id, player_id),
  CONSTRAINT game_players_seat_unique UNIQUE (game_id, seat) DEFERRABLE INITIALLY DEFERRED
);

-- Lobby : parties ouvertes, les plus récentes d'abord.
CREATE INDEX games_status_created_at_idx ON games (status, created_at DESC);

-- Reconnexion : parties d'un joueur.
CREATE INDEX game_players_player_id_idx ON game_players (player_id);

-- Réarmement des timers au redémarrage.
CREATE INDEX games_turn_deadline_at_idx ON games (turn_deadline_at)
  WHERE status = 'in_progress' AND turn_deadline_at IS NOT NULL;
