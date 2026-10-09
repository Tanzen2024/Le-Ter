-- Interrupteur GLOBAL de la détection anti-collusion (R-36, D-053).
--
-- 1. Paramètres système, minimal : une ligne par clé connue. Seule clé : `detection_enabled`
--    (booléen JSON). Ligne ABSENTE = détection désactivée (valeur par défaut : false).
--    La détection d'une partie exige ce paramètre ET `sessions.suspicion_detection_enabled`.
-- 2. Journal d'audit de l'étape 5 (0017) réutilisé : deux actions de plus, une cible
--    `SYSTEM_SETTING` sans identifiant (la clé du paramètre est dans `details`).

CREATE TABLE system_settings (
  key        text        PRIMARY KEY CHECK (key IN ('detection_enabled')),
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  CHECK (key <> 'detection_enabled' OR jsonb_typeof(value) = 'boolean')
);

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN ('ALERT_STATUS_CHANGED', 'DETECTION_ENABLED', 'DETECTION_DISABLED'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_type_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_type_check
  CHECK (target_type IN ('DETECTION_ALERT', 'SYSTEM_SETTING'));

-- Une alerte est toujours désignée par son identifiant ; un paramètre, jamais.
ALTER TABLE admin_audit_log ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_id_check
  CHECK ((target_type = 'DETECTION_ALERT') = (target_id IS NOT NULL));
