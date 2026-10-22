-- Email facultatif des joueurs, code de récupération et réinitialisation du mot de passe (D-135).
--
-- 1. `users.email` devient facultatif pour un joueur (`role = 'user'`) : téléphone obligatoire,
--    email absent = NULL (jamais d'adresse inventée). Un administrateur garde un email
--    obligatoire (contrainte en base). L'index unique `users_email_key` est conservé : plusieurs
--    NULL y sont permis, deux emails identiques non.
-- 2. Code de récupération d'un joueur : seule son empreinte bcrypt est stockée, jamais le code.
--    Un seul code actif par compte (`recovery_code_hash` non NULL) ; utilisé ou remplacé, il
--    n'est plus valable. Échecs comptés EN BASE (tous serveurs confondus) : au-delà du seuil,
--    blocage temporaire (`recovery_locked_until`).
-- 3. `password_reset_grants` : autorisation temporaire, à usage unique, donnée après un code
--    valide ; seule l'empreinte SHA-256 du jeton est stockée.
-- 4. `refresh_tokens.revoked_reason` : sessions fermées par une réinitialisation.
-- 5. `admin_audit_log` : action PLAYER_ACCOUNT_RECOVERY (récupération par l'assistance).
--
-- Comptes existants : aucune ligne modifiée (tous ont un email ; aucun n'a encore de code).

-- 1. Email ---------------------------------------------------------------------------------------

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_admin_email_required CHECK (role <> 'admin' OR email IS NOT NULL);

-- 2. Code de récupération -----------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN recovery_code_hash       text,
  ADD COLUMN recovery_code_created_at timestamptz,
  ADD COLUMN recovery_code_used_at    timestamptz,
  ADD COLUMN recovery_failed_attempts integer NOT NULL DEFAULT 0
    CHECK (recovery_failed_attempts >= 0),
  ADD COLUMN recovery_locked_until    timestamptz,
  ADD CONSTRAINT users_recovery_code_created
    CHECK (recovery_code_hash IS NULL OR recovery_code_created_at IS NOT NULL);

-- 3. Autorisations de réinitialisation ----------------------------------------------------------

CREATE TABLE password_reset_grants (
  id          uuid        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text        NOT NULL,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CHECK (expires_at > created_at),
  CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE UNIQUE INDEX password_reset_grants_token_key ON password_reset_grants (token_hash);
CREATE INDEX password_reset_grants_user_idx ON password_reset_grants (user_id)
  WHERE used_at IS NULL;

-- 4. Sessions fermées par une réinitialisation --------------------------------------------------

ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_revoked_reason_check;
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_revoked_reason_check
  CHECK (revoked_reason IN (
    'rotated', 'logout', 'new_login', 'admin_revoked', 'account_disabled', 'account_suspended',
    'password_reset'));

-- 5. Audit de la récupération par l'assistance --------------------------------------------------

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
  'PLAYER_ACCOUNT_RECOVERY'));
