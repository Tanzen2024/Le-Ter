-- Tournois financiers (D-054) : réservation dans le compte de jeu, cycle de vie complet,
-- cagnotte et commission, jetons de tournoi, classement, gains et notifications.
--
-- Le compte de jeu (D-040) reste l'UNIQUE portefeuille : la réservation l'étend, elle ne le
-- double pas. Toute variation de `wallets.balance` reste une ligne de `wallet_transactions`.

-- 1. Compte de jeu : montant réservé et disponible = solde - réservé -----------------------

ALTER TABLE wallets ADD COLUMN reserved bigint NOT NULL DEFAULT 0;
ALTER TABLE wallets ADD CONSTRAINT wallets_reserved_check
  CHECK (reserved >= 0 AND reserved <= balance);

-- Capture d'une inscription (débit définitif) et gain de tournoi (crédit).
ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_kind_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check
  CHECK (kind IN ('deposit', 'withdrawal', 'tournament_entry', 'tournament_prize'));

-- 2. Tournoi : cycle de vie enregistré (la première version calculait le statut) -----------

ALTER TABLE tournaments RENAME COLUMN max_players TO maximum_players;
ALTER TABLE tournaments DROP CONSTRAINT tournaments_max_players_check;

ALTER TABLE tournaments
  ADD COLUMN status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED',
    'STARTING', 'IN_PROGRESS', 'CALCULATING_RESULTS', 'RESULTS_VALIDATED',
    'DISTRIBUTING_PRIZES', 'COMPLETED', 'CANCELLED')),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN creator_type text NOT NULL DEFAULT 'ADMIN' CHECK (creator_type IN ('ADMIN', 'PLAYER')),
  ADD COLUMN creator_id uuid REFERENCES users (id),
  ADD COLUMN timezone text NOT NULL DEFAULT 'Africa/Douala' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  ADD COLUMN entry_fee bigint NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  ADD COLUMN currency text NOT NULL DEFAULT 'XAF' CHECK (currency = 'XAF'),
  ADD COLUMN minimum_players integer NOT NULL DEFAULT 2 CHECK (minimum_players >= 2),
  -- Points de base (1000 = 10 %), copiés des paramètres à la publication, puis immuables.
  ADD COLUMN platform_fee_bps integer CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  ADD COLUMN initial_tournament_tokens integer NOT NULL DEFAULT 1000 CHECK (initial_tournament_tokens > 0),
  ADD COLUMN stake_per_game integer NOT NULL DEFAULT 100 CHECK (stake_per_game > 0),
  ADD COLUMN registration_opens_at timestamptz,
  ADD COLUMN registration_closes_at timestamptz,
  -- Fin + période de transition, figée à la publication : borne du non-chevauchement.
  ADD COLUMN blocked_until timestamptz,
  ADD COLUMN cancellation_reason text CHECK (cancellation_reason IN (
    'INSUFFICIENT_PLAYERS', 'ADMIN_CANCELLED', 'SYSTEM_ERROR', 'PAYMENT_ERROR',
    'APPROVAL_REJECTED', 'CREATOR_CANCELLED')),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES users (id),
  ADD COLUMN started_at timestamptz,
  ADD COLUMN results_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  -- Cagnotte figée au démarrage (jamais recalculée).
  ADD COLUMN participants integer CHECK (participants >= 0),
  ADD COLUMN gross_pool bigint CHECK (gross_pool >= 0),
  ADD COLUMN platform_fee bigint CHECK (platform_fee >= 0),
  ADD COLUMN prize_pool bigint CHECK (prize_pool >= 0),
  ADD COLUMN unallocated_prize bigint CHECK (unallocated_prize >= 0);

-- Tournois de la première version (D-051, gratuits, statut calculé) : clos sans effet
-- financier (aucune réservation n'a jamais existé).
UPDATE tournaments
   SET status = 'CANCELLED', cancellation_reason = 'SYSTEM_ERROR',
       cancelled_at = COALESCE(cancelled_at, now()), updated_at = now();

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_players_check CHECK (maximum_players IS NULL OR maximum_players >= minimum_players),
  ADD CONSTRAINT tournaments_cancel_check
    CHECK ((status = 'CANCELLED') = (cancellation_reason IS NOT NULL AND cancelled_at IS NOT NULL)),
  ADD CONSTRAINT tournaments_pool_check
    CHECK (gross_pool IS NULL OR gross_pool = platform_fee + prize_pool),
  ADD CONSTRAINT tournaments_published_check
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED')
           OR (published_at IS NOT NULL AND blocked_until IS NOT NULL AND platform_fee_bps IS NOT NULL
               AND registration_closes_at IS NOT NULL));

