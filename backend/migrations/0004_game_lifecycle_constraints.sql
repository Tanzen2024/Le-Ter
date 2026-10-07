-- Cycle de vie des parties (D-031) : R-18 garantie par la base, idempotence de la création.
--
-- R-18 : un joueur n'est membre que d'UNE partie active (waiting ou in_progress) à la
-- fois. `game_players.active` reflète le statut de la partie ; il est écrit par
-- PostgresGameRepository dans la même transaction que la ligne `games` (false quand la
-- partie est finished). L'index unique partiel refuse une seconde participation active,
-- y compris quand deux adhésions à deux parties différentes arrivent en même temps sur
-- deux instances : la seconde attend la première, puis échoue (violation d'unicité).
--
-- Si des données existantes violaient déjà R-18, la création de l'index échoue et toute
-- la migration est annulée : rien n'est modifié en silence.

ALTER TABLE game_players ADD COLUMN active boolean NOT NULL DEFAULT true;

UPDATE game_players p
SET active = (g.status <> 'finished')
FROM games g
WHERE g.id = p.game_id;

-- Plus de valeur par défaut : le dépôt écrit toujours la valeur explicitement.
ALTER TABLE game_players ALTER COLUMN active DROP DEFAULT;

CREATE UNIQUE INDEX game_players_one_active_game_per_player
  ON game_players (player_id) WHERE active;

-- Idempotence de POST /api/games : la clé (en-tête Idempotency-Key) est unique par
-- créateur. Rejouer la même clé renvoie la partie déjà créée au lieu d'en créer une autre.
ALTER TABLE games
  ADD COLUMN creation_key text CHECK (creation_key ~ '^[A-Za-z0-9_.:-]{8,128}$');

CREATE UNIQUE INDEX games_creator_creation_key_idx
  ON games (creator_id, creation_key) WHERE creation_key IS NOT NULL;
