-- Compte de jeu (portefeuille de jetons) et registre de ses opérations (D-040).
--
-- Le compte de jeu (jetons utilisables dans Le Ter) et le compte Mobile Money personnel du
-- joueur (rattaché à `users.phone`) sont deux choses distinctes : seul le premier est stocké
-- ici. Aucun numéro de téléphone ni donnée de paiement n'est recopié dans ces tables.
--
-- Montants en JETONS uniquement : la conversion jetons ↔ FCFA (R-13) n'est pas définie et
-- appartient à l'intégration du fournisseur Mobile Money.

-- Une ligne par joueur, créée à sa première opération. Le solde ne peut jamais être négatif
-- (garanti en base, en plus du contrôle applicatif sous verrou).
CREATE TABLE wallets (
  user_id    uuid        PRIMARY KEY REFERENCES users (id),
  balance    bigint      NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Achat (deposit : Mobile Money → compte de jeu) et retrait (withdrawal : compte de jeu →
-- Mobile Money). Cycle : pending → succeeded | failed. Un retrait est débité dès sa
-- création (pending) et recrédité s'il échoue ; un achat n'est crédité qu'une fois le
-- paiement confirmé par le fournisseur.
CREATE TABLE wallet_transactions (
  id                 uuid        PRIMARY KEY,
  user_id            uuid        NOT NULL REFERENCES users (id),
  kind               text        NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  status             text        NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  tokens             bigint      NOT NULL CHECK (tokens > 0),
  -- Une intention du client = une opération (double clic, renvoi après coupure).
  idempotency_key    text        NOT NULL,
  failure_code       text,
  provider_reference text,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL,
  completed_at       timestamptz,
  CONSTRAINT wallet_transactions_idempotency UNIQUE (user_id, idempotency_key),
  CHECK ((status = 'pending') = (completed_at IS NULL)),
  CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

CREATE INDEX wallet_transactions_user_created_idx ON wallet_transactions (user_id, created_at DESC);
CREATE INDEX wallet_transactions_pending_idx ON wallet_transactions (created_at) WHERE status = 'pending';
