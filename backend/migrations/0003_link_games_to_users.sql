-- Les identités de joueur deviennent des comptes (D-029) : `creator_id` et
-- `player_id` passent de text à uuid et référencent `users(id)`, comme annoncé
-- par 0001_create_games.sql et D-025.
--
-- La conversion échoue (et toute la migration est annulée) si une ligne contient
-- un identifiant qui n'est pas un UUID d'utilisateur existant : aucune donnée n'est
-- supprimée ou modifiée en silence.
--
-- ON DELETE RESTRICT (par défaut) : un compte ayant un historique de parties ne
-- peut pas être supprimé physiquement ; il est désactivé (`users.status`).

ALTER TABLE games
  ALTER COLUMN creator_id TYPE uuid USING creator_id::uuid,
  ADD CONSTRAINT games_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users (id);

ALTER TABLE game_players
  ALTER COLUMN player_id TYPE uuid USING player_id::uuid,
  ADD CONSTRAINT game_players_player_id_fkey FOREIGN KEY (player_id) REFERENCES users (id);
