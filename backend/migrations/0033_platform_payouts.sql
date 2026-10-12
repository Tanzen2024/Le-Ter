-- Retraits des revenus de la PLATEFORME vers MTN Mobile Money Cameroun (D-078).
--
-- Flux distinct des retraits des joueurs (D-075) : il ne touche ni aux comptes de jeu, ni aux
-- mises, ni aux commissions. Trois notions séparées :
--
-- 1. Comptabilité : `platform_ledger` (recettes, entrées seulement) n'est PAS modifié. Les
--    retraits exécutés sont tracés ici (`platform_payouts`) et DÉDUITS au calcul du revenu
--    distribuable ; aucune ligne négative ni « sortie » n'est ajoutée au journal des recettes,
--    dont les sommes restent des recettes (tableau de bord, rapports, compte de la plateforme).
-- 2. Trésorerie : `treasury_observations` conserve chaque relecture du solde disponible chez
--    CinetPay (`GET /v1/balances`), avec source, date, devise et statut. Jamais saisie à la main.
-- 3. Retraits : `platform_payouts` (demande → approbation par un AUTRE administrateur →
--    réservation → exécution contrôlée → statut final relu chez CinetPay) et
--    `platform_payout_events` (historique en ajout seul).
--
-- Ajouts seulement : aucune donnée existante n'est modifiée. Retour arrière tant qu'aucun
-- retrait n'a été exécuté : DROP des quatre tables et restauration des CHECK du journal
-- d'audit de 0032. Après un retrait exécuté : ne pas revenir en arrière (faits financiers).

-- 1. Bénéficiaires autorisés -------------------------------------------------------------------

CREATE TABLE platform_payout_beneficiaries (
  id               uuid        PRIMARY KEY,
  label            text        NOT NULL CHECK (char_length(label) BETWEEN 3 AND 80),
  -- MTN Mobile Money Cameroun seulement (périmètre D-078).
  operator         text        NOT NULL CHECK (operator = 'MTN_CM'),
  -- Numéro complet, nécessaire au transfert ; JAMAIS renvoyé par l'API ni journalisé.
  msisdn           text        NOT NULL CHECK (msisdn ~ '^\+2376[0-9]{8}$'),
  msisdn_masked    text        NOT NULL,
  status           text        NOT NULL
    CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'DISABLED')),
  created_by       uuid        NOT NULL REFERENCES users (id),
  created_at       timestamptz NOT NULL,
  -- Vérification hors système (titulaire du compte MTN), attestée par un AUTRE administrateur.
  verified_by      uuid        REFERENCES users (id),
  verified_at      timestamptz,
  verification_note text       CHECK (verification_note IS NULL OR char_length(verification_note) <= 500),
  disabled_by      uuid        REFERENCES users (id),
  disabled_at      timestamptz,
  CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
  CHECK (verified_by IS NULL OR verified_by <> created_by),
  CHECK (status <> 'ACTIVE' OR verified_by IS NOT NULL),
  CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);

-- Un même numéro n'est enregistré qu'une fois tant qu'il n'est pas désactivé.
CREATE UNIQUE INDEX platform_payout_beneficiaries_msisdn_live
  ON platform_payout_beneficiaries (msisdn) WHERE status <> 'DISABLED';

-- 2. Trésorerie observée -----------------------------------------------------------------------

