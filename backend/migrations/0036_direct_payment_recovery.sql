-- Paiement DIRECT CinetPay (sans redirection, D-083) : reprise d'une initialisation incertaine.
--
-- Une création de paiement direct peut partir chez CinetPay sans réponse exploitable (délai,
-- réseau) alors que la demande de validation a déjà atteint le téléphone du joueur. Le paiement
-- reste alors PENDING (metadata.initialization = 'UNCERTAIN'), sans référence ni empreinte du
-- `notify_token`. La réconciliation le recherche chez CinetPay par `merchant_transaction_id`
-- (GET /v1/payment/{id}, serveur à serveur) et pose la référence retrouvée. Le `notify_token`
-- n'est jamais renvoyé par la lecture du statut : ce paiement n'a donc pas d'empreinte, ses
-- notifications sont refusées et il est réglé par la seule relecture du statut.
--
-- 0017 imposait référence et empreinte ENSEMBLE. Nouvelle règle : une empreinte implique une
-- référence (une notification se vérifie toujours contre une référence), mais une référence
-- peut exister sans empreinte. Aucune ligne existante n'est modifiée ; toutes respectent la
-- nouvelle contrainte (plus permissive).

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'payments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%(provider_reference IS NULL) = (notify_token_hash IS NULL)%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE payments ADD CONSTRAINT payments_notify_hash_requires_reference
  CHECK (notify_token_hash IS NULL OR provider_reference IS NOT NULL);
