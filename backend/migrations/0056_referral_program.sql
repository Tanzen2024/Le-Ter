-- Programme de parrainage (D-161) : code personnel, attribution à l'inscription, qualification
-- individuelle par les achats CONFIRMÉS, récompenses progressives par palier.
--
-- AJOUTS seulement : aucune ligne existante n'est modifiée ni supprimée. Le compte de jeu
-- (D-040) reste l'UNIQUE portefeuille : une récompense est une ligne `wallet_transactions`
-- (`referral_reward`) créditée sous verrou, jamais une seconde comptabilité. Le cumul des achats
-- d'un filleul n'est PAS stocké comme solde : il est recalculé depuis `wallet_transactions`
-- (`deposit` réglé `succeeded`), seule preuve qu'un achat a été confirmé.

-- 1. Campagne et versions de ses règles ----------------------------------------------------------

CREATE TABLE referral_campaigns (
  id         uuid        PRIMARY KEY,
  code       text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{3,40}$'),
  status     text        NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Une version par changement de règles, jamais modifiée ni supprimée : une récompense et une
-- qualification gardent la version qui s'appliquait (aucune réécriture rétroactive).
-- Version courante = la plus élevée de la campagne.
CREATE TABLE referral_rule_versions (
  campaign_id             uuid        NOT NULL REFERENCES referral_campaigns (id),
  version                 integer     NOT NULL CHECK (version >= 1),
  referrals_per_tier      integer     NOT NULL CHECK (referrals_per_tier BETWEEN 1 AND 1000),
  qualification_threshold bigint      NOT NULL CHECK (qualification_threshold BETWEEN 1 AND 1000000000),
  reward_per_tier         bigint      NOT NULL CHECK (reward_per_tier BETWEEN 1 AND 1000000000),
  -- NULL : aucun plafond du nombre de paliers.
  max_tiers               integer     CHECK (max_tiers IS NULL OR max_tiers BETWEEN 1 AND 100000),
  created_at              timestamptz NOT NULL,
  -- Sans clé étrangère : la trace de l'auteur survit à tout (NULL = valeurs initiales).
  created_by              uuid,
  PRIMARY KEY (campaign_id, version)
);

CREATE FUNCTION referral_rule_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'referral_rule_versions est en ajout seul (campagne %, version %)',
    OLD.campaign_id, OLD.version USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER referral_rule_versions_immutable
  BEFORE UPDATE OR DELETE ON referral_rule_versions
  FOR EACH ROW EXECUTE FUNCTION referral_rule_versions_immutable();

-- Campagne demandée : 10 filleuls par palier, 1 000 jetons d'achats confirmés par filleul,
-- 5 000 jetons par palier complet, sans plafond.
INSERT INTO referral_campaigns (id, code, status, created_at, updated_at)
VALUES ('a0e1f7c2-5b1d-4c3e-9f00-000000000001', 'LE_TER_REFERRAL', 'ACTIVE', now(), now());
INSERT INTO referral_rule_versions (campaign_id, version, referrals_per_tier,
  qualification_threshold, reward_per_tier, max_tiers, created_at)
VALUES ('a0e1f7c2-5b1d-4c3e-9f00-000000000001', 1, 10, 1000, 5000, NULL, now());

-- 2. Code personnel ------------------------------------------------------------------------------

-- Un code par joueur, tiré au hasard (aucun lien avec l'identifiant interne), stable : jamais
-- modifié ni supprimé. 8 caractères sans 0/O/1/I (lisible, dicté facilement).
CREATE TABLE referral_codes (
  user_id    uuid        PRIMARY KEY REFERENCES users (id),
  code       text        NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at timestamptz NOT NULL,
  CONSTRAINT referral_codes_owner UNIQUE (user_id, code)
);

CREATE FUNCTION referral_codes_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'le code de parrainage du joueur % est immuable', OLD.user_id
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER referral_codes_immutable
  BEFORE UPDATE OR DELETE ON referral_codes
  FOR EACH ROW EXECUTE FUNCTION referral_codes_immutable();

-- 3. Attribution d'un filleul ---------------------------------------------------------------------

CREATE TABLE referral_attributions (
  id                          uuid        PRIMARY KEY,
  campaign_id                 uuid        NOT NULL REFERENCES referral_campaigns (id),
  referrer_id                 uuid        NOT NULL,
  referee_id                  uuid        NOT NULL REFERENCES users (id),
  -- Le code utilisé appartient au parrain (clé étrangère composée).
  referral_code               text        NOT NULL,
  -- Origine déclarée par l'application (lien ou saisie) : information d'audit seulement.
  source                      text        NOT NULL CHECK (source IN ('LINK', 'MANUAL')),
  attributed_at               timestamptz NOT NULL,
  -- Qualification : posée une fois, avec la version des règles et le cumul constaté.
  qualified_at                timestamptz,
  qualification_rules_version integer,
  qualification_total         bigint,
  -- Contrôle de l'administration : FLAGGED (en vérification) et REJECTED ne comptent pas.
  review_status               text        NOT NULL DEFAULT 'NONE'
                              CHECK (review_status IN ('NONE', 'FLAGGED', 'CLEARED', 'REJECTED')),
  review_reason               text        CHECK (char_length(review_reason) <= 500),
  reviewed_at                 timestamptz,
  reviewed_by                 uuid        REFERENCES users (id),
  CONSTRAINT referral_attributions_code_owner FOREIGN KEY (referrer_id, referral_code)
    REFERENCES referral_codes (user_id, code),
  -- Un nouveau compte n'a qu'un seul parrain par campagne.
  CONSTRAINT referral_attributions_one_referrer UNIQUE (campaign_id, referee_id),
  CONSTRAINT referral_attributions_not_self CHECK (referrer_id <> referee_id),
  CHECK ((qualified_at IS NULL) = (qualification_rules_version IS NULL)),
  CHECK ((qualified_at IS NULL) = (qualification_total IS NULL)),
  CHECK ((review_status = 'NONE') = (reviewed_at IS NULL))
);

CREATE INDEX referral_attributions_referrer_idx
  ON referral_attributions (campaign_id, referrer_id, attributed_at DESC);
CREATE INDEX referral_attributions_referee_idx ON referral_attributions (referee_id);
CREATE INDEX referral_attributions_review_idx
  ON referral_attributions (review_status) WHERE review_status = 'FLAGGED';

-- Attribution posée À LA CRÉATION du compte (même transaction SQL, même instant) : un compte
-- existant ne devient jamais filleul ; le parrain existait avant le filleul.
CREATE FUNCTION referral_attributions_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  referee_created timestamptz;
  referrer_created timestamptz;
BEGIN
  -- `xmin` : le compte du filleul a été écrit par CETTE transaction (création en cours).
  SELECT created_at INTO referee_created FROM users
   WHERE id = NEW.referee_id AND xmin = pg_current_xact_id()::xid;
  SELECT created_at INTO referrer_created FROM users WHERE id = NEW.referrer_id;
  IF referee_created IS NULL OR referee_created IS DISTINCT FROM NEW.attributed_at THEN
    RAISE EXCEPTION 'attribution % : seul un compte en cours de création peut être parrainé', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF referrer_created IS NULL OR referrer_created > referee_created THEN
    RAISE EXCEPTION 'attribution % : parrain postérieur au filleul', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER referral_attributions_insert_guard
  BEFORE INSERT ON referral_attributions
  FOR EACH ROW EXECUTE FUNCTION referral_attributions_insert_guard();

-- Parrain verrouillé : aucune mise à jour ne change l'attribution ni ne retire une
-- qualification ; aucune suppression.
CREATE FUNCTION referral_attributions_update_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attribution % : suppression interdite', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.referrer_id IS DISTINCT FROM OLD.referrer_id
     OR NEW.referee_id IS DISTINCT FROM OLD.referee_id
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.attributed_at IS DISTINCT FROM OLD.attributed_at THEN
    RAISE EXCEPTION 'attribution % : le parrain est verrouillé', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.qualified_at IS NOT NULL AND (
       NEW.qualified_at IS DISTINCT FROM OLD.qualified_at
       OR NEW.qualification_rules_version IS DISTINCT FROM OLD.qualification_rules_version
       OR NEW.qualification_total IS DISTINCT FROM OLD.qualification_total) THEN
    RAISE EXCEPTION 'attribution % : qualification déjà acquise', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER referral_attributions_update_guard
  BEFORE UPDATE OR DELETE ON referral_attributions
  FOR EACH ROW EXECUTE FUNCTION referral_attributions_update_guard();

-- 4. Compte de jeu : récompense de parrainage ---------------------------------------------------

ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_kind_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check
  CHECK (kind IN ('deposit', 'withdrawal', 'tournament_entry', 'tournament_prize',
                  'game_stake', 'game_winnings', 'referral_reward'));

-- 5. Récompenses : une ligne par palier, créditée une seule fois --------------------------------

CREATE TABLE referral_rewards (
  id                    uuid        PRIMARY KEY,
  campaign_id           uuid        NOT NULL REFERENCES referral_campaigns (id),
  referrer_id           uuid        NOT NULL REFERENCES users (id),
  -- Rang du palier (1 = premier palier complet).
  tier                  integer     NOT NULL CHECK (tier >= 1),
  rules_version         integer     NOT NULL,
  -- Filleuls qualifiés cumulés exigés pour ce palier (palier précédent + taille du palier).
  referrals_required    integer     NOT NULL CHECK (referrals_required >= 1),
  amount                bigint      NOT NULL CHECK (amount > 0),
  status                text        NOT NULL CHECK (status IN ('CREDITED')),
  wallet_transaction_id uuid        NOT NULL UNIQUE REFERENCES wallet_transactions (id),
  idempotency_key       text        NOT NULL UNIQUE,
  -- Filleuls comptés au moment du crédit (audit).
  counted_referee_ids   uuid[]      NOT NULL,
  credited_at           timestamptz NOT NULL,
  CONSTRAINT referral_rewards_tier_once UNIQUE (campaign_id, referrer_id, tier),
  CONSTRAINT referral_rewards_rules FOREIGN KEY (campaign_id, rules_version)
    REFERENCES referral_rule_versions (campaign_id, version)
);

CREATE INDEX referral_rewards_referrer_idx ON referral_rewards (campaign_id, referrer_id, tier);
CREATE INDEX referral_rewards_credited_idx ON referral_rewards (credited_at DESC);

CREATE FUNCTION referral_rewards_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'récompense de parrainage % : ni modification ni suppression', OLD.id
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER referral_rewards_immutable
  BEFORE UPDATE OR DELETE ON referral_rewards
  FOR EACH ROW EXECUTE FUNCTION referral_rewards_immutable();

-- Un crédit `referral_reward` n'existe que comme preuve d'une récompense du même joueur, du même
-- montant et de la même clé : vérifié à la FIN de la transaction (crédit et récompense écrits
-- ensemble). Aucun autre chemin ne peut créditer des jetons « de parrainage ».
CREATE FUNCTION referral_reward_requires_tier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM referral_rewards r
        WHERE r.wallet_transaction_id = NEW.id AND r.referrer_id = NEW.user_id
          AND r.amount = NEW.tokens AND r.idempotency_key = NEW.idempotency_key) THEN
    RAISE EXCEPTION 'crédit de parrainage % sans palier enregistré', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_transactions_referral_reward_guard
  AFTER INSERT ON wallet_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.kind = 'referral_reward')
  EXECUTE FUNCTION referral_reward_requires_tier();

