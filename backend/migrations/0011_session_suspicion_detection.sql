-- Réglage « détection anti-collusion » d'une partie privée (D-043).
--
-- Choisi à la création de la partie (désactivé par défaut), puis IMMUABLE. Il appartient à la
-- table (session, D-033), comme son nom et son mot de passe (D-039).
--
-- ATTENTION : seul le RÉGLAGE est enregistré et affiché. Aucun mécanisme de détection
-- n'existe encore (règles, données analysées, conséquences : « À CLARIFIER », docs/TODO.md).

ALTER TABLE sessions
  ADD COLUMN suspicion_detection_enabled boolean NOT NULL DEFAULT false;

CREATE FUNCTION sessions_suspicion_detection_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.suspicion_detection_enabled <> OLD.suspicion_detection_enabled THEN
    RAISE EXCEPTION 'sessions.suspicion_detection_enabled est immuable (session %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_suspicion_detection_immutable
  BEFORE UPDATE OF suspicion_detection_enabled ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_suspicion_detection_immutable();
