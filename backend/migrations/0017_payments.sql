-- Paiements CinetPay (D-050) : le détail fournisseur d'un ACHAT du compte de jeu (D-040).
--
-- Le compte de jeu reste la seule source de vérité financière : un paiement ne crédite
-- jamais directement ; il est rattaché 1–1 à une transaction `deposit` de
-- `wallet_transactions`, réglée par le même code que tout achat (crédit une seule fois),
-- dans la même transaction SQL que le changement de statut du paiement.
--
-- Montant en FCFA (XAF) : 1 FCFA = 1 jeton (D-050, R-13 tranchée pour l'achat).
-- Ni numéro de téléphone, ni jeton d'authentification, ni `notify_token` en clair ne sont
-- stockés : seulement l'empreinte SHA-256 du `notify_token` pour vérifier les notifications.
CREATE TABLE payments (
  id                      uuid        PRIMARY KEY,
  wallet_transaction_id   uuid        NOT NULL UNIQUE REFERENCES wallet_transactions (id)
                                      ON DELETE CASCADE,
  provider                text        NOT NULL CHECK (provider IN ('cinetpay')),
  -- Notre identifiant chez le fournisseur (`merchant_transaction_id`, 30 caractères max).
  merchant_transaction_id text        NOT NULL CHECK (char_length(merchant_transaction_id) BETWEEN 1 AND 30),
  -- Identifiant du fournisseur (`transaction_id`), connu après l'initialisation.
  provider_reference      text        CHECK (char_length(provider_reference) BETWEEN 1 AND 128),
  amount                  bigint      NOT NULL CHECK (amount > 0),
  currency                text        NOT NULL CHECK (currency IN ('XAF')),
  status                  text        NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED')),
  -- Dernier statut brut renvoyé par le fournisseur (INITIATED, PENDING, SUCCESS, FAILED…).
  provider_status         text,
  payment_method          text,
  payment_url             text,
  notify_token_hash       text        CHECK (notify_token_hash ~ '^[0-9a-f]{64}$'),
  metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,
  completed_at            timestamptz,
  CONSTRAINT payments_merchant_transaction_unique UNIQUE (provider, merchant_transaction_id),
  CONSTRAINT payments_provider_reference_unique UNIQUE (provider, provider_reference),
  CHECK ((status = 'PENDING') = (completed_at IS NULL)),
  -- Un paiement CONFIRMÉ l'a forcément été par une vérification auprès du fournisseur.
  -- (Un échec peut survenir avant toute référence : initialisation refusée.)
  CHECK (status <> 'SUCCESS' OR provider_reference IS NOT NULL),
  -- Les données de notification sont posées ensemble, à l'initialisation acceptée.
  CHECK ((provider_reference IS NULL) = (notify_token_hash IS NULL))
);

CREATE INDEX payments_pending_idx ON payments (created_at) WHERE status = 'PENDING';