-- 6. File d'évaluation (boîte d'envoi durable) --------------------------------------------------

-- Un achat confirmé d'un filleul inscrit son parrain ici, DANS la transaction du règlement :
-- rien n'est perdu (redémarrage, plusieurs instances, notification rejouée). Le traitement relit
-- tout depuis le registre ; une ligne n'est retirée que si son `seq` n'a pas changé entre-temps.
CREATE SEQUENCE referral_evaluation_seq AS bigint;

CREATE TABLE referral_evaluation_queue (
  referrer_id     uuid        PRIMARY KEY REFERENCES users (id),
  seq             bigint      NOT NULL,
  enqueued_at     timestamptz NOT NULL,
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error      text        CHECK (char_length(last_error) <= 500),
  last_attempt_at timestamptz
);

CREATE INDEX referral_evaluation_queue_order_idx ON referral_evaluation_queue (enqueued_at, seq);

-- Observation seule : l'achat n'est ni lu ni modifié, seul son parrain est inscrit.
CREATE FUNCTION referral_enqueue_on_confirmed_deposit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'deposit' AND NEW.status = 'succeeded'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'succeeded') THEN
    INSERT INTO referral_evaluation_queue (referrer_id, seq, enqueued_at)
    SELECT a.referrer_id, nextval('referral_evaluation_seq'), now()
      FROM referral_attributions a WHERE a.referee_id = NEW.user_id
    ON CONFLICT (referrer_id) DO UPDATE
      SET seq = EXCLUDED.seq, enqueued_at = EXCLUDED.enqueued_at;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER wallet_transactions_referral_enqueue
  AFTER INSERT OR UPDATE OF status ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION referral_enqueue_on_confirmed_deposit();

