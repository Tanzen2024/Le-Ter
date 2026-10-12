-- Retraits Mobile Money (D-075) : compte de jeu → compte Mobile Money personnel du joueur
-- (numéro d'inscription, D-040), par l'API de TRANSFERT CinetPay v1 (`POST /v1/transfer`),
-- distincte de la collecte (`/v1/payment`).
--
-- 1. `withdrawals` : une ligne par retrait, 1–1 avec sa transaction `withdrawal` du compte de
--    jeu (débit à la création, remboursement unique en cas d'échec CONFIRMÉ). Le numéro
--    complet n'est jamais recopié : seulement sa forme masquée, pour l'historique.
--    Cycle : CREATED (débité, transfert non accepté ou issue de l'envoi inconnue)
--          → PROCESSING (accepté par CinetPay, référence connue)
--          → SUCCEEDED | FAILED (statut final relu chez CinetPay).
-- 2. Quota de retraits (paramètres `withdrawal_limit_count` et `withdrawal_limit_period`,
--    en minutes). Ligne absente OU valeur JSON `null` = illimité (∞), jamais `Infinity`.
-- 3. Journal d'audit : réglage du quota, consultation et revérification d'un retrait.
--
-- Ajouts seulement : aucune donnée existante n'est modifiée.

-- 1. Retraits ----------------------------------------------------------------------------------

CREATE TABLE withdrawals (
  id                      uuid        PRIMARY KEY,
  user_id                 uuid        NOT NULL REFERENCES users (id),
  wallet_transaction_id   uuid        NOT NULL UNIQUE REFERENCES wallet_transactions (id),
  provider                text        NOT NULL CHECK (provider IN ('cinetpay')),
  -- Opérateurs CinetPay en XAF (Cameroun) : Orange Money, MTN Mobile Money.
  operator                text        NOT NULL CHECK (operator IN ('OM_CM', 'MTN_CM')),
  -- Forme affichable seulement (« +23*******271 ») ; le numéro complet reste dans `users`.
  msisdn_masked           text        NOT NULL,
  tokens                  bigint      NOT NULL CHECK (tokens >= 1000),
  -- Montant envoyé, en FCFA (1 jeton = 1 FCFA pour le retrait, D-075).
  amount                  bigint      NOT NULL CHECK (amount > 0),
  currency                text        NOT NULL CHECK (currency = 'XAF'),
  status                  text        NOT NULL
    CHECK (status IN ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  -- Référence marchande unique, réutilisée telle quelle à chaque relecture : CinetPay répond
  -- TRANSACTION_EXIST à un doublon, jamais un second transfert.
  merchant_transaction_id text        NOT NULL
    CHECK (char_length(merchant_transaction_id) BETWEEN 1 AND 30),
  provider_reference      text,
  provider_status         text,
  -- Frais annoncés par CinetPay (à la charge du compte marchand), s'ils sont renvoyés.
  fee_amount              numeric(18, 2) CHECK (fee_amount >= 0),
  -- SHA-256 hexadécimal du `notify_token` : jamais le jeton en clair.
  notify_token_hash       text        CHECK (notify_token_hash ~ '^[0-9a-f]{64}$'),
  failure_code            text,
  -- Dernière erreur technique (nom et code seulement, jamais de secret ni de numéro).
  last_error_code         text,
  last_error_at           timestamptz,
  -- Posé AVANT l'appel au fournisseur : un retrait CREATED avec cette date a une issue
  -- d'envoi inconnue et n'est jamais renvoyé à l'aveugle.
  submission_attempted_at timestamptz,
  -- Envois revendiqués (UPDATE conditionnel) : un seul processus envoie à la fois, et
  -- toujours avec la MÊME référence marchande.
  submission_attempts     integer     NOT NULL DEFAULT 0 CHECK (submission_attempts >= 0),
  last_checked_at         timestamptz,
  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,
  completed_at            timestamptz,
  CONSTRAINT withdrawals_merchant_transaction_unique UNIQUE (provider, merchant_transaction_id),
  CONSTRAINT withdrawals_provider_reference_unique UNIQUE (provider, provider_reference),
  CHECK ((status IN ('SUCCEEDED', 'FAILED')) = (completed_at IS NOT NULL)),
  CHECK ((status = 'FAILED') = (failure_code IS NOT NULL)),
  CHECK (status NOT IN ('PROCESSING', 'SUCCEEDED') OR provider_reference IS NOT NULL)
);

-- Historique du joueur et quota (fenêtre glissante sur les retraits non échoués).
CREATE INDEX withdrawals_user_created_idx ON withdrawals (user_id, created_at DESC);
CREATE INDEX withdrawals_quota_idx ON withdrawals (user_id, created_at) WHERE status <> 'FAILED';
-- Réconciliation : retraits non finaux.
CREATE INDEX withdrawals_open_idx ON withdrawals (last_checked_at NULLS FIRST, created_at)
  WHERE status IN ('CREATED', 'PROCESSING');
-- Listes administratives.
CREATE INDEX withdrawals_created_idx ON withdrawals (created_at DESC, id);

-- 2. Quota de retraits -------------------------------------------------------------------------

ALTER TABLE system_settings DROP CONSTRAINT system_settings_key_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_check CHECK (key IN (
  'detection_enabled', 'tournament_platform_fee_percent', 'initial_tournament_tokens',
  'default_tournament_stake', 'maximum_pending_tournaments_per_player',
  'tournament_transition_minutes', 'tournament_ranking_tokens_weight_percent',
  'tournament_ranking_games_weight_percent', 'tournament_initial_tokens_coefficient',
  'tournament_stake_per_game_coefficient', 'game_commission_schedule',
  'withdrawal_limit_count', 'withdrawal_limit_period'));

-- Quota : JSON `null` (illimité) ou entier ≥ 1. CASE imbriqués : la conversion numérique
-- n'est évaluée que pour un nombre JSON.
ALTER TABLE system_settings DROP CONSTRAINT system_settings_value_type_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_value_type_check CHECK (
  CASE key
    WHEN 'detection_enabled' THEN jsonb_typeof(value) = 'boolean'
    WHEN 'game_commission_schedule' THEN jsonb_typeof(value) = 'array'
    WHEN 'withdrawal_limit_count' THEN
      CASE jsonb_typeof(value)
        WHEN 'null' THEN true
        WHEN 'number' THEN (value::text)::numeric >= 1
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    WHEN 'withdrawal_limit_period' THEN
      CASE jsonb_typeof(value)
        WHEN 'null' THEN true
        WHEN 'number' THEN (value::text)::numeric >= 1
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    ELSE jsonb_typeof(value) = 'number'
  END);

-- 3. Journal d'audit ---------------------------------------------------------------------------

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (
  'ALERT_STATUS_CHANGED', 'DETECTION_ENABLED', 'DETECTION_DISABLED',
  'TOURNAMENT_CREATED', 'TOURNAMENT_UPDATED', 'TOURNAMENT_APPROVED', 'TOURNAMENT_REJECTED',
  'TOURNAMENT_CANCELLED', 'TOURNAMENT_SETTINGS_UPDATED',
  'ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGIN_FAILED', 'ADMIN_LOGOUT', 'ADMIN_SESSION_EXPIRED',
  'USER_VIEWED', 'PAYMENT_VIEWED', 'PAYMENT_VERIFICATION_REQUESTED', 'REPORT_EXPORTED',
  'GAME_COMMISSION_UPDATED',
  'WITHDRAWAL_LIMIT_UPDATED', 'WITHDRAWAL_VIEWED', 'WITHDRAWAL_VERIFICATION_REQUESTED'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_type_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_type_check CHECK (target_type IN (
  'DETECTION_ALERT', 'SYSTEM_SETTING', 'TOURNAMENT',
  'ADMIN_ACCOUNT', 'ADMIN_SESSION', 'USER', 'PAYMENT', 'REPORT', 'WITHDRAWAL'));
