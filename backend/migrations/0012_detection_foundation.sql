-- Socle du système de détection de potentielle collusion (R-36, étape 1, D-044).
--
-- Deux structures, toutes deux rattachées EXPLICITEMENT à une partie (`game_id`, unité
-- d'isolation) : les signaux (traçables) et les scores de risque par sujet (joueur ou groupe).
-- Aucune donnée GPS, aucune IP, aucune alerte, aucune table d'administration à cette étape.
--
-- Garanties en base (en plus du service) :
--   - aucune ligne pour une partie dont la table n'a pas activé la détection
--     (`sessions.suspicion_detection_enabled`, D-043) ;
--   - les joueurs cités sont des joueurs de CETTE partie (jamais d'écriture croisée) ;
--   - les lignes disparaissent avec leur partie.

CREATE TABLE detection_signals (
  id                uuid        PRIMARY KEY,
  game_id           uuid        NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  type              text        NOT NULL CHECK (type IN (
                      'PROXIMITY', 'REPEATED_PROXIMITY', 'IMPOSSIBLE_TRAVEL',
                      'INCOHERENT_LOCATION', 'FREQUENT_COPLAY', 'CARD_CHOICE_ANOMALY',
                      'CORRELATED_WINS', 'CONNECTION_PATTERN', 'SHARED_IP')),
  severity          text        NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  contribution      numeric(5, 2) NOT NULL CHECK (contribution >= 0 AND contribution <= 100),
  player_ids        uuid[]      NOT NULL CHECK (cardinality(player_ids) >= 1),
  evidence          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  algorithm_version integer     NOT NULL CHECK (algorithm_version >= 1),
  created_at        timestamptz NOT NULL
);

CREATE INDEX detection_signals_game_idx ON detection_signals (game_id, created_at);

CREATE TABLE detection_scores (
  game_id           uuid        NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  -- Sujet : identifiants triés joints par « | » (joueur seul ou groupe).
  subject_key       text        NOT NULL,
  player_ids        uuid[]      NOT NULL CHECK (cardinality(player_ids) >= 1),
  score             smallint    NOT NULL CHECK (score BETWEEN 0 AND 100),
  level             text        NOT NULL CHECK (level IN ('low', 'moderate', 'high', 'very_high')),
  algorithm_version integer     NOT NULL CHECK (algorithm_version >= 1),
  computed_at       timestamptz NOT NULL,
  PRIMARY KEY (game_id, subject_key)
);

-- Une seule fonction de garde pour les deux tables.
CREATE FUNCTION detection_rows_guard() RETURNS trigger AS $$
DECLARE
  enabled boolean;
  outsiders integer;
BEGIN
  SELECT s.suspicion_detection_enabled INTO enabled
  FROM games g JOIN sessions s ON s.id = g.session_id
  WHERE g.id = NEW.game_id;
  IF enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'détection désactivée pour la partie %', NEW.game_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'detection_enabled_for_game';
  END IF;

  SELECT count(*) INTO outsiders
  FROM unnest(NEW.player_ids) AS p(player_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM game_players gp WHERE gp.game_id = NEW.game_id AND gp.player_id = p.player_id
  );
  IF outsiders > 0 THEN
    RAISE EXCEPTION 'joueur hors de la partie %', NEW.game_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'detection_players_in_game';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER detection_signals_guard
  BEFORE INSERT OR UPDATE ON detection_signals
  FOR EACH ROW EXECUTE FUNCTION detection_rows_guard();

CREATE TRIGGER detection_scores_guard
  BEFORE INSERT OR UPDATE ON detection_scores
  FOR EACH ROW EXECUTE FUNCTION detection_rows_guard();
