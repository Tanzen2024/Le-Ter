-- Jeu d'un tournoi : choix OBLIGATOIRE et explicite à la création (D-124).
--
-- Même valeur que le jeu des sessions et des parties (D-119) : 'TER' (Fap-Fap) ou 'GARAM'
-- (GARAM TIA), sans second système de noms.
--
-- AUCUNE valeur par défaut : le jeu vient toujours du choix de l'utilisateur. Les tournois
-- existants sont tous du Ter (aucun tournoi GARAM n'a jamais existé, D-119) : la valeur
-- temporaire de l'ADD COLUMN les renseigne sans UPDATE (aucune ligne réécrite, aucun
-- déclencheur), puis elle est retirée aussitôt.

ALTER TABLE tournaments
  ADD COLUMN game_type text NOT NULL DEFAULT 'TER' CHECK (game_type IN ('TER', 'GARAM'));

ALTER TABLE tournaments ALTER COLUMN game_type DROP DEFAULT;

-- Fixé à la création, jamais modifié ensuite (comme le jeu d'une session).
CREATE FUNCTION tournaments_game_type_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.game_type IS DISTINCT FROM OLD.game_type THEN
    RAISE EXCEPTION 'tournaments.game_type est immuable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tournaments_game_type_guard
  BEFORE UPDATE OF game_type ON tournaments
  FOR EACH ROW EXECUTE FUNCTION tournaments_game_type_guard();