-- 7. Notification et audit ----------------------------------------------------------------------

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'TOURNAMENT_APPROVED', 'TOURNAMENT_REGISTRATION_CONFIRMED', 'TOURNAMENT_CANCELLED',
  'TOURNAMENT_STARTED', 'TOURNAMENT_RESULTS_AVAILABLE', 'TOURNAMENT_PRIZE_CREDITED',
  'TOURNAMENT_TABLE_CLOSED', 'MODERATION_WARNING', 'COMPLAINT_UPDATE',
  'TOURNAMENT_THANK_YOU', 'REFERRAL_REWARD_CREDITED'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (
  'ALERT_STATUS_CHANGED', 'DETECTION_ENABLED', 'DETECTION_DISABLED',
  'TOURNAMENT_CREATED', 'TOURNAMENT_UPDATED', 'TOURNAMENT_APPROVED', 'TOURNAMENT_REJECTED',
  'TOURNAMENT_CANCELLED', 'TOURNAMENT_SETTINGS_UPDATED',
  'ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGIN_FAILED', 'ADMIN_LOGOUT', 'ADMIN_SESSION_EXPIRED',
  'USER_VIEWED', 'PAYMENT_VIEWED', 'PAYMENT_VERIFICATION_REQUESTED', 'REPORT_EXPORTED',
  'GAME_COMMISSION_UPDATED',
  'WITHDRAWAL_LIMIT_UPDATED', 'WITHDRAWAL_VIEWED', 'WITHDRAWAL_VERIFICATION_REQUESTED',
  'WITHDRAWAL_ESCALATED', 'WITHDRAWAL_REFUND_PROPOSED', 'WITHDRAWAL_REFUND_APPROVED',
  'WITHDRAWAL_REFUND_REJECTED',
  'PAYOUT_BENEFICIARY_CREATED', 'PAYOUT_BENEFICIARY_VERIFIED', 'PAYOUT_BENEFICIARY_DISABLED',
  'TREASURY_OBSERVED', 'PLATFORM_PAYOUT_CREATED', 'PLATFORM_PAYOUT_APPROVED',
  'PLATFORM_PAYOUT_REJECTED', 'PLATFORM_PAYOUT_CANCELLED', 'PLATFORM_PAYOUT_RELEASED',
  'PLATFORM_PAYOUT_VIEWED', 'PLATFORM_PAYOUT_RECONCILED',
  'USER_DISABLED', 'USER_ENABLED', 'USER_SUSPENDED', 'USER_SUSPENSION_LIFTED',
  'USER_SESSIONS_REVOKED', 'USER_WARNED', 'USER_CHAT_RESTRICTED',
  'USER_CHAT_RESTRICTION_LIFTED', 'USER_NOTE_ADDED', 'USER_NOTE_DELETED',
  'COMPLAINT_VIEWED', 'COMPLAINT_ATTACHMENT_VIEWED', 'COMPLAINT_REPLIED',
  'COMPLAINT_NOTE_ADDED', 'COMPLAINT_INFO_REQUESTED', 'COMPLAINT_ASSIGNED',
  'COMPLAINT_STATUS_CHANGED', 'COMPLAINT_PRIORITY_CHANGED',
  'PLAYER_ACCOUNT_RECOVERY',
  'REFERRAL_RULES_UPDATED', 'REFERRAL_CAMPAIGN_SUSPENDED', 'REFERRAL_CAMPAIGN_ACTIVATED',
  'REFERRAL_ATTRIBUTION_REVIEWED', 'REFERRAL_REEVALUATION_REQUESTED', 'REFERRAL_REFERRER_VIEWED'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_type_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_type_check CHECK (target_type IN (
  'DETECTION_ALERT', 'SYSTEM_SETTING', 'TOURNAMENT',
  'ADMIN_ACCOUNT', 'ADMIN_SESSION', 'USER', 'PAYMENT', 'REPORT', 'WITHDRAWAL',
  'PLATFORM_PAYOUT', 'PAYOUT_BENEFICIARY', 'TREASURY', 'COMPLAINT',
  'REFERRAL_CAMPAIGN', 'REFERRAL_ATTRIBUTION'));
