-- Tournois : plan de versement des récompenses RÉELLES (D-112). Ajouts seulement : aucune
-- donnée existante n'est supprimée ; les classements déjà publiés reçoivent leur plan, avec
-- l'état réel de chaque gain (versé ou non).
--
-- Le plan est écrit avec le classement officiel (même transaction), une ligne par gain > 0 :
-- bénéficiaire, montant, référence idempotente, statut. Il est ensuite VALIDÉ (contrôles
-- financiers de la cagnotte) avant tout crédit ; chaque crédit est une écriture interne du
-- compte de jeu (`wallet_transactions` `tournament_prize`), jamais un paiement CinetPay.

CREATE TABLE tournament_payouts (
  tournament_id         uuid        NOT NULL,
  rank                  integer     NOT NULL CHECK (rank >= 1),
  player_id             uuid        NOT NULL REFERENCES users (id),
  amount                bigint      NOT NULL CHECK (amount > 0),
  currency              text        NOT NULL DEFAULT 'XAF' CHECK (currency = 'XAF'),
  -- Référence UNIQUE du crédit (clé d'idempotence de la transaction du compte de jeu).
  idempotency_key       text        NOT NULL UNIQUE,
  status                text        NOT NULL CHECK (status IN ('PENDING', 'CREDITED', 'FAILED')),
  wallet_transaction_id uuid        UNIQUE REFERENCES wallet_transactions (id),
  attempts              integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error            text        CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  last_attempt_at       timestamptz,
  created_at            timestamptz NOT NULL,
  credited_at           timestamptz,
  PRIMARY KEY (tournament_id, rank),
  -- Le plan suit le classement officiel, rang par rang ; un bénéficiaire, une récompense.
  FOREIGN KEY (tournament_id, rank) REFERENCES tournament_results (tournament_id, rank),
  CONSTRAINT tournament_payouts_player_once UNIQUE (tournament_id, player_id),
  CHECK ((status = 'CREDITED') = (wallet_transaction_id IS NOT NULL AND credited_at IS NOT NULL)),
  CHECK (status <> 'FAILED' OR last_error IS NOT NULL)
);

CREATE INDEX tournament_payouts_open_idx ON tournament_payouts (tournament_id, rank)
  WHERE status <> 'CREDITED';

-- Plan immuable : bénéficiaire, montant et référence ne changent jamais ; un versement
-- CREDITED est définitif ; aucune ligne n'est supprimée.
CREATE FUNCTION tournament_payouts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'plan de versement immuable (tournoi %, rang %)', OLD.tournament_id, OLD.rank
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.tournament_id, NEW.rank, NEW.player_id, NEW.amount, NEW.currency,
      NEW.idempotency_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tournament_id, OLD.rank, OLD.player_id, OLD.amount, OLD.currency,
      OLD.idempotency_key, OLD.created_at) THEN
    RAISE EXCEPTION 'plan de versement immuable (tournoi %, rang %)', OLD.tournament_id, OLD.rank
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'CREDITED' AND (NEW.status IS DISTINCT FROM OLD.status
      OR NEW.wallet_transaction_id IS DISTINCT FROM OLD.wallet_transaction_id
      OR NEW.credited_at IS DISTINCT FROM OLD.credited_at) THEN
    RAISE EXCEPTION 'récompense déjà créditée (tournoi %, rang %)', OLD.tournament_id, OLD.rank
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tournament_payouts_guard
  BEFORE UPDATE OR DELETE ON tournament_payouts
  FOR EACH ROW EXECUTE FUNCTION tournament_payouts_guard();

-- Le crédit référencé est bien le gain de CE bénéficiaire, du MÊME montant, réussi.
CREATE FUNCTION tournament_payouts_credit_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.wallet_transaction_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wallet_transactions wt
        WHERE wt.id = NEW.wallet_transaction_id AND wt.user_id = NEW.player_id
          AND wt.kind = 'tournament_prize' AND wt.status = 'succeeded'
          AND wt.tokens = NEW.amount AND wt.idempotency_key = NEW.idempotency_key) THEN
    RAISE EXCEPTION 'crédit incohérent avec le plan (tournoi %, rang %)',
      NEW.tournament_id, NEW.rank
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tournament_payouts_credit_guard
  BEFORE INSERT OR UPDATE OF wallet_transaction_id ON tournament_payouts
  FOR EACH ROW EXECUTE FUNCTION tournament_payouts_credit_guard();

-- Validation du plan et blocage financier, sur le tournoi.
ALTER TABLE tournaments
  ADD COLUMN payout_plan_validated_at timestamptz,
  ADD COLUMN payout_blocked_at timestamptz,
  ADD COLUMN payout_block_reasons text[];

ALTER TABLE tournaments ADD CONSTRAINT tournaments_payout_block_consistent
  CHECK ((payout_blocked_at IS NULL) = (payout_block_reasons IS NULL));

