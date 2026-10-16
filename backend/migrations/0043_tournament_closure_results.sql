-- Tournois : rattachement explicite des parties, clôture sans annulation forcée, classement
-- officiel auditable et immuable (D-106). Ajouts seulement : aucune donnée existante n'est
-- supprimée ; les tournois déjà démarrés gardent leur méthode de classement (D-062).

-- 1. Rattachement EXPLICITE et durable de chaque partie à son tournoi -----------------------
--
-- Jusqu'ici une partie appartenait à un tournoi par sa session (`tournament_sessions`).
-- `games.tournament_id` est désormais écrit À LA CRÉATION de la partie (première partie d'une
-- table, parties suivantes) et ne change plus jamais. Une partie ordinaire n'en a pas.

ALTER TABLE games ADD COLUMN tournament_id uuid REFERENCES tournaments (id);

UPDATE games g
   SET tournament_id = ts.tournament_id
  FROM tournament_sessions ts
 WHERE ts.session_id = g.session_id;

CREATE INDEX games_tournament_status_idx ON games (tournament_id, status)
  WHERE tournament_id IS NOT NULL;

-- Garde-fou en base :
-- - le rattachement d'une partie est celui de sa table (jamais une partie ordinaire
--   rattachée à un tournoi, jamais une partie de tournoi « ordinaire »), puis immuable ;
-- - une partie de tournoi ne DÉMARRE (ou n'est insérée démarrée) que si son tournoi est
--   encore IN_PROGRESS, lu sous verrou partagé : la clôture (FOR UPDATE) et un démarrage ne
--   peuvent pas se croiser sans que l'un voie l'autre.
CREATE FUNCTION games_tournament_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  linked uuid;
  current_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tournament_id IS DISTINCT FROM OLD.tournament_id THEN
    RAISE EXCEPTION 'games.tournament_id est immuable (partie %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT ts.tournament_id INTO linked
      FROM tournament_sessions ts WHERE ts.session_id = NEW.session_id;
    IF NEW.tournament_id IS NULL THEN
      NEW.tournament_id := linked;
    END IF;
    IF NEW.tournament_id IS DISTINCT FROM linked THEN
      RAISE EXCEPTION 'partie % : tournoi % différent de celui de sa table (%)',
        NEW.id, NEW.tournament_id, linked
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.tournament_id IS NOT NULL AND NEW.status = 'in_progress'
     AND (TG_OP = 'INSERT' OR OLD.status <> 'in_progress') THEN
    SELECT t.status INTO current_status
      FROM tournaments t WHERE t.id = NEW.tournament_id FOR SHARE;
    IF current_status IS DISTINCT FROM 'IN_PROGRESS' THEN
      RAISE EXCEPTION 'TOURNAMENT_GAME_START_CLOSED: tournoi % (%)', NEW.tournament_id,
        current_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER games_tournament_guard
  BEFORE INSERT OR UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION games_tournament_guard();

-- Un règlement de jetons ne vise que les parties de SON tournoi.
CREATE FUNCTION tournament_games_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM games g
                  WHERE g.id = NEW.game_id AND g.tournament_id = NEW.tournament_id) THEN
    RAISE EXCEPTION 'règlement refusé : la partie % n''appartient pas au tournoi %',
      NEW.game_id, NEW.tournament_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tournament_games_link_guard
  BEFORE INSERT ON tournament_games
  FOR EACH ROW EXECUTE FUNCTION tournament_games_link_guard();

-- 2. Méthode de classement figée au DÉMARRAGE ----------------------------------------------
--
-- D062_SATURATING : ratios x / (x + référence) (D-062), conservée pour les tournois déjà
-- démarrés. D106_CAPITAL_RATIO : jetons restants / capital initial et parties jouées /
-- parties de référence plafonné à 1 (D-106). `ranking_games_reference` : nombre de parties de
-- référence figé au démarrage.

ALTER TABLE tournaments
  ADD COLUMN ranking_method text
    CHECK (ranking_method IN ('D062_SATURATING', 'D106_CAPITAL_RATIO')),
  ADD COLUMN ranking_games_reference integer CHECK (ranking_games_reference >= 1);

UPDATE tournaments SET ranking_method = 'D062_SATURATING' WHERE started_at IS NOT NULL;

ALTER TABLE tournaments ADD CONSTRAINT tournaments_ranking_method_when_started
  CHECK (started_at IS NULL OR ranking_method IS NOT NULL);

