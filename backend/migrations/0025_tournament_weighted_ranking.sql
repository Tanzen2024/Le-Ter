-- Classement pondéré des tournois (D-062) : score sur 100 points calculé à partir des jetons
-- restants et des parties jouées, avec des poids configurables dont la somme vaut 100 %.
--
-- Reproductibilité : les poids sont COPIÉS sur le tournoi à sa publication (comme la
-- commission) puis immuables, et le score de chaque ligne de résultat est figé avec elle.
-- Une modification ultérieure des paramètres ne recalcule jamais un classement publié.

-- 1. Poids figés sur le tournoi (points de base : 5000 = 50 %) ------------------------------

ALTER TABLE tournaments
  ADD COLUMN ranking_tokens_weight_bps integer CHECK (ranking_tokens_weight_bps BETWEEN 0 AND 10000),
  ADD COLUMN ranking_games_weight_bps  integer CHECK (ranking_games_weight_bps BETWEEN 0 AND 10000);

ALTER TABLE tournaments ADD CONSTRAINT tournaments_ranking_weights_check CHECK (
  (ranking_tokens_weight_bps IS NULL AND ranking_games_weight_bps IS NULL)
  OR (ranking_tokens_weight_bps IS NOT NULL AND ranking_games_weight_bps IS NOT NULL
      AND ranking_tokens_weight_bps + ranking_games_weight_bps = 10000));

-- Tournois publiés pas encore classés : la configuration initiale (50 % / 50 %). Les tournois
-- déjà classés (résultats validés, en versement, terminés) gardent leur classement
-- historique (ordre jetons → parties de D-054) : leurs poids restent NULL, rien n'est
-- recalculé. Brouillons et propositions recevront les poids à leur publication.
UPDATE tournaments
   SET ranking_tokens_weight_bps = 5000, ranking_games_weight_bps = 5000
 WHERE status IN ('SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'STARTING',
                  'IN_PROGRESS', 'CALCULATING_RESULTS');

-- 2. Score figé avec chaque ligne de résultat (NULL pour les résultats historiques) --------

ALTER TABLE tournament_results
  ADD COLUMN score numeric(7, 4) CHECK (score BETWEEN 0 AND 100);

-- 3. Paramètres plateforme : poids par défaut des nouveaux tournois -------------------------

ALTER TABLE system_settings DROP CONSTRAINT system_settings_key_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_check CHECK (key IN (
  'detection_enabled', 'tournament_platform_fee_percent', 'initial_tournament_tokens',
  'default_tournament_stake', 'maximum_pending_tournaments_per_player',
  'tournament_transition_minutes', 'tournament_ranking_tokens_weight_percent',
  'tournament_ranking_games_weight_percent'));