CREATE TABLE treasury_observations (
  id               uuid        PRIMARY KEY,
  -- Ordre d'enregistrement strict : la DERNIÈRE relecture fait foi, même à la même milliseconde.
  seq              bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  -- Seule source acceptée : l'API CinetPay (aucune saisie manuelle ne confirme un solde).
  source           text        NOT NULL CHECK (source IN ('CINETPAY_API')),
  environment      text        NOT NULL CHECK (environment IN ('test', 'live')),
  -- VALID : montant entier en XAF lu ; INVALID : réponse inexploitable (devise, format) ;
  -- ERROR : CinetPay injoignable ou refus (aucun montant).
  status           text        NOT NULL CHECK (status IN ('VALID', 'INVALID', 'ERROR')),
  available_amount bigint      CHECK (available_amount IS NULL OR available_amount >= 0),
  currency         text,
  error_code       text        CHECK (error_code IS NULL OR char_length(error_code) <= 80),
  -- Administrateur à l'origine de la relecture ; NULL : relecture système.
  requested_by     uuid        REFERENCES users (id),
  observed_at      timestamptz NOT NULL,
  CHECK (status <> 'VALID' OR (available_amount IS NOT NULL AND currency = 'XAF' AND error_code IS NULL)),
  CHECK (status = 'VALID' OR error_code IS NOT NULL)
);

CREATE INDEX treasury_observations_valid_idx ON treasury_observations (seq DESC) WHERE status = 'VALID';

-- 3. Retraits des revenus de la plateforme -----------------------------------------------------

