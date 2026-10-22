-- GARAM TIA : variante GARAM 15 / 16 / 17 / 18, choix OBLIGATOIRE et explicite (D-127).
--
-- La variante fixe seulement le seuil de la pénalité financière « moins de X » (total
-- STRICTEMENT inférieur à X). Elle est portée par la SESSION (une partie GARAM = une session),
-- recopiée sur chaque manche (games) et, pour un tournoi GARAM, par le tournoi.
--
-- AUCUNE valeur par défaut : une nouvelle table ou un nouveau tournoi GARAM sans variante est
-- refusé par l'API ET par la base (contraintes ci-dessous).
--
-- Données existantes (compatibilité, aucune ligne supprimée) : avant D-127, la seule règle
-- appliquée était « moins de 15 » (D-119). Les sessions et manches GARAM déjà créées ont donc
-- TOUTES été jouées en GARAM 15 : elles sont renseignées 15, valeur constatée et non
-- présumée. Les tables Fap-Fap (TER) restent sans variante. Aucun tournoi GARAM n'a jamais
-- existé (refusé par 501 RULE_NOT_DEFINED, D-124) : aucun tournoi n'est réécrit.

ALTER TABLE sessions
  ADD COLUMN garam_variant smallint CHECK (garam_variant IN (15, 16, 17, 18));

ALTER TABLE games
  ADD COLUMN garam_variant smallint CHECK (garam_variant IN (15, 16, 17, 18));

ALTER TABLE tournaments
  ADD COLUMN garam_variant smallint CHECK (garam_variant IN (15, 16, 17, 18));

UPDATE sessions SET garam_variant = 15 WHERE game_type = 'GARAM' AND garam_variant IS NULL;
UPDATE games SET garam_variant = 15 WHERE game_type = 'GARAM' AND garam_variant IS NULL;

-- Une variante pour GARAM, et seulement pour GARAM.
ALTER TABLE sessions ADD CONSTRAINT sessions_garam_variant_iff_garam
  CHECK ((game_type = 'GARAM') = (garam_variant IS NOT NULL));
ALTER TABLE games ADD CONSTRAINT games_garam_variant_iff_garam
  CHECK ((game_type = 'GARAM') = (garam_variant IS NOT NULL));
ALTER TABLE tournaments ADD CONSTRAINT tournaments_garam_variant_iff_garam
  CHECK ((game_type = 'GARAM') = (garam_variant IS NOT NULL));

-- Immuable ; une manche a toujours la variante de sa session.
CREATE FUNCTION games_garam_variant_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.garam_variant IS DISTINCT FROM OLD.garam_variant THEN
    RAISE EXCEPTION 'games.garam_variant est immuable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.session_id IS NOT NULL AND NEW.garam_variant IS DISTINCT FROM
      (SELECT s.garam_variant FROM sessions s WHERE s.id = NEW.session_id) THEN
    RAISE EXCEPTION 'games.garam_variant différent de celui de la session'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER games_garam_variant_guard
  BEFORE INSERT OR UPDATE OF garam_variant, session_id ON games
  FOR EACH ROW EXECUTE FUNCTION games_garam_variant_guard();

CREATE FUNCTION garam_variant_immutable_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.garam_variant IS DISTINCT FROM OLD.garam_variant THEN
    RAISE EXCEPTION '%.garam_variant est immuable', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_garam_variant_guard
  BEFORE UPDATE OF garam_variant ON sessions
  FOR EACH ROW EXECUTE FUNCTION garam_variant_immutable_guard();

CREATE TRIGGER tournaments_garam_variant_guard
  BEFORE UPDATE OF garam_variant ON tournaments
  FOR EACH ROW EXECUTE FUNCTION garam_variant_immutable_guard();
