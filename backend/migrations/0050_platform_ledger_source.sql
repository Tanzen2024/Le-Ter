-- Source des recettes de la caisse unique de la plateforme (D-120).
--
-- `platform_ledger` reste LA SEULE caisse : aucune caisse par jeu. La source ne sert qu'à
-- tracer et analyser l'origine de chaque écriture :
--   FAP_FAP    : commission d'une partie de Le Ter (game_type 'TER') ;
--   GARAM_TIA  : commission d'une manche de GARAM TIA (game_type 'GARAM') ;
--   TOURNAMENT : écritures d'un tournoi (commission et part des rangs non occupés).
--
-- Historique : déduit sans supposition par jointure (chaque écriture porte déjà son tournoi
-- OU sa partie, garanti par `platform_ledger_source_check`). Aucune autre donnée modifiée.

ALTER TABLE platform_ledger ADD COLUMN source text;

UPDATE platform_ledger l
SET source = CASE
  WHEN l.tournament_id IS NOT NULL THEN 'TOURNAMENT'
  WHEN (SELECT g.game_type FROM games g WHERE g.id = l.game_id) = 'GARAM' THEN 'GARAM_TIA'
  ELSE 'FAP_FAP'
END;

ALTER TABLE platform_ledger ALTER COLUMN source SET NOT NULL;
ALTER TABLE platform_ledger ADD CONSTRAINT platform_ledger_source_value_check
  CHECK (source IN ('FAP_FAP', 'TOURNAMENT', 'GARAM_TIA'));
-- Un tournoi ne produit que des écritures TOURNAMENT ; une partie, jamais.
ALTER TABLE platform_ledger ADD CONSTRAINT platform_ledger_source_origin_check
  CHECK ((source = 'TOURNAMENT') = (tournament_id IS NOT NULL));

-- Une commission de partie porte la source du jeu de sa partie (vérifié à chaque écriture).
CREATE FUNCTION platform_ledger_source_guard() RETURNS trigger AS $$
DECLARE
  expected text;
BEGIN
  IF NEW.game_id IS NOT NULL THEN
    SELECT CASE g.game_type WHEN 'GARAM' THEN 'GARAM_TIA' ELSE 'FAP_FAP' END
      INTO expected FROM games g WHERE g.id = NEW.game_id;
    IF NEW.source IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'platform_ledger.source % différente du jeu de la partie (%)',
        NEW.source, expected USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_ledger_source_guard
  BEFORE INSERT OR UPDATE OF source, game_id ON platform_ledger
  FOR EACH ROW EXECUTE FUNCTION platform_ledger_source_guard();

-- Filtres et répartition par source sur une période (administration).
CREATE INDEX platform_ledger_source_created_idx ON platform_ledger (source, created_at DESC);
