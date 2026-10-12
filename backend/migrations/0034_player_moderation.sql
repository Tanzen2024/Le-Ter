-- Gestion des joueurs par l'administration (D-079, docs/admin/MODERATION.md).
--
-- 1. `user_sanctions` : mesures de modération d'un compte, dans UNE table.
--    - SUSPENSION : accès refusé (connexion, renouvellement, chaque requête), temporaire
--      (`ends_at`) ou indéterminée (`ends_at` NULL), levable. Distincte de la désactivation
--      administrative (`users.status`), que son expiration ne modifie jamais.
--    - CHAT_RESTRICTION : envoi de messages refusé dans le chat de partie (D-045).
--    - WARNING : avertissement ; `player_message` est le texte transmis au joueur par une
--      notification dans l'application (`notification_id`), `comment` reste interne.
--    Une mesure est « active » si elle n'est pas levée et que `ends_at` est NULL ou futur
--    (heure du serveur) : l'expiration ne demande ni minuteur ni écriture.
--    Lignes conservées : DELETE refusé ; UPDATE limité à la levée d'une mesure ouverte.
-- 2. `user_admin_notes` : notes internes de l'administration, jamais exposées au joueur.
--    Pas de modification : une correction = suppression LOGIQUE tracée + nouvelle note.
-- 3. `refresh_tokens.revoked_reason` : révocations de l'administration.
-- 4. `notifications.type` : avertissement de modération.
-- 5. Journal d'audit : actions de gestion des joueurs (cible USER).

-- 1. Mesures de modération ----------------------------------------------------------------------

CREATE TABLE user_sanctions (
  id              uuid        PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES users (id),
  kind            text        NOT NULL CHECK (kind IN ('SUSPENSION', 'CHAT_RESTRICTION', 'WARNING')),
  reason          text        NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  comment         text        CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 2000),
  player_message  text        CHECK (player_message IS NULL
                                     OR char_length(player_message) BETWEEN 1 AND 1000),
  notification_id uuid        REFERENCES notifications (id),
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz,
  created_by      uuid        NOT NULL REFERENCES users (id),
  created_at      timestamptz NOT NULL,
  idempotency_key text        UNIQUE CHECK (idempotency_key IS NULL
                                            OR char_length(idempotency_key) BETWEEN 8 AND 128),
  lifted_at       timestamptz,
  lifted_by       uuid        REFERENCES users (id),
  lift_reason     text        CHECK (lift_reason IS NULL OR char_length(lift_reason) BETWEEN 3 AND 500),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK ((lifted_at IS NULL) = (lifted_by IS NULL)),
  CHECK ((lifted_at IS NULL) = (lift_reason IS NULL)),
  CHECK (kind <> 'WARNING' OR (ends_at IS NULL AND lifted_at IS NULL)),
  CHECK (kind = 'WARNING' OR (player_message IS NULL AND notification_id IS NULL)),
  CHECK (notification_id IS NULL OR player_message IS NOT NULL)
);

-- Historique d'un joueur (pagination par date) et contrôle d'une mesure ouverte à chaque
-- requête authentifiée et à chaque message de chat.
CREATE INDEX user_sanctions_user_idx ON user_sanctions (user_id, created_at DESC, id);
CREATE INDEX user_sanctions_open_idx ON user_sanctions (user_id, kind, ends_at)
  WHERE lifted_at IS NULL AND kind <> 'WARNING';

CREATE FUNCTION user_sanctions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user_sanctions : suppression refusée' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Seule la levée d'une mesure ouverte est permise ; le reste de la ligne est figé.
  IF OLD.lifted_at IS NOT NULL
     OR NEW.lifted_at IS NULL
     OR (to_jsonb(NEW) - 'lifted_at' - 'lifted_by' - 'lift_reason')
        IS DISTINCT FROM (to_jsonb(OLD) - 'lifted_at' - 'lifted_by' - 'lift_reason') THEN
    RAISE EXCEPTION 'user_sanctions : seule la levée d''une mesure ouverte est permise'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_sanctions_guard
  BEFORE UPDATE OR DELETE ON user_sanctions
  FOR EACH ROW EXECUTE FUNCTION user_sanctions_guard();

-- 2. Notes internes -----------------------------------------------------------------------------

CREATE TABLE user_admin_notes (
  id              uuid        PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES users (id),
  author_id       uuid        NOT NULL REFERENCES users (id),
  body            text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at      timestamptz NOT NULL,
  idempotency_key text        UNIQUE CHECK (idempotency_key IS NULL
                                            OR char_length(idempotency_key) BETWEEN 8 AND 128),
  deleted_at      timestamptz,
  deleted_by      uuid        REFERENCES users (id),
  delete_reason   text        CHECK (delete_reason IS NULL
                                     OR char_length(delete_reason) BETWEEN 3 AND 500),
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)),
  CHECK ((deleted_at IS NULL) = (delete_reason IS NULL))
);

CREATE INDEX user_admin_notes_user_idx ON user_admin_notes (user_id, created_at DESC, id);

CREATE FUNCTION user_admin_notes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user_admin_notes : suppression physique refusée'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.deleted_at IS NOT NULL
     OR NEW.deleted_at IS NULL
     OR (to_jsonb(NEW) - 'deleted_at' - 'deleted_by' - 'delete_reason')
        IS DISTINCT FROM (to_jsonb(OLD) - 'deleted_at' - 'deleted_by' - 'delete_reason') THEN
    RAISE EXCEPTION 'user_admin_notes : seule la suppression logique est permise'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_admin_notes_guard
  BEFORE UPDATE OR DELETE ON user_admin_notes
  FOR EACH ROW EXECUTE FUNCTION user_admin_notes_guard();

-- 3. Révocations de l'administration ------------------------------------------------------------

ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_revoked_reason_check;
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_revoked_reason_check
  CHECK (revoked_reason IN (
    'rotated', 'logout', 'new_login', 'admin_revoked', 'account_disabled', 'account_suspended'));

-- 4. Notification d'avertissement ---------------------------------------------------------------

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'TOURNAMENT_APPROVED', 'TOURNAMENT_REGISTRATION_CONFIRMED', 'TOURNAMENT_CANCELLED',
  'TOURNAMENT_STARTED', 'TOURNAMENT_RESULTS_AVAILABLE', 'TOURNAMENT_PRIZE_CREDITED',
  'TOURNAMENT_TABLE_CLOSED', 'MODERATION_WARNING'));

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
  'PLATFORM_PAYOUT_VIEWED', 'PLATFORM_PAYOUT_RECONCILED',
  'USER_DISABLED', 'USER_ENABLED', 'USER_SUSPENDED', 'USER_SUSPENSION_LIFTED',
  'USER_SESSIONS_REVOKED', 'USER_WARNED', 'USER_CHAT_RESTRICTED',
  'USER_CHAT_RESTRICTION_LIFTED', 'USER_NOTE_ADDED', 'USER_NOTE_DELETED'));
