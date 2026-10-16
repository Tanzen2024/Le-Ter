-- Tournois : règlement des parties aligné sur les parties ordinaires, comptes fictifs dissous
-- après la publication (D-111). Ajouts seulement : aucune donnée existante n'est supprimée ;
-- les tournois déjà démarrés gardent la règle de règlement D-054 (« tapis »).

-- 1. Règle de règlement FIGÉE au démarrage ------------------------------------------------
--
-- D054_TAPIS : règle d'origine (D-054) : mise effective plafonnée aux jetons du gagnant, tout
-- joueur assis (fuyard compris) paie, aucune Kora. D111_ORDINARY_RULES : règles des parties
-- ordinaires (D-074, D-080, D-086) appliquées aux comptes fictifs, sans commission : chaque
-- perdant perd M (2M en Kora), les fuyards d'une partie à 3 ou 4 ne sont pas réglés.

ALTER TABLE tournaments ADD COLUMN settlement_rule text
  CHECK (settlement_rule IN ('D054_TAPIS', 'D111_ORDINARY_RULES'));

UPDATE tournaments SET settlement_rule = 'D054_TAPIS' WHERE started_at IS NOT NULL;

ALTER TABLE tournaments ADD CONSTRAINT tournaments_settlement_rule_when_started
  CHECK (started_at IS NULL OR settlement_rule IS NOT NULL);

-- Règles officielles figées après le démarrage : la règle de règlement s'y ajoute.
CREATE OR REPLACE FUNCTION tournaments_frozen_rules_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.started_at IS NOT NULL AND (
       NEW.ranking_method IS DISTINCT FROM OLD.ranking_method
    OR NEW.ranking_games_reference IS DISTINCT FROM OLD.ranking_games_reference
    OR NEW.ranking_tokens_weight_bps IS DISTINCT FROM OLD.ranking_tokens_weight_bps
    OR NEW.ranking_games_weight_bps IS DISTINCT FROM OLD.ranking_games_weight_bps
    OR NEW.initial_tournament_tokens IS DISTINCT FROM OLD.initial_tournament_tokens
    OR NEW.stake_per_game IS DISTINCT FROM OLD.stake_per_game
    OR NEW.settlement_rule IS DISTINCT FROM OLD.settlement_rule
    OR NEW.started_at IS DISTINCT FROM OLD.started_at) THEN
    RAISE EXCEPTION 'règles du tournoi % figées depuis son démarrage', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Audit de chaque règlement ---------------------------------------------------------------

ALTER TABLE tournament_games
  ADD COLUMN settlement_rule text
    CHECK (settlement_rule IN ('D054_TAPIS', 'D111_ORDINARY_RULES')),
  ADD COLUMN victory_type text CHECK (victory_type IN ('SIMPLE', 'KORA'));

UPDATE tournament_games SET settlement_rule = 'D054_TAPIS';

-- Un règlement est écrit une fois (clé `game_id`) puis IMMUABLE : ni suppression, ni
-- modification (preuve des mouvements fictifs, classement, contestations).
CREATE FUNCTION tournament_games_immutable_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'règlement de tournoi immuable (partie %)', OLD.game_id
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER tournament_games_immutable_guard
  BEFORE UPDATE OR DELETE ON tournament_games
  FOR EACH ROW EXECUTE FUNCTION tournament_games_immutable_guard();

-- 3. Dissolution des comptes fictifs ---------------------------------------------------------
--
-- Après la publication du classement et le versement des gains (COMPLETED), les comptes du
-- tournoi deviennent DISSOLVED : plus utilisables, jamais supprimés (soldes finaux, parties,
-- rang et gain restent lisibles). Aucun mouvement du compte de jeu réel n'y est associé.

ALTER TABLE tournament_player_accounts
  DROP CONSTRAINT tournament_player_accounts_status_check;
ALTER TABLE tournament_player_accounts
  ADD CONSTRAINT tournament_player_accounts_status_check
    CHECK (status IN ('ACTIVE', 'OUT_OF_TOKENS', 'DISSOLVED'));
ALTER TABLE tournament_player_accounts ADD COLUMN dissolved_at timestamptz;
ALTER TABLE tournament_player_accounts ADD CONSTRAINT tournament_accounts_dissolved_consistent
  CHECK ((status = 'DISSOLVED') = (dissolved_at IS NOT NULL)
         AND (dissolved_at IS NULL OR finished_at IS NOT NULL));

CREATE OR REPLACE FUNCTION tournament_accounts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.initial_tokens IS DISTINCT FROM OLD.initial_tokens THEN
    RAISE EXCEPTION 'capital initial immuable (compte %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.finished_at IS NOT NULL AND (
       NEW.current_tokens IS DISTINCT FROM OLD.current_tokens
    OR NEW.games_played IS DISTINCT FROM OLD.games_played
    OR NEW.games_won IS DISTINCT FROM OLD.games_won
    OR NEW.rank IS DISTINCT FROM OLD.rank
    OR NEW.prize_amount IS DISTINCT FROM OLD.prize_amount
    OR NEW.finished_at IS DISTINCT FROM OLD.finished_at) THEN
    RAISE EXCEPTION 'participation % close : plus aucune modification', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- Dissolution : définitive (ni réactivation, ni nouvelle date).
  IF OLD.dissolved_at IS NOT NULL AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.dissolved_at IS DISTINCT FROM OLD.dissolved_at) THEN
    RAISE EXCEPTION 'compte de tournoi % dissous : plus aucune modification', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
