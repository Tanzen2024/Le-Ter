-- Réclamations et assistant automatisé (D-114, docs/complaints.md). AJOUTS seulement : aucune
-- donnée existante n'est modifiée ni supprimée.
--
-- Une réclamation référence les parties, tournois et transactions concernés par clé étrangère :
-- aucun solde, montant ou résultat n'est recopié ici (les sources faisant autorité restent
-- `wallets`, `wallet_transactions`, `payments`, `withdrawals`, `games`, `tournament_results`).
-- Les vérifications (`complaint_checks`) sont la TRACE de ce qui a été consulté et constaté à
-- un instant donné, jamais une source financière.

-- 1. Conversations avec l'assistant automatisé ------------------------------------------------

CREATE TABLE support_conversations (
  id            uuid        PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES users (id),
  status        text        NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
  language      text        NOT NULL CHECK (language IN ('fr', 'en')),
  -- Messages du joueur (borne de coût : au-delà, l'assistant propose une réclamation).
  player_turns  integer     NOT NULL DEFAULT 0 CHECK (player_turns >= 0),
  -- Dernière analyse VALIDÉE (catégorie, identifiants vérifiés) : brouillon de réclamation.
  last_analysis jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  closed_at     timestamptz,
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

-- Une seule conversation active par joueur, même en concurrence.
CREATE UNIQUE INDEX support_conversations_one_active ON support_conversations (user_id)
  WHERE status = 'ACTIVE';
CREATE INDEX support_conversations_user_idx ON support_conversations (user_id, created_at DESC);

CREATE TABLE support_messages (
  id              uuid        PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES support_conversations (id) ON DELETE CASCADE,
  -- Ordre d'écriture stable (plusieurs messages peuvent partager le même instant).
  seq             bigint      GENERATED ALWAYS AS IDENTITY,
  role            text        NOT NULL CHECK (role IN ('PLAYER', 'ASSISTANT')),
  content         text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  -- Assistant : catégorie, outils exécutés, faits vérifiés, validation, mode dégradé. Jamais
  -- de secret, de jeton ni de donnée d'un autre joueur.
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Un renvoi du même message (coupure, double appui) ne crée rien de plus.
  idempotency_key text        CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  created_at      timestamptz NOT NULL,
  CONSTRAINT support_messages_once UNIQUE (conversation_id, idempotency_key)
);

CREATE INDEX support_messages_conversation_idx ON support_messages (conversation_id, seq);

-- 2. Réclamations -------------------------------------------------------------------------------

CREATE TABLE complaints (
  id                    uuid        PRIMARY KEY,
  -- Référence lisible, unique : RCL-AAAAMMJJ-XXXXXX (base 32 de Crockford).
  reference             text        NOT NULL UNIQUE
    CHECK (reference ~ '^RCL-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$'),
  user_id               uuid        NOT NULL REFERENCES users (id),
  category              text        NOT NULL CHECK (category IN (
    'GAME_RESULT', 'BALANCE', 'PAYMENT', 'WITHDRAWAL', 'TOURNAMENT', 'TOURNAMENT_REWARD',
    'TECHNICAL', 'FRAUD', 'ACCOUNT_SECURITY', 'OTHER')),
  -- Catégorie proposée par l'assistant (le joueur garde le dernier mot : `category`).
  suggested_category    text        CHECK (suggested_category IN (
    'GAME_RESULT', 'BALANCE', 'PAYMENT', 'WITHDRAWAL', 'TOURNAMENT', 'TOURNAMENT_REWARD',
    'TECHNICAL', 'FRAUD', 'ACCOUNT_SECURITY', 'OTHER')),
  title                 text        NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description           text        NOT NULL CHECK (char_length(description) BETWEEN 10 AND 4000),
  status                text        NOT NULL CHECK (status IN (
    'OPEN', 'AI_ANALYSIS', 'WAITING_FOR_PLAYER', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED')),
  priority              text        NOT NULL CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  -- Éléments concernés : n'y figurent que des éléments APPARTENANT au joueur (vérifié par le
  -- serveur à la création).
  game_id               uuid        REFERENCES games (id),
  tournament_id         uuid        REFERENCES tournaments (id),
  wallet_transaction_id uuid        REFERENCES wallet_transactions (id),
  payment_id            uuid        REFERENCES payments (id),
  withdrawal_id         uuid        REFERENCES withdrawals (id),
  conversation_id       uuid        REFERENCES support_conversations (id),
  -- Heure approximative de l'incident déclarée par le joueur (jamais une donnée vérifiée).
  incident_at           timestamptz,
  assigned_admin_id     uuid        REFERENCES users (id),
  -- Résumé AUTOMATISÉ, toujours présenté comme tel (jamais comme un fait vérifié).
  ai_summary            text        CHECK (char_length(ai_summary) <= 2000),
  ai_analysis_status    text        NOT NULL DEFAULT 'PENDING'
    CHECK (ai_analysis_status IN ('PENDING', 'COMPLETED', 'UNAVAILABLE')),
  -- Bail de l'analyse automatique : une seule instance analyse un dossier à la fois ; un bail
  -- expiré (instance arrêtée en pleine analyse) est repris par le balayage.
  analysis_claimed_at   timestamptz,
  decision              text        CHECK (char_length(decision) BETWEEN 10 AND 2000),
  decided_by            uuid        REFERENCES users (id),
  decided_at            timestamptz,
  -- Contestations d'une décision par le joueur (procédure bornée, D-114).
  reopen_count          integer     NOT NULL DEFAULT 0 CHECK (reopen_count BETWEEN 0 AND 2),
  idempotency_key       text        NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  version               integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL,
  closed_at             timestamptz,
  CONSTRAINT complaints_idempotency UNIQUE (user_id, idempotency_key),
  -- Une décision rendue (résolue ou rejetée) est toujours motivée.
  CHECK (status NOT IN ('RESOLVED', 'REJECTED') OR decision IS NOT NULL),
  CHECK ((decision IS NULL) = (decided_at IS NULL)),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

CREATE INDEX complaints_user_idx ON complaints (user_id, created_at DESC);
CREATE INDEX complaints_queue_idx ON complaints (status, priority, created_at);
CREATE INDEX complaints_assignee_idx ON complaints (assigned_admin_id) WHERE assigned_admin_id IS NOT NULL;
-- Reprise après redémarrage : dossiers dont l'analyse automatique n'est pas terminée.
CREATE INDEX complaints_pending_analysis_idx ON complaints (updated_at)
  WHERE ai_analysis_status = 'PENDING' AND status <> 'CLOSED';

-- 3. Échanges -----------------------------------------------------------------------------------

CREATE TABLE complaint_messages (
  id              uuid        PRIMARY KEY,
  complaint_id    uuid        NOT NULL REFERENCES complaints (id),
  seq             bigint      GENERATED ALWAYS AS IDENTITY,
  author_type     text        NOT NULL CHECK (author_type IN ('PLAYER', 'ADMIN', 'ASSISTANT', 'SYSTEM')),
  author_id       uuid        REFERENCES users (id),
  body            text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  -- INTERNAL : note entre administrateurs, jamais montrée au joueur.
  visibility      text        NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'INTERNAL')),
  idempotency_key text        CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  created_at      timestamptz NOT NULL,
  CONSTRAINT complaint_messages_once UNIQUE (complaint_id, author_id, idempotency_key),
  CHECK ((author_type IN ('PLAYER', 'ADMIN')) = (author_id IS NOT NULL)),
  CHECK (visibility = 'PUBLIC' OR author_type = 'ADMIN')
);

CREATE INDEX complaint_messages_complaint_idx ON complaint_messages (complaint_id, seq);

-- 4. Historique (ajout seul) --------------------------------------------------------------------

CREATE TABLE complaint_events (
  id           uuid        PRIMARY KEY,
  complaint_id uuid        NOT NULL REFERENCES complaints (id),
  -- Ordre d'écriture stable : plusieurs événements d'une même transaction partagent l'instant.
  seq          bigint      GENERATED ALWAYS AS IDENTITY,
  type         text        NOT NULL CHECK (type IN (
    'CREATED', 'STATUS_CHANGED', 'MESSAGE_ADDED', 'INFO_REQUESTED', 'ATTACHMENT_ADDED',
    'ASSIGNED', 'PRIORITY_CHANGED', 'DECISION_RECORDED', 'REOPENED', 'AI_ANALYSIS_COMPLETED',
    'AI_ANALYSIS_UNAVAILABLE')),
  actor_type   text        NOT NULL CHECK (actor_type IN ('PLAYER', 'ADMIN', 'ASSISTANT', 'SYSTEM')),
  actor_id     uuid        REFERENCES users (id),
  from_status  text,
  to_status    text,
  -- Identifiants, statuts et motifs seulement : ni secret, ni coordonnée, ni montant déclaré.
  details      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL,
  CHECK ((actor_type IN ('PLAYER', 'ADMIN')) = (actor_id IS NOT NULL))
);

CREATE INDEX complaint_events_complaint_idx ON complaint_events (complaint_id, seq);

CREATE FUNCTION complaint_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'complaint_events est en ajout seul : % refusé', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER complaint_events_no_update_delete
  BEFORE UPDATE OR DELETE ON complaint_events
  FOR EACH ROW EXECUTE FUNCTION complaint_events_immutable();

-- 5. Vérifications effectuées (trace, jamais source financière) ---------------------------------

CREATE TABLE complaint_checks (
  id           uuid        PRIMARY KEY,
  complaint_id uuid        NOT NULL REFERENCES complaints (id),
  tool         text        NOT NULL CHECK (char_length(tool) BETWEEN 1 AND 64),
  outcome      text        NOT NULL CHECK (outcome IN ('FOUND', 'NOT_FOUND', 'ERROR')),
  -- Faits constatés par l'outil serveur au moment de la vérification (données du joueur).
  facts        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source       text        NOT NULL CHECK (source IN ('ASSISTANT', 'SYSTEM')),
  created_at   timestamptz NOT NULL
);

CREATE INDEX complaint_checks_complaint_idx ON complaint_checks (complaint_id, created_at);

-- 6. Pièces justificatives ----------------------------------------------------------------------

-- Stockées dans PostgreSQL (pas de stockage de fichiers dans le projet) : taille et nombre
-- bornés, type vérifié sur le contenu (signature), aucun nom de fichier conservé.
CREATE TABLE complaint_attachments (
  id            uuid        PRIMARY KEY,
  complaint_id  uuid        NOT NULL REFERENCES complaints (id),
  uploader_type text        NOT NULL CHECK (uploader_type IN ('PLAYER', 'ADMIN')),
  uploader_id   uuid        NOT NULL REFERENCES users (id),
  content_type  text        NOT NULL
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes    integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 3145728),
  sha256        text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  data          bytea       NOT NULL,
  created_at    timestamptz NOT NULL,
  CONSTRAINT complaint_attachments_once UNIQUE (complaint_id, sha256),
  CHECK (octet_length(data) = size_bytes)
);

CREATE INDEX complaint_attachments_complaint_idx ON complaint_attachments (complaint_id, created_at);

-- 7. Notification « réclamation mise à jour » ---------------------------------------------------

-- Le contenu visible reste générique (référence et nature de l'événement) : aucun montant ni
-- donnée financière, même sur l'écran verrouillé.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'TOURNAMENT_APPROVED', 'TOURNAMENT_REGISTRATION_CONFIRMED', 'TOURNAMENT_CANCELLED',
  'TOURNAMENT_STARTED', 'TOURNAMENT_RESULTS_AVAILABLE', 'TOURNAMENT_PRIZE_CREDITED',
  'TOURNAMENT_TABLE_CLOSED', 'MODERATION_WARNING', 'COMPLAINT_UPDATE'));

-- 8. Journal d'audit administratif --------------------------------------------------------------

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
  'COMPLAINT_STATUS_CHANGED', 'COMPLAINT_PRIORITY_CHANGED'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_type_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_type_check CHECK (target_type IN (
  'DETECTION_ALERT', 'SYSTEM_SETTING', 'TOURNAMENT',
  'ADMIN_ACCOUNT', 'ADMIN_SESSION', 'USER', 'PAYMENT', 'REPORT', 'WITHDRAWAL',
  'PLATFORM_PAYOUT', 'PAYOUT_BENEFICIARY', 'TREASURY', 'COMPLAINT'));