-- Règles officielles figées : après le démarrage, ni la méthode, ni les poids, ni le capital
-- initial, ni la mise ne changent (aucune modification rétroactive du classement).
CREATE FUNCTION tournaments_frozen_rules_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.started_at IS NOT NULL AND (
       NEW.ranking_method IS DISTINCT FROM OLD.ranking_method
    OR NEW.ranking_games_reference IS DISTINCT FROM OLD.ranking_games_reference
    OR NEW.ranking_tokens_weight_bps IS DISTINCT FROM OLD.ranking_tokens_weight_bps
    OR NEW.ranking_games_weight_bps IS DISTINCT FROM OLD.ranking_games_weight_bps
    OR NEW.initial_tournament_tokens IS DISTINCT FROM OLD.initial_tournament_tokens
    OR NEW.stake_per_game IS DISTINCT FROM OLD.stake_per_game
    OR NEW.started_at IS DISTINCT FROM OLD.started_at) THEN
    RAISE EXCEPTION 'règles du tournoi % figées depuis son démarrage', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tournaments_frozen_rules_guard
  BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION tournaments_frozen_rules_guard();

-- 3. Participation : capital initial immuable, fin de participation datée ------------------

ALTER TABLE tournament_player_accounts ADD COLUMN finished_at timestamptz;

CREATE FUNCTION tournament_accounts_guard() RETURNS trigger
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER tournament_accounts_guard
  BEFORE UPDATE ON tournament_player_accounts
  FOR EACH ROW EXECUTE FUNCTION tournament_accounts_guard();

-- 4. Classement officiel : données d'audit, puis immuable -----------------------------------
--
-- Le score D-106 n'est plus borné à 100 (un joueur peut finir avec plus que son capital
-- initial) : la colonne est élargie.

ALTER TABLE tournament_results DROP CONSTRAINT tournament_results_score_check;
ALTER TABLE tournament_results ALTER COLUMN score TYPE numeric(12, 4);
ALTER TABLE tournament_results ADD CONSTRAINT tournament_results_score_check
  CHECK (score >= 0);

ALTER TABLE tournament_results
  ADD COLUMN ranking_method text
    CHECK (ranking_method IN ('D062_SATURATING', 'D106_CAPITAL_RATIO')),
  ADD COLUMN tokens_ratio numeric(16, 6) CHECK (tokens_ratio >= 0),
  ADD COLUMN games_ratio numeric(10, 6) CHECK (games_ratio BETWEEN 0 AND 1),
  ADD COLUMN tokens_weight_bps integer CHECK (tokens_weight_bps BETWEEN 0 AND 10000),
  ADD COLUMN games_weight_bps integer CHECK (games_weight_bps BETWEEN 0 AND 10000),
  ADD COLUMN games_reference integer CHECK (games_reference >= 0),
  ADD COLUMN tie_break text
    CHECK (tie_break IN ('GAMES_WON', 'REGISTRATION_ORDER', 'PLAYER_ID')),
  ADD COLUMN registered_at timestamptz;

-- Publié = immuable : aucune suppression ; seul le versement d'un gain (paid_at et sa
-- transaction, une seule fois) peut encore être écrit.
CREATE FUNCTION tournament_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'classement officiel immuable (tournoi %)', OLD.tournament_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.tournament_id, NEW.rank, NEW.player_id, NEW.initial_tokens, NEW.remaining_tokens,
      NEW.games_played, NEW.games_won, NEW.prize_share_bps, NEW.prize_amount, NEW.score,
      NEW.created_at, NEW.ranking_method, NEW.tokens_ratio, NEW.games_ratio,
      NEW.tokens_weight_bps, NEW.games_weight_bps, NEW.games_reference, NEW.tie_break,
      NEW.registered_at)
     IS DISTINCT FROM
     (OLD.tournament_id, OLD.rank, OLD.player_id, OLD.initial_tokens, OLD.remaining_tokens,
      OLD.games_played, OLD.games_won, OLD.prize_share_bps, OLD.prize_amount, OLD.score,
      OLD.created_at, OLD.ranking_method, OLD.tokens_ratio, OLD.games_ratio,
      OLD.tokens_weight_bps, OLD.games_weight_bps, OLD.games_reference, OLD.tie_break,
      OLD.registered_at) THEN
    RAISE EXCEPTION 'classement officiel immuable (tournoi %)', OLD.tournament_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.paid_at IS NOT NULL AND (NEW.paid_at IS DISTINCT FROM OLD.paid_at
      OR NEW.prize_transaction_id IS DISTINCT FROM OLD.prize_transaction_id) THEN
    RAISE EXCEPTION 'gain déjà versé (tournoi %, rang %)', OLD.tournament_id, OLD.rank
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tournament_results_guard
  BEFORE UPDATE OR DELETE ON tournament_results
  FOR EACH ROW EXECUTE FUNCTION tournament_results_guard();

-- Historique des résultats d'un joueur (rubrique « Résultats des tournois »).
CREATE INDEX tournament_results_player_idx ON tournament_results (player_id, created_at DESC);