-- Aucun chevauchement entre tournois publiés non terminés (GiST natif sur tstzrange).
ALTER TABLE tournaments ADD CONSTRAINT tournaments_no_overlap
  EXCLUDE USING gist (tstzrange(starts_at, blocked_until, '[)') WITH &&)
  WHERE (status IN ('SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'STARTING',
                    'IN_PROGRESS', 'CALCULATING_RESULTS'));

CREATE INDEX tournaments_status_idx ON tournaments (status, starts_at);
CREATE INDEX tournaments_creator_idx ON tournaments (creator_id, status);

-- Répartition des gains : un pourcentage (points de base) par rang payé ; somme = 10000.
CREATE TABLE tournament_prize_rules (
  tournament_id uuid    NOT NULL REFERENCES tournaments (id),
  rank          integer NOT NULL CHECK (rank BETWEEN 1 AND 10),
  share_bps     integer NOT NULL CHECK (share_bps BETWEEN 1 AND 10000),
  PRIMARY KEY (tournament_id, rank)
);

-- 3. Inscriptions : désinscription possible avant la fermeture ------------------------------

ALTER TABLE tournament_registrations DROP CONSTRAINT tournament_registrations_status_check;
ALTER TABLE tournament_registrations ADD CONSTRAINT tournament_registrations_status_check
  CHECK (status IN ('REGISTERED', 'CANCELLED'));
ALTER TABLE tournament_registrations ADD COLUMN cancelled_at timestamptz;
ALTER TABLE tournament_registrations ADD CONSTRAINT tournament_registrations_cancel_check
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

-- 4. Réservations du compte de jeu ----------------------------------------------------------

CREATE TABLE wallet_reservations (
  id              uuid        PRIMARY KEY,
  -- Le portefeuille est identifié par son joueur (wallets.user_id).
  wallet_id       uuid        NOT NULL REFERENCES wallets (user_id),
  tournament_id   uuid        NOT NULL REFERENCES tournaments (id),
  registration_id uuid        NOT NULL REFERENCES tournament_registrations (id),
  amount          bigint      NOT NULL CHECK (amount >= 0),
  currency        text        NOT NULL CHECK (currency = 'XAF'),
  status          text        NOT NULL CHECK (status IN ('ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED')),
  capture_transaction_id uuid REFERENCES wallet_transactions (id),
  created_at      timestamptz NOT NULL,
  captured_at     timestamptz,
  released_at     timestamptz,
  CHECK ((status = 'CAPTURED') = (captured_at IS NOT NULL)),
  CHECK ((status IN ('RELEASED', 'EXPIRED')) = (released_at IS NOT NULL))
);

-- Une seule réservation vivante (ACTIVE ou CAPTURED) par inscription.
CREATE UNIQUE INDEX wallet_reservations_one_live_per_registration
  ON wallet_reservations (registration_id) WHERE status IN ('ACTIVE', 'CAPTURED');
CREATE INDEX wallet_reservations_tournament_idx ON wallet_reservations (tournament_id, status);
CREATE INDEX wallet_reservations_wallet_idx ON wallet_reservations (wallet_id, status);

-- 5. Compte de la plateforme (pas un joueur) ------------------------------------------------

CREATE TABLE platform_ledger (
  id            uuid        PRIMARY KEY,
  tournament_id uuid        NOT NULL REFERENCES tournaments (id),
  kind          text        NOT NULL CHECK (kind IN ('TOURNAMENT_PLATFORM_FEE', 'UNALLOCATED_PRIZE')),
  amount        bigint      NOT NULL CHECK (amount >= 0),
  fee_bps       integer     CHECK (fee_bps BETWEEN 0 AND 10000),
  currency      text        NOT NULL CHECK (currency = 'XAF'),
  created_at    timestamptz NOT NULL,
  CONSTRAINT platform_ledger_once UNIQUE (tournament_id, kind)
);

-- 6. Comptes temporaires de tournoi et parties réglées --------------------------------------

