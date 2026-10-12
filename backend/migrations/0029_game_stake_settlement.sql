-- Règlement financier des parties ORDINAIRES (D-074) : séquestre des mises au démarrage,
-- règlement idempotent à la fin (victoire simple, Kora, sans gagnant), commission de la
-- plateforme configurable dans l'administration.
--
-- Modèle (aucun second portefeuille, aucun registre parallèle) :
-- - Le compte de jeu (D-040) reste l'UNIQUE portefeuille. Le séquestre est une RÉSERVATION du
--   compte de jeu (`wallet_reservations`, D-054), étendue aux parties : 2 × mise par joueur au
--   démarrage (couvre la perte maximale, la Kora), `wallets.reserved` maintenu comme pour les
--   tournois. Toute variation de `wallets.balance` reste une ligne de `wallet_transactions`.
-- - `game_stake` : mise consommée (débit) de CHAQUE participant, gagnant compris : la cagnotte
--   brute M × N (ou 2M × N) ne contient que des mises réellement collectées.
--   `game_winnings` : cagnotte brute moins la commission, créditée au gagnant.
-- - La commission va au compte financier de la plateforme (`platform_ledger`, D-060), type
--   `GAME_COMMISSION`, une écriture par partie au plus.
-- - `game_settlements` : une ligne par partie, verrou d'idempotence du règlement (RESERVED →
--   SETTLED | VOID, une seule fois) et trace du calcul (taux figé, issue, montants).
--
-- Compatibilité : ajouts seulement (colonnes nullables, contraintes élargies, nouvelle table).
-- Aucune ligne existante n'est modifiée. Les parties démarrées avant cette migration n'ont pas
-- de séquestre : elles se terminent sans aucun mouvement de jetons (mise indicative, D-039).
--
-- Retour arrière (si aucune partie n'a encore été réglée par ce mécanisme) :
--   DROP TABLE game_settlements;
--   DELETE FROM wallet_reservations WHERE game_id IS NOT NULL;  -- après remise à 0 de reserved
--   puis restaurer les contraintes de 0021 / 0023 / 0028 et supprimer les colonnes game_id.
-- Après des règlements réels, ne PAS revenir en arrière : les écritures sont des faits
-- comptables (débits, gains, commissions) ; corriger par une nouvelle migration.

-- 1. Réservations du compte de jeu : inscription à un tournoi OU partie ordinaire -----------

ALTER TABLE wallet_reservations ALTER COLUMN tournament_id DROP NOT NULL;
ALTER TABLE wallet_reservations ALTER COLUMN registration_id DROP NOT NULL;
ALTER TABLE wallet_reservations ADD COLUMN game_id uuid REFERENCES games (id);
ALTER TABLE wallet_reservations ADD CONSTRAINT wallet_reservations_source_check CHECK (
  (game_id IS NULL AND tournament_id IS NOT NULL AND registration_id IS NOT NULL)
  OR (game_id IS NOT NULL AND tournament_id IS NULL AND registration_id IS NULL));

-- Partie : seule la mise due (M ou 2M) est capturée, le reste du séquestre est libéré dans la
-- même écriture. NULL pour un tournoi (montant entièrement capturé).
ALTER TABLE wallet_reservations ADD COLUMN captured_amount bigint;
ALTER TABLE wallet_reservations ADD CONSTRAINT wallet_reservations_captured_amount_check
  CHECK (captured_amount IS NULL OR (status = 'CAPTURED' AND captured_amount BETWEEN 0 AND amount));

-- Une seule réservation vivante par (partie, joueur).
CREATE UNIQUE INDEX wallet_reservations_one_live_per_game_player
  ON wallet_reservations (game_id, wallet_id)
  WHERE game_id IS NOT NULL AND status IN ('ACTIVE', 'CAPTURED');
CREATE INDEX wallet_reservations_game_idx ON wallet_reservations (game_id) WHERE game_id IS NOT NULL;

-- 2. Registre du compte de jeu : mise consommée et gain d'une partie ------------------------

ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_kind_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check
  CHECK (kind IN ('deposit', 'withdrawal', 'tournament_entry', 'tournament_prize',
                  'game_stake', 'game_winnings'));
ALTER TABLE wallet_transactions ADD COLUMN game_id uuid REFERENCES games (id);
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_game_check
  CHECK ((kind IN ('game_stake', 'game_winnings')) = (game_id IS NOT NULL));
CREATE INDEX wallet_transactions_game_idx ON wallet_transactions (game_id) WHERE game_id IS NOT NULL;

-- 3. Compte financier de la plateforme : commission d'une partie ----------------------------

ALTER TABLE platform_ledger ALTER COLUMN tournament_id DROP NOT NULL;
ALTER TABLE platform_ledger ADD COLUMN game_id uuid REFERENCES games (id);
ALTER TABLE platform_ledger DROP CONSTRAINT platform_ledger_kind_check;
ALTER TABLE platform_ledger ADD CONSTRAINT platform_ledger_kind_check
  CHECK (kind IN ('TOURNAMENT_PLATFORM_FEE', 'UNALLOCATED_PRIZE', 'GAME_COMMISSION'));
ALTER TABLE platform_ledger ADD CONSTRAINT platform_ledger_source_check CHECK (
  CASE WHEN kind = 'GAME_COMMISSION'
       THEN game_id IS NOT NULL AND tournament_id IS NULL
       ELSE tournament_id IS NOT NULL AND game_id IS NULL END);
-- Une commission par partie au plus (idempotence, comme (tournament_id, kind)).
ALTER TABLE platform_ledger ADD CONSTRAINT platform_ledger_game_once UNIQUE (game_id, kind);

-- 4. Règlement d'une partie ordinaire --------------------------------------------------------

CREATE TABLE game_settlements (
  game_id            uuid        PRIMARY KEY REFERENCES games (id),
  session_id         uuid        NOT NULL,
  -- Mise unitaire M de la partie (jetons du compte de jeu).
  stake              bigint      NOT NULL CHECK (stake > 0),
  -- Réservé par joueur au démarrage : 2 × M (perte maximale, Kora).
  reserved_per_player bigint     NOT NULL CHECK (reserved_per_player > 0),
  -- Taux de commission FIGÉ au démarrage, en points de base (500 = 5 %).
  commission_bps     integer     NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  status             text        NOT NULL CHECK (status IN ('RESERVED', 'SETTLED', 'VOID')),
  -- SIMPLE / KORA : victoire ; NO_WINNER : égalité rejouée, arrêt administratif…
  outcome            text        CHECK (outcome IN ('SIMPLE', 'KORA', 'NO_WINNER')),
  winner_id          uuid        REFERENCES users (id),
  -- N : participants réglés (fuyards exclus, R-05 non tranché).
  participants       integer     CHECK (participants >= 0),
  -- Mise consommée par participant : M (simple) ou 2M (Kora).
  unit_amount        bigint      CHECK (unit_amount >= 0),
  gross_amount       bigint      CHECK (gross_amount >= 0),
  commission_amount  bigint      CHECK (commission_amount >= 0),
  net_gain           bigint      CHECK (net_gain >= 0),
  void_reason        text,
  opened_at          timestamptz NOT NULL,
  settled_at         timestamptz,
  CHECK ((status = 'RESERVED') = (settled_at IS NULL)),
  CHECK ((status = 'RESERVED') = (outcome IS NULL)),
  CHECK (status <> 'SETTLED' OR (
    outcome IN ('SIMPLE', 'KORA') AND winner_id IS NOT NULL AND participants >= 2
    AND gross_amount = unit_amount * participants
    AND gross_amount = commission_amount + net_gain)),
  CHECK (status <> 'VOID' OR (
    outcome = 'NO_WINNER' AND winner_id IS NULL AND COALESCE(commission_amount, 0) = 0
    AND COALESCE(net_gain, 0) = 0))
);

CREATE INDEX game_settlements_status_idx ON game_settlements (status, opened_at);

-- 5. Paramètre et audit -----------------------------------------------------------------------

-- Commission sur les gains des parties (%). Clé absente : valeur initiale du code (5 %).
ALTER TABLE system_settings DROP CONSTRAINT system_settings_key_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_check CHECK (key IN (
  'detection_enabled', 'tournament_platform_fee_percent', 'initial_tournament_tokens',
  'default_tournament_stake', 'maximum_pending_tournaments_per_player',
  'tournament_transition_minutes', 'tournament_ranking_tokens_weight_percent',
  'tournament_ranking_games_weight_percent', 'tournament_initial_tokens_coefficient',
  'tournament_stake_per_game_coefficient', 'game_commission_percent'));

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (
  'ALERT_STATUS_CHANGED', 'DETECTION_ENABLED', 'DETECTION_DISABLED',
  'TOURNAMENT_CREATED', 'TOURNAMENT_UPDATED', 'TOURNAMENT_APPROVED', 'TOURNAMENT_REJECTED',
  'TOURNAMENT_CANCELLED', 'TOURNAMENT_SETTINGS_UPDATED',
  'ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGIN_FAILED', 'ADMIN_LOGOUT', 'ADMIN_SESSION_EXPIRED',
  'USER_VIEWED', 'PAYMENT_VIEWED', 'PAYMENT_VERIFICATION_REQUESTED', 'REPORT_EXPORTED',
  'GAME_COMMISSION_UPDATED'));
