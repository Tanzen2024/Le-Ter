-- Plateforme d'administration (D-061, docs/admin/SECURITY.md).
--
-- 1. Durée absolue d'une session d'authentification : `refresh_tokens.session_expires_at`.
--    NULL pour les sessions des joueurs (comportement inchangé). Pour une session
--    d'administration, aucune rotation ne prolonge un jeton au-delà de cette borne (8 h).
-- 2. `admin_sessions` : session d'administration rattachée à une session d'authentification
--    (`refresh_tokens.session_id`). Durée absolue et inactivité contrôlées par le serveur à
--    chaque requête /api/admin/*.
-- 3. Journal d'audit : résultat de l'action (`outcome`), échec de connexion sur un compte
--    inconnu (acteur absent, seulement pour ADMIN_LOGIN_FAILED), nouvelles actions et cibles.
--    Lignes immuables : UPDATE et DELETE refusés par déclencheur. Limite : un rôle
--    propriétaire de la table peut désactiver le déclencheur ou exécuter TRUNCATE ; une
--    protection complète exige un rôle SQL applicatif sans ces droits (infrastructure).
--    Jamais de mot de passe, jeton, IP, email ni donnée de paiement sensible dans `details`.
-- 4. Index des listes administratives globales (tri par date).

-- 1. Durée absolue d'une session -------------------------------------------------------------

ALTER TABLE refresh_tokens ADD COLUMN session_expires_at timestamptz;
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_session_expiry_check
  CHECK (session_expires_at IS NULL OR expires_at <= session_expires_at);

-- 2. Sessions d'administration ----------------------------------------------------------------

CREATE TABLE admin_sessions (
  -- Identifiant de la session d'authentification (claim `sid` du JWT).
  session_id       uuid        PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES users (id),
  started_at       timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  -- Borne absolue (started_at + 8 h), jamais repoussée.
  expires_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  end_reason       text        CHECK (end_reason IN (
    'LOGOUT', 'IDLE_TIMEOUT', 'ABSOLUTE_TIMEOUT', 'REPLACED')),
  CHECK (expires_at > started_at),
  CHECK (last_activity_at >= started_at),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

CREATE INDEX admin_sessions_user_idx ON admin_sessions (user_id, started_at DESC);
CREATE INDEX admin_sessions_open_idx ON admin_sessions (user_id) WHERE ended_at IS NULL;

-- 3. Journal d'audit ---------------------------------------------------------------------------

ALTER TABLE admin_audit_log ADD COLUMN outcome text NOT NULL DEFAULT 'SUCCESS'
  CHECK (outcome IN ('SUCCESS', 'FAILURE'));

ALTER TABLE admin_audit_log ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_actor_check
  CHECK (actor_id IS NOT NULL OR action = 'ADMIN_LOGIN_FAILED');

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (
  'ALERT_STATUS_CHANGED', 'DETECTION_ENABLED', 'DETECTION_DISABLED',
  'TOURNAMENT_CREATED', 'TOURNAMENT_UPDATED', 'TOURNAMENT_APPROVED', 'TOURNAMENT_REJECTED',
  'TOURNAMENT_CANCELLED', 'TOURNAMENT_SETTINGS_UPDATED',
  'ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGIN_FAILED', 'ADMIN_LOGOUT', 'ADMIN_SESSION_EXPIRED',
  'USER_VIEWED', 'PAYMENT_VIEWED', 'PAYMENT_VERIFICATION_REQUESTED', 'REPORT_EXPORTED'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_type_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_type_check CHECK (target_type IN (
  'DETECTION_ALERT', 'SYSTEM_SETTING', 'TOURNAMENT',
  'ADMIN_ACCOUNT', 'ADMIN_SESSION', 'USER', 'PAYMENT', 'REPORT'));

-- Cible sans identifiant : paramètre système, rapport, ou échec de connexion d'un compte
-- inconnu. Toute autre cible est désignée par son identifiant.
ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_id_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_id_check CHECK (
  CASE
    WHEN target_type IN ('SYSTEM_SETTING', 'REPORT') THEN target_id IS NULL
    WHEN action = 'ADMIN_LOGIN_FAILED' THEN true
    ELSE target_id IS NOT NULL
  END);

CREATE FUNCTION admin_audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log est en ajout seul : % refusé', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER admin_audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_immutable();

CREATE INDEX admin_audit_log_created_idx ON admin_audit_log (created_at DESC, id);
CREATE INDEX admin_audit_log_action_idx ON admin_audit_log (action, created_at DESC);

-- 4. Index des listes administratives --------------------------------------------------------

CREATE INDEX users_created_idx ON users (created_at DESC, id);
CREATE INDEX games_created_idx ON games (created_at DESC, id);
CREATE INDEX payments_created_idx ON payments (created_at DESC, id);
CREATE INDEX wallet_transactions_created_idx ON wallet_transactions (created_at DESC, id);
CREATE INDEX platform_ledger_created_idx ON platform_ledger (created_at DESC, id);