CREATE TABLE tournament_player_accounts (
  id              uuid        PRIMARY KEY,
  tournament_id   uuid        NOT NULL REFERENCES tournaments (id),
  player_id       uuid        NOT NULL REFERENCES users (id),
  registration_id uuid        NOT NULL REFERENCES tournament_registrations (id),
  registered_at   timestamptz NOT NULL,
  initial_tokens  integer     NOT NULL CHECK (initial_tokens > 0),
  current_tokens  integer     NOT NULL CHECK (current_tokens >= 0),
  games_played    integer     NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  games_won       integer     NOT NULL DEFAULT 0 CHECK (games_won >= 0 AND games_won <= games_played),
  rank            integer     CHECK (rank >= 1),
  prize_amount    bigint      NOT NULL DEFAULT 0 CHECK (prize_amount >= 0),
  status          text        NOT NULL CHECK (status IN ('ACTIVE', 'OUT_OF_TOKENS')),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  CONSTRAINT tournament_player_accounts_once UNIQUE (tournament_id, player_id)
);

-- Une ligne par partie d'une table de tournoi : le règlement des jetons est fait une fois.
CREATE TABLE tournament_games (
  game_id       uuid        PRIMARY KEY REFERENCES games (id),
  tournament_id uuid        NOT NULL REFERENCES tournaments (id),
  session_id    uuid        NOT NULL,
  status        text        NOT NULL CHECK (status IN ('SETTLED', 'VOID')),
  winner_id     uuid        REFERENCES users (id),
  stake         integer     NOT NULL CHECK (stake >= 0),
  pot           integer     NOT NULL CHECK (pot >= 0),
  -- { playerId: variation de jetons } : traçabilité du règlement.
  transfers     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  void_reason   text,
  settled_at    timestamptz NOT NULL,
  CHECK ((status = 'SETTLED') = (winner_id IS NOT NULL))
);

CREATE INDEX tournament_games_tournament_idx ON tournament_games (tournament_id);

-- 7. Résultats figés et versement des gains -------------------------------------------------

CREATE TABLE tournament_results (
  tournament_id    uuid        NOT NULL REFERENCES tournaments (id),
  rank             integer     NOT NULL CHECK (rank >= 1),
  player_id        uuid        NOT NULL REFERENCES users (id),
  initial_tokens   integer     NOT NULL,
  remaining_tokens integer     NOT NULL CHECK (remaining_tokens >= 0),
  games_played     integer     NOT NULL,
  games_won        integer     NOT NULL,
  prize_share_bps  integer     NOT NULL DEFAULT 0 CHECK (prize_share_bps BETWEEN 0 AND 10000),
  prize_amount     bigint      NOT NULL DEFAULT 0 CHECK (prize_amount >= 0),
  prize_transaction_id uuid    REFERENCES wallet_transactions (id),
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, rank),
  CONSTRAINT tournament_results_player_once UNIQUE (tournament_id, player_id),
  CHECK ((paid_at IS NULL) = (prize_transaction_id IS NULL))
);

-- 8. Notifications dans l'application -------------------------------------------------------

CREATE TABLE notifications (
  id         uuid        PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users (id),
  type       text        NOT NULL CHECK (type IN (
    'TOURNAMENT_APPROVED', 'TOURNAMENT_REGISTRATION_CONFIRMED', 'TOURNAMENT_CANCELLED',
    'TOURNAMENT_STARTED', 'TOURNAMENT_RESULTS_AVAILABLE', 'TOURNAMENT_PRIZE_CREDITED')),
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Un même événement n'est notifié qu'une fois (reprise, plusieurs instances).
  dedupe_key text        NOT NULL,
  created_at timestamptz NOT NULL,
  read_at    timestamptz,
  CONSTRAINT notifications_once UNIQUE (user_id, dedupe_key)
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- 9. Paramètres système et audit administratif ----------------------------------------------

ALTER TABLE system_settings DROP CONSTRAINT system_settings_key_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_check CHECK (key IN (
  'detection_enabled', 'tournament_platform_fee_percent', 'initial_tournament_tokens',
  'default_tournament_stake', 'maximum_pending_tournaments_per_player',
  'tournament_transition_minutes'));
ALTER TABLE system_settings ADD CONSTRAINT system_settings_tournament_number_check
  CHECK (key = 'detection_enabled' OR jsonb_typeof(value) = 'number');

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (
  'ALERT_STATUS_CHANGED', 'DETECTION_ENABLED', 'DETECTION_DISABLED',
  'TOURNAMENT_CREATED', 'TOURNAMENT_UPDATED', 'TOURNAMENT_APPROVED', 'TOURNAMENT_REJECTED',
  'TOURNAMENT_CANCELLED', 'TOURNAMENT_SETTINGS_UPDATED'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_type_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_type_check
  CHECK (target_type IN ('DETECTION_ALERT', 'SYSTEM_SETTING', 'TOURNAMENT'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_target_id_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_target_id_check
  CHECK ((target_type <> 'SYSTEM_SETTING') = (target_id IS NOT NULL));
