-- Score de suspicion et alertes INTERNES (R-36, étape 4, D-048).
--
-- Un score est un indicateur statistique, jamais une preuve ; une alerte signifie seulement
-- « plusieurs signaux justifient une analyse ». Aucune sanction, aucune notification.
--
-- 1. Clé de sujet calculée par la base sur les signaux (joueurs triés, sans doublon, joints
--    par « | », ordre binaire comme `subjectKeyOf`) : lecture groupée et indexée des
--    signaux d'un sujet, toutes parties surveillées confondues.
-- 2. Historique : `detection_scores` garde UN instantané par (partie analysée, sujet), avec
--    le score précédent, les signaux retenus et la portée ; rien n'est supprimé.
-- 3. Alertes : uniques par clé de déduplication ; mêmes gardes que signaux et scores
--    (partie surveillée, joueurs de la partie).

CREATE FUNCTION detection_subject_key(ids uuid[]) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT string_agg(t.id, '|' ORDER BY t.id)
  FROM (SELECT DISTINCT u.id::text COLLATE "C" AS id FROM unnest(ids) AS u(id)) AS t
$$;

ALTER TABLE detection_signals
  ADD COLUMN subject_key text GENERATED ALWAYS AS (detection_subject_key(player_ids)) STORED;

CREATE INDEX detection_signals_subject_idx ON detection_signals (subject_key, created_at DESC);

ALTER TABLE detection_scores
  ADD COLUMN scope text GENERATED ALWAYS AS (
    CASE cardinality(player_ids) WHEN 1 THEN 'PLAYER' WHEN 2 THEN 'PAIR' ELSE 'GROUP' END
  ) STORED,
  ADD COLUMN previous_score smallint CHECK (previous_score BETWEEN 0 AND 100),
  ADD COLUMN signal_count integer NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  -- Signaux retenus : type, contribution, identifiant du signal, partie source. Rien d'autre.
  ADD COLUMN components jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN signals_since timestamptz;

CREATE INDEX detection_scores_subject_idx ON detection_scores (subject_key, computed_at DESC);

CREATE TABLE detection_alerts (
  id                      uuid        PRIMARY KEY,
  game_id                 uuid        NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  type                    text        NOT NULL CHECK (type IN ('SUSPICION_LEVEL')),
  subject_key             text        NOT NULL,
  player_ids              uuid[]      NOT NULL CHECK (cardinality(player_ids) >= 1),
  scope                   text        GENERATED ALWAYS AS (
                            CASE cardinality(player_ids) WHEN 1 THEN 'PLAYER'
                                 WHEN 2 THEN 'PAIR' ELSE 'GROUP' END
                          ) STORED,
  level                   text        NOT NULL CHECK (level IN ('high', 'very_high')),
  priority                text        NOT NULL CHECK (priority IN ('NORMAL', 'PRIORITY')),
  score                   smallint    NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_algorithm_version integer     NOT NULL CHECK (score_algorithm_version >= 1),
  signal_types            text[]      NOT NULL,
  period_start            timestamptz NOT NULL,
  dedupe_key              text        NOT NULL UNIQUE,
  -- Statut INTERNE à l'administration (étape 5) ; jamais exposé aux joueurs.
  status                  text        NOT NULL DEFAULT 'NEW'
                            CHECK (status IN ('NEW', 'REVIEWED', 'DISMISSED', 'RESOLVED')),
  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL
);

CREATE INDEX detection_alerts_status_idx ON detection_alerts (status, priority, created_at DESC);
CREATE INDEX detection_alerts_subject_idx ON detection_alerts (subject_key, period_start);

CREATE TRIGGER detection_alerts_guard
  BEFORE INSERT OR UPDATE OF game_id, player_ids ON detection_alerts
  FOR EACH ROW EXECUTE FUNCTION detection_rows_guard();
