-- Tournois sans nom ni description (D-060) : les deux colonnes sont supprimées du schéma.
-- Aucune vue, aucun index ni trigger n'en dépend ; leurs CHECK sont des contraintes de
-- colonne, supprimées avec elles. La table, ses identifiants, ses relations (inscriptions,
-- tables, résultats, registre) et toutes les autres colonnes sont conservés.

ALTER TABLE tournaments DROP COLUMN IF EXISTS name;
ALTER TABLE tournaments DROP COLUMN IF EXISTS description;

-- Données JSON : le nom n'est plus copié dans les notifications de tournoi ; on le retire
-- aussi des notifications existantes (rien d'autre n'est modifié dans leur contenu).
UPDATE notifications SET payload = payload - 'name'
 WHERE type LIKE 'TOURNAMENT\_%' AND payload ? 'name';
