-- Comptes et sessions d'authentification (D-029, R-10, R-15, R-32).
--
-- Aucun compte invité (R-10) : toute identité de joueur est une ligne de `users`.
-- Pas de solde, portefeuille ni transaction ici : ils viendront avec la phase Finance.

CREATE TABLE users (
  id             uuid        PRIMARY KEY,
  first_name     text        NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 50),
  last_name      text        NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 50),
  -- Normalisé en minuscules par l'application ; identifiant de connexion.
  email          text        NOT NULL CHECK (email = lower(email) AND char_length(email) <= 254),
  -- Pseudo visible en jeu (pas un identifiant de connexion). Casse conservée à
  -- l'affichage, unicité insensible à la casse (index ci-dessous).
  username       text        NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  -- Format international E.164 (« + » puis 8 à 15 chiffres).
  phone          text        NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Vérification par SMS à venir : aucun fournisseur n'est choisi.
  phone_verified boolean     NOT NULL DEFAULT false,
  password_hash  text        NOT NULL,
  -- Seul rôle défini aujourd'hui. Admin / Katika : R-09.
  role           text        NOT NULL DEFAULT 'user' CHECK (role IN ('user')),
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);

CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE UNIQUE INDEX users_phone_key ON users (phone);

-- Un jeton de rafraîchissement par ligne ; une rotation crée une nouvelle ligne dans
-- la même session (`session_id`). Seule l'empreinte SHA-256 du jeton est stockée.
CREATE TABLE refresh_tokens (
  id             uuid        PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id     uuid        NOT NULL,
  token_hash     text        NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text        CHECK (revoked_reason IN ('rotated', 'logout', 'new_login')),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CHECK (expires_at > created_at)
);

-- R-32 garanti par la base : au plus UN jeton non révoqué par utilisateur, donc au
-- plus une session active, même si l'application avait un défaut de concurrence.
CREATE UNIQUE INDEX refresh_tokens_one_active_per_user
  ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- Contrôle d'un access token (requireAuth) : la session est-elle encore active ?
CREATE INDEX refresh_tokens_session_id_idx ON refresh_tokens (session_id);
