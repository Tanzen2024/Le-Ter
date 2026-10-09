-- Administration de la détection (R-36, étape 5, D-049).
--
-- 1. Rôle `admin` ajouté au système de rôles EXISTANT (`users.role`). Rôle TECHNIQUE,
--    PROVISOIRE : il ne donne accès qu'à la consultation et au statut des alertes de
--    détection ; il n'est attribuable que par l'outil d'exploitation (`npm run user:role`),
--    jamais par une route. R-09 (Katika) reste à définir.
-- 2. Journal d'audit administratif, minimal et générique : qui, quoi, sur quelle cible,
--    quand, et un détail minimal (ex. ancien / nouveau statut). Jamais de jeton, de mot de
--    passe, d'IP, de position ni de donnée de jeu.
-- 3. Index de la liste paginée des alertes (tri par date, filtre par joueur).

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));

CREATE TABLE admin_audit_log (
  id          uuid        PRIMARY KEY,
  actor_id    uuid        NOT NULL REFERENCES users (id),
  action      text        NOT NULL CHECK (action IN ('ALERT_STATUS_CHANGED')),
  target_type text        NOT NULL CHECK (target_type IN ('DETECTION_ALERT')),
  target_id   uuid        NOT NULL,
  details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL
);

CREATE INDEX admin_audit_log_target_idx ON admin_audit_log (target_type, target_id, created_at);
CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log (actor_id, created_at DESC);

CREATE INDEX detection_alerts_created_idx ON detection_alerts (created_at DESC, id);
CREATE INDEX detection_alerts_players_idx ON detection_alerts USING gin (player_ids);