CREATE TABLE platform_payouts (
  id                      uuid        PRIMARY KEY,
  -- Référence marchande transmise à CinetPay : 'LP' + 26 hex (≤ 30, SDK), jamais réutilisée.
  merchant_transaction_id text        NOT NULL UNIQUE
    CHECK (merchant_transaction_id ~ '^LP[0-9a-f]{26}$'),
  beneficiary_id          uuid        NOT NULL REFERENCES platform_payout_beneficiaries (id),
  operator                text        NOT NULL CHECK (operator = 'MTN_CM'),
  msisdn_masked           text        NOT NULL,
  -- Montant demandé (XAF entiers). Bornes d'un transfert CinetPay v1 (SDK : 100 à 1 500 000).
  amount                  bigint      NOT NULL CHECK (amount BETWEEN 100 AND 1500000),
  currency                text        NOT NULL CHECK (currency = 'XAF'),
  -- Frais estimés à la création (barème configuré) ; frais et montant DÉFINITIFS relus chez
  -- CinetPay quand ils sont renvoyés.
  estimated_fee           bigint      NOT NULL CHECK (estimated_fee >= 0),
  final_amount            bigint      CHECK (final_amount IS NULL OR final_amount >= 0),
  final_fee               bigint      CHECK (final_fee IS NULL OR final_fee >= 0),
  purpose                 text        NOT NULL CHECK (char_length(purpose) BETWEEN 5 AND 200),
  status                  text        NOT NULL CHECK (status IN (
    'PENDING_APPROVAL', 'REJECTED', 'CANCELLED', 'RESERVED', 'READY', 'SUBMITTING',
    'PROCESSING', 'UNCERTAIN', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED')),
  initiated_by            uuid        NOT NULL REFERENCES users (id),
  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,
  approved_by             uuid        REFERENCES users (id),
  approved_at             timestamptz,
  released_by             uuid        REFERENCES users (id),
  released_at             timestamptz,
  decided_by              uuid        REFERENCES users (id),
  decision_note           text        CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  provider_reference      text        UNIQUE,
  provider_status         text,
  notify_token_hash       text,
  -- UN SEUL envoi par retrait, garanti par la base : aucun renvoi automatique, jamais.
  submission_attempts     smallint    NOT NULL DEFAULT 0 CHECK (submission_attempts BETWEEN 0 AND 1),
  submission_claimed_at   timestamptz,
  last_checked_at         timestamptz,
  not_found_checks        integer     NOT NULL DEFAULT 0 CHECK (not_found_checks >= 0),
  last_error_code         text        CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80),
  last_error_at           timestamptz,
  reconciliation_result   text        CHECK (reconciliation_result IS NULL OR char_length(reconciliation_result) <= 80),
  completed_at            timestamptz,
  version                 integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- En-tête Idempotency-Key de la création : un double envoi renvoie la même demande.
  creation_key            text        NOT NULL CHECK (char_length(creation_key) BETWEEN 8 AND 128),
  CONSTRAINT platform_payouts_creation_key_unique UNIQUE (initiated_by, creation_key),
  -- Séparation des responsabilités : l'initiateur n'approuve jamais sa propre demande.
  CHECK (approved_by IS NULL OR approved_by <> initiated_by),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (status IN ('PENDING_APPROVAL', 'REJECTED') OR status = 'CANCELLED' OR approved_by IS NOT NULL),
  CHECK ((status IN ('SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED')) = (completed_at IS NOT NULL)),
  CHECK (status NOT IN ('PROCESSING', 'SUCCEEDED') OR provider_reference IS NOT NULL),
  CHECK (status NOT IN ('REJECTED', 'CANCELLED') OR decided_by IS NOT NULL),
  CHECK (status <> 'REJECTED' OR decided_by <> initiated_by),
  -- Un retrait envoyé (ou dont l'envoi est en cours) ne peut plus être annulé.
  CHECK (status <> 'CANCELLED' OR submission_attempts = 0)
);

CREATE INDEX platform_payouts_created_idx ON platform_payouts (created_at DESC, id);
CREATE INDEX platform_payouts_open_idx ON platform_payouts (status, updated_at)
  WHERE status IN ('READY', 'SUBMITTING', 'PROCESSING', 'UNCERTAIN', 'RECONCILIATION_REQUIRED');

-- Données figées à la création : montant, devise, bénéficiaire, référence, initiateur, frais
-- estimés. Une demande approuvée ne peut donc jamais changer de montant.
CREATE FUNCTION platform_payouts_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency
     OR NEW.beneficiary_id <> OLD.beneficiary_id
     OR NEW.merchant_transaction_id <> OLD.merchant_transaction_id
     OR NEW.initiated_by <> OLD.initiated_by OR NEW.estimated_fee <> OLD.estimated_fee
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'platform_payouts : données figées à la création (retrait %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'platform_payouts : statut final immuable (retrait %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_payouts_immutable
  BEFORE UPDATE ON platform_payouts
  FOR EACH ROW EXECUTE FUNCTION platform_payouts_immutable();

-- Pas de suppression : un retrait est un fait financier.
CREATE FUNCTION platform_payout_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% est en ajout seul : % refusé', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER platform_payouts_no_delete
  BEFORE DELETE ON platform_payouts
  FOR EACH ROW EXECUTE FUNCTION platform_payout_no_delete();

-- 4. Historique des retraits (ajout seul) -------------------------------------------------------

CREATE TABLE platform_payout_events (
  id          uuid        PRIMARY KEY,
  -- Ordre d'écriture strict (plusieurs événements peuvent partager la même milliseconde).
  seq         bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  payout_id   uuid        NOT NULL REFERENCES platform_payouts (id),
  -- NULL : événement système (exécution, relecture, notification).
  actor_id    uuid        REFERENCES users (id),
  event       text        NOT NULL CHECK (char_length(event) BETWEEN 3 AND 60),
  from_status text,
  to_status   text,
  -- Codes, statuts et montants seulement : jamais de numéro, de jeton ni de secret.
  details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL
);

CREATE INDEX platform_payout_events_payout_idx ON platform_payout_events (payout_id, seq);

CREATE TRIGGER platform_payout_events_append_only
  BEFORE UPDATE OR DELETE ON platform_payout_events
  FOR EACH ROW EXECUTE FUNCTION platform_payout_no_delete();

-- 5. Journal d'audit -----------------------------------------------------------------------------

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
  'PLATFORM_PAYOUT_VIEWED', 'PLATFORM_PAYOUT_RECONCILED'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_type_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_type_check CHECK (target_type IN (
  'DETECTION_ALERT', 'SYSTEM_SETTING', 'TOURNAMENT',
  'ADMIN_ACCOUNT', 'ADMIN_SESSION', 'USER', 'PAYMENT', 'REPORT', 'WITHDRAWAL',
  'PLATFORM_PAYOUT', 'PAYOUT_BENEFICIARY', 'TREASURY'));
