-- Positions GPS de la détection de potentielle collusion (R-36, étape 2, D-046).
--
-- Une position appartient à UN joueur de UNE partie (clé étrangère vers `game_players`) :
-- aucune position d'un joueur étranger à la partie. Précision LIMITÉE par le type même
-- (4 décimales ≈ 11 m, `GEOLOCATION_CONFIG.storage`) : la position brute du téléphone n'est
-- jamais stockée. Aucune ligne pour une partie dont la table n'a pas activé la détection
-- (`sessions.suspicion_detection_enabled`, D-043). Conservation : 24 h au plus après la fin
-- de la partie (nettoyage par le serveur), et suppression avec la partie ou le joueur.

CREATE TABLE detection_positions (
  id          uuid         PRIMARY KEY,
  game_id     uuid         NOT NULL,
  player_id   uuid         NOT NULL,
  latitude    numeric(6, 4) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   numeric(7, 4) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m  real         NOT NULL CHECK (accuracy_m > 0),
  captured_at timestamptz  NOT NULL,
  received_at timestamptz  NOT NULL,
  FOREIGN KEY (game_id, player_id) REFERENCES game_players (game_id, player_id) ON DELETE CASCADE
);

CREATE INDEX detection_positions_game_player_idx
  ON detection_positions (game_id, player_id, captured_at DESC);

CREATE INDEX detection_positions_captured_at_idx ON detection_positions (captured_at);

CREATE FUNCTION detection_positions_guard() RETURNS trigger AS $$
DECLARE
  enabled boolean;
BEGIN
  SELECT s.suspicion_detection_enabled INTO enabled
  FROM games g JOIN sessions s ON s.id = g.session_id
  WHERE g.id = NEW.game_id;
  IF enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'détection désactivée pour la partie %', NEW.game_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'detection_enabled_for_game';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER detection_positions_guard
  BEFORE INSERT OR UPDATE ON detection_positions
  FOR EACH ROW EXECUTE FUNCTION detection_positions_guard();
