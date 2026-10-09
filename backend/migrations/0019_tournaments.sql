-- Tournois, première version (D-051, R-11 partiellement tranché).
--
-- Le statut SCHEDULED / IN_PROGRESS / COMPLETED n'est PAS enregistré : le serveur le calcule
-- à partir de son horloge et de la période [starts_at, ends_at). Seule l'annulation
-- (CANCELLED) est une donnée. Aucune ligne n'est jamais supprimée (historique).

CREATE TABLE tournaments (
  id           uuid        PRIMARY KEY,
  name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description  text        CHECK (char_length(description) <= 500),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  -- Nombre maximal d'inscrits ; NULL : sans limite.
  max_players  integer     CHECK (max_players > 0),
  cancelled_at timestamptz,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX tournaments_period_idx ON tournaments (ends_at, starts_at)
  WHERE cancelled_at IS NULL;

-- Inscription gratuite (D-051). `status` prépare de futurs frais d'inscription (R-13) :
-- seule valeur aujourd'hui, REGISTERED.
CREATE TABLE tournament_registrations (
  id            uuid        PRIMARY KEY,
  tournament_id uuid        NOT NULL REFERENCES tournaments (id),
  user_id       uuid        NOT NULL REFERENCES users (id),
  status        text        NOT NULL CHECK (status IN ('REGISTERED')),
  registered_at timestamptz NOT NULL,
  -- Pas de double inscription, même en concurrence.
  CONSTRAINT tournament_registrations_unique UNIQUE (tournament_id, user_id)
);

CREATE INDEX tournament_registrations_user_idx ON tournament_registrations (user_id);

-- Tables (sessions D-033) ouvertes pour un tournoi. Les parties restent rattachées à leur
-- session (`games.session_id`) : tournoi → session → parties (gameId).
CREATE TABLE tournament_sessions (
  id            uuid        PRIMARY KEY,
  tournament_id uuid        NOT NULL REFERENCES tournaments (id),
  session_id    uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL,
  -- Une session appartient à au plus un tournoi.
  CONSTRAINT tournament_sessions_session_unique UNIQUE (session_id)
);

CREATE INDEX tournament_sessions_tournament_idx ON tournament_sessions (tournament_id, created_at);
