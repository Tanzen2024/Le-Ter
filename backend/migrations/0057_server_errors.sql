-- Pannes du serveur regroupées pour le back-office (D-168) : les applications n'affichent plus
-- aucun message d'erreur système ; chaque réponse 5xx de l'API est condensée ici, UNE ligne par
-- panne distincte (méthode, route, statut, code, type d'erreur), avec son nombre d'occurrences.
--
-- Données de diagnostic seulement : jamais le corps, les en-têtes, un jeton ni un mot de passe.
-- Table volatile du point de vue métier : aucune autre table n'en dépend ; une écriture ratée ici
-- ne fait jamais échouer la requête qui a déjà répondu.

CREATE TABLE server_errors (
  -- Empreinte stable de la panne (SHA-256 hexadécimal de méthode, route, statut, code, type).
  fingerprint     text        PRIMARY KEY CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  method          text        NOT NULL CHECK (char_length(method) BETWEEN 1 AND 16),
  -- Route normalisée (identifiants remplacés par `:id`), jamais une URL avec paramètres.
  route           text        NOT NULL CHECK (char_length(route) BETWEEN 1 AND 300),
  status          integer     NOT NULL CHECK (status BETWEEN 500 AND 599),
  code            text        CHECK (code IS NULL OR char_length(code) <= 100),
  error_name      text        NOT NULL CHECK (char_length(error_name) BETWEEN 1 AND 200),
  -- Dernier message observé, tronqué.
  message         text        NOT NULL CHECK (char_length(message) <= 1000),
  occurrences     bigint      NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  first_seen_at   timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL CHECK (last_seen_at >= first_seen_at),
  last_request_id text        CHECK (last_request_id IS NULL OR char_length(last_request_id) <= 200),
  last_stack      text        CHECK (last_stack IS NULL OR char_length(last_stack) <= 8000)
);

CREATE INDEX server_errors_last_seen_idx ON server_errors (last_seen_at DESC);