-- Finalisation financière : un tournoi ne passe COMPLETED que si TOUT son plan est crédité.
CREATE FUNCTION tournaments_completion_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' AND EXISTS (
       SELECT 1 FROM tournament_payouts p
        WHERE p.tournament_id = NEW.id AND p.status <> 'CREDITED') THEN
    RAISE EXCEPTION 'tournoi % : versements non crédités, finalisation refusée', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tournaments_completion_guard
  BEFORE UPDATE OF status ON tournaments
  FOR EACH ROW EXECUTE FUNCTION tournaments_completion_guard();

-- Plans des classements déjà publiés (état réel de chaque gain).
INSERT INTO tournament_payouts (tournament_id, rank, player_id, amount, idempotency_key, status,
  wallet_transaction_id, created_at, credited_at)
SELECT r.tournament_id, r.rank, r.player_id, r.prize_amount,
       'tournament-prize:' || r.tournament_id || ':' || r.rank,
       CASE WHEN wt.id IS NOT NULL THEN 'CREDITED' ELSE 'PENDING' END,
       wt.id, r.created_at, CASE WHEN wt.id IS NOT NULL THEN r.paid_at END
  FROM tournament_results r
  JOIN tournaments t ON t.id = r.tournament_id
  LEFT JOIN wallet_transactions wt ON wt.id = r.prize_transaction_id
        AND wt.user_id = r.player_id AND wt.kind = 'tournament_prize'
        AND wt.status = 'succeeded' AND wt.tokens = r.prize_amount
        AND wt.idempotency_key = 'tournament-prize:' || r.tournament_id || ':' || r.rank
        AND r.paid_at IS NOT NULL
 WHERE r.prize_amount > 0
   AND t.status IN ('RESULTS_VALIDATED', 'DISTRIBUTING_PRIZES', 'COMPLETED')
ON CONFLICT (tournament_id, rank) DO NOTHING;

-- Les plans en cours de versement ont déjà été acceptés par l'ancien traitement.
UPDATE tournaments SET payout_plan_validated_at = COALESCE(results_at, updated_at)
 WHERE status IN ('DISTRIBUTING_PRIZES', 'COMPLETED');


-- Séparation monétaire en base (D-112) -------------------------------------------------------
--
-- Les jetons d'un tournoi ne sont JAMAIS convertis en FCFA : la seule entrée d'argent réel liée
-- à un tournoi est le crédit d'une ligne du plan officiel. Le code applique déjà ces règles ;
-- la base les rend impossibles à contourner (bogue, chemin indirect, écriture manuelle).

-- Une partie de tournoi (rattachée explicitement, ou à une table de tournoi) n'a ni séquestre,
-- ni réservation, ni mise, ni gain sur le compte de jeu réel.
CREATE FUNCTION is_tournament_game(game uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM games g
     WHERE g.id = game
       AND (g.tournament_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM tournament_sessions ts WHERE ts.session_id = g.session_id)))
$$;

CREATE FUNCTION tournament_game_real_money_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.game_id IS NOT NULL AND is_tournament_game(NEW.game_id) THEN
    RAISE EXCEPTION 'partie de tournoi % : aucun mouvement du compte de jeu réel (%)',
      NEW.game_id, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER game_settlements_tournament_guard
  BEFORE INSERT ON game_settlements
  FOR EACH ROW EXECUTE FUNCTION tournament_game_real_money_guard();
CREATE TRIGGER wallet_reservations_tournament_game_guard
  BEFORE INSERT ON wallet_reservations
  FOR EACH ROW EXECUTE FUNCTION tournament_game_real_money_guard();
CREATE TRIGGER wallet_transactions_tournament_game_guard
  BEFORE INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION tournament_game_real_money_guard();

-- Un gain de tournoi (`tournament_prize`) n'existe que s'il est la preuve de crédit d'une ligne
-- du plan officiel, du même joueur, du même montant, de la même référence : vérifié à la FIN
-- de la transaction (le crédit et le passage CREDITED sont écrits ensemble). Les gains déjà
-- versés avant cette migration ne sont pas concernés (seules les insertions sont contrôlées).
CREATE FUNCTION tournament_prize_requires_payout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'tournament_prize' AND NOT EXISTS (
       SELECT 1 FROM tournament_payouts p
        WHERE p.wallet_transaction_id = NEW.id AND p.status = 'CREDITED'
          AND p.player_id = NEW.user_id AND p.amount = NEW.tokens
          AND p.idempotency_key = NEW.idempotency_key) THEN
    RAISE EXCEPTION 'gain de tournoi % sans ligne créditée du plan de versement', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_transactions_tournament_prize_guard
  AFTER INSERT ON wallet_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.kind = 'tournament_prize')
  EXECUTE FUNCTION tournament_prize_requires_payout();
