-- Rapprochement administratif des retraits bloqués (D-076).
--
-- Un retrait dont l'issue est inconnue (réponse ambiguë, refus annoncé à la création,
-- transfert introuvable) reste ouvert : il n'est JAMAIS remboursé automatiquement. Sa
-- libération passe par une demande de remboursement à DOUBLE VALIDATION :
--   1. un administrateur la propose, avec la référence de la confirmation écrite de CinetPay
--      et une justification ; le serveur relit le transfert (introuvable ou échec final exigé) ;
--   2. un AUTRE administrateur l'approuve ; le serveur relit de nouveau le transfert, puis
--      rembourse UNE fois (règlement idempotent du compte de jeu), dans la même transaction.
-- Aucune voie ne permet de déclarer un retrait réussi.
--
-- Ajouts seulement : aucune donnée existante n'est modifiée.

CREATE TABLE withdrawal_refund_requests (
  id                         uuid        PRIMARY KEY,
  withdrawal_id              uuid        NOT NULL REFERENCES withdrawals (id),
  status                     text        NOT NULL
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  -- Référence de la confirmation écrite du fournisseur (ticket, courriel) : jamais de secret.
  provider_ticket            text        NOT NULL CHECK (char_length(provider_ticket) BETWEEN 3 AND 100),
  justification              text        NOT NULL CHECK (char_length(justification) BETWEEN 20 AND 1000),
  proposed_by                uuid        NOT NULL REFERENCES users (id),
  proposed_at                timestamptz NOT NULL,
  -- Statut relu chez CinetPay à la proposition et à la décision (`NOT_FOUND`, `FAILED`…).
  provider_status_at_proposal text       NOT NULL,
  decided_by                 uuid        REFERENCES users (id),
  decided_at                 timestamptz,
  decision_note              text        CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  provider_status_at_decision text,
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CHECK ((status = 'PENDING') = (decided_by IS NULL)),
  -- Double validation : celui qui propose n'approuve jamais.
  CHECK (status <> 'APPROVED' OR decided_by <> proposed_by),
  CHECK (status <> 'APPROVED' OR provider_status_at_decision IS NOT NULL)
);

-- Une seule demande en attente et au plus UNE demande approuvée par retrait.
CREATE UNIQUE INDEX withdrawal_refund_requests_pending_idx
  ON withdrawal_refund_requests (withdrawal_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX withdrawal_refund_requests_approved_idx
  ON withdrawal_refund_requests (withdrawal_id) WHERE status = 'APPROVED';
CREATE INDEX withdrawal_refund_requests_withdrawal_idx
  ON withdrawal_refund_requests (withdrawal_id, proposed_at DESC);

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
  'WITHDRAWAL_REFUND_REJECTED'));
