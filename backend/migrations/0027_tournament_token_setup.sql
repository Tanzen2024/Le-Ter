-- Jetons de départ et mise par partie d'une proposition, avant approbation (D-069).
--
-- `initial_tokens_customized` / `stake_customized` : la valeur a été fixée explicitement par
--   l'administration. Sinon, tant que le tournoi n'est pas approuvé (DRAFT, PENDING_APPROVAL),
--   la valeur suit le prix d'entrée : jetons = 10 × prix, mise = moitié du prix arrondie à
--   l'entier inférieur, au moins 1 ; prix 0 : paramètres plateforme. Après l'approbation, les
--   drapeaux n'ont plus d'effet : les valeurs enregistrées sont celles du tournoi.
--
-- Données existantes : seules les propositions NON approuvées (DRAFT, PENDING_APPROVAL) au
-- prix d'entrée non nul reçoivent les valeurs par défaut. Aucun tournoi publié, démarré ou
-- terminé n'est modifié.

ALTER TABLE tournaments
  ADD COLUMN initial_tokens_customized boolean NOT NULL DEFAULT false,
  ADD COLUMN stake_customized boolean NOT NULL DEFAULT false;

UPDATE tournaments
   SET initial_tournament_tokens = entry_fee * 10,
       -- Division entière (bigint) : moitié arrondie à l'entier inférieur.
       stake_per_game = GREATEST(1, entry_fee / 2),
       version = version + 1,
       updated_at = now()
 WHERE status IN ('DRAFT', 'PENDING_APPROVAL')
   AND entry_fee >= 1;
