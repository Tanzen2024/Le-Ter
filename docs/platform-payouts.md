# Retraits des revenus de la plateforme (CinetPay → MTN Mobile Money Cameroun)

Décision : **D-078** (`docs/decisions.md`). Socle : D-060 (compte financier de la plateforme),
D-074 (commission des parties), D-075 à D-077 (transferts CinetPay, retraits des joueurs).

> **État actuel : exécution DÉSACTIVÉE.** Les demandes peuvent être créées, approuvées et
> réservées ; aucune ne peut être mise en exécution ni envoyée à CinetPay. L'activation est une
> procédure distincte (§ 11), non réalisée.

## 1. Architecture

```text
Administration Next.js ── /api/admin/platform-finance/* ──▶ PlatformPayoutService
                                                              │
        PlatformRevenueService ◀── faits comptables ──────────┤ (platform_ledger, withdrawals,
        TreasuryReconciliationService ◀── solde relu ─────────┤  platform_payouts : lecture)
             └─ TreasuryGateway (GET /v1/balances, lecture seule)
        TransferGateway (CinetPayTransferGateway, motif « Retrait des revenus Le Ter »)
        PlatformPayoutExecutor (arrière-plan : reprise, envoi si activé, relectures)
CinetPay ── POST /api/platform-payouts/cinetpay/notify ──▶ relecture (jamais crue sur parole)
```

| Fichier | Rôle |
|---|---|
| `backend/migrations/0033_platform_payouts.sql` | 4 tables, contraintes, déclencheurs, audit |
| `backend/src/domain/platform-finance/platform-finance.ts` | statuts, transitions, calculs purs, erreurs |
| `backend/src/repositories/(postgres-)platform-finance.repository.ts` | accès SQL paramétré, verrou des fonds |
| `backend/src/services/platform-finance/*` | revenus, trésorerie, retraits, exécuteur, fabrique |
| `backend/src/config/platform-payout-env.ts` | configuration (hors `readEnv`) |
| `backend/src/{controllers,routes,validators,middleware}/platform-finance*` | API |
| `administration/features/platform-payouts/*`, `app/(dashboard)/retraits-plateforme/*` | interface |

Le flux est **indépendant des retraits des joueurs** : aucun appel à `WithdrawalService`, aucun
compte de jeu débité. Seuls sont partagés le client CinetPay (jeton) et l'adaptateur
`CinetPayTransferGateway` (classement des réponses), avec une URL de notification et un motif
propres.

## 2. Comptabilité ≠ trésorerie

| | Comptabilité | Trésorerie |
|---|---|---|
| Source | `platform_ledger` (recettes : commissions de partie, commissions et parts non attribuées de tournoi) | `GET /v1/balances` chez CinetPay, conservé dans `treasury_observations` |
| Nature | droit de la plateforme | argent réellement disponible pour les transferts, **y compris celui des joueurs** |
| Écriture par ce module | **aucune** | une ligne par relecture (VALID, INVALID ou ERROR), jamais saisie à la main |

`platform_ledger` reste un journal de **recettes** (entrées seulement, `amount ≥ 0`) dont toutes
les sommes existantes (tableau de bord, rapports, compte de la plateforme) sont des recettes.
Les retraits exécutés n'y sont donc **pas** inscrits (ils fausseraient ces sommes) : ils sont
tracés dans `platform_payouts` et **déduits** au calcul. Aucune commission n'est recalculée ni
réenregistrée ; aucun revenu n'est créé pour simuler un encaissement.

## 3. Calculs (entiers XAF, jamais de flottant ; `null` = inconnu, distinct de 0)

```text
revenusValidés      = Σ platform_ledger.amount
charges             = frais des retraits JOUEURS réussis (withdrawals.fee_amount, arrondi au franc supérieur)
                    + retraits plateforme réussis (montant + frais définitifs, sinon estimés)
réservés            = Σ (montant + frais estimés) des retraits RESERVED…RECONCILIATION_REQUIRED
distribuable        = max(0, revenusValidés − charges − réservés)

obligationsJoueurs  = Σ wallets.balance (réservé compris)
                    + retraits joueurs CREATED/PROCESSING (débités, pas encore payés)
                    + fonds de tournoi détenus (inscriptions capturées − gains versés − recettes de tournoi)
trésorerieLibre     = soldeConfirmé − obligationsJoueurs − réservés      (null si non confirmé)

retirable           = plus grand M tel que M + frais(M) ≤ min(distribuable, trésorerieLibre),
                      borné à [100 ; 1 500 000] (SDK CinetPay)
```

Blocages (aucun montant affirmé) : trésorerie non confirmée, barème des frais inconnu, revenu
distribuable négatif ou fonds de tournoi négatifs (incohérence). « Rien de retirable » (0) est
distinct de « inconnu » (`null`).

Choix prudents assumés : les retraits réservés sont déduits à la fois des revenus et de la
trésorerie (un transfert en cours a pu, ou non, déjà quitter le solde CinetPay) ; toutes les
obligations envers les joueurs sont imputées au seul solde relu (une partie de leurs fonds peut
se trouver dans le solde de collecte, invisible) ; les frais de collecte des achats ne sont pas
enregistrés par Le Ter et ne sont donc pas déduits des revenus (anomalie
`COLLECTION_FEES_NOT_RECORDED`), mais le solde relu en est net.

## 4. Confirmation de la trésorerie

- Source unique : `GET /v1/balances` (Bearer), relevé dans le SDK officiel `cinetpay-js`
  (`src/api/balance.ts`, `src/types/balance.ts`) : `{ code, status, available_balance (chaîne),
  currency }`, solde « disponible pour les transferts ». Lecture seule.
- Acceptée seulement si `currency = XAF` et montant entier (« 125000 » ou « 125000.00 ») ;
  sinon `INVALID` (jamais arrondi). Erreur réseau ou refus : `ERROR`.
- **Confirmée** = dernière relecture enregistrée VALIDE et de moins de **15 minutes**. Sinon :
  `UNKNOWN` (aucune), `UNAVAILABLE` (dernière en erreur), `STALE` (périmée).
- Relue : à la demande (bouton, audité), au rapprochement, et **juste avant chaque envoi** par
  l'exécuteur (contrôle préalable).

## 5. Statuts

| Statut | Sens | Fonds |
|---|---|---|
| `PENDING_APPROVAL` | demande créée (brouillon = demande) | non réservés |
| `REJECTED` | rejetée par un autre administrateur (final) | — |
| `CANCELLED` | annulée avant tout envoi (final) | libérés |
| `RESERVED` | approuvée **et** réservée (même transaction) | réservés |
| `READY` | mise en exécution (prérequis vérifiés) | réservés |
| `SUBMITTING` | envoi revendiqué par UN exécuteur | réservés |
| `PROCESSING` | accepté par CinetPay, non final | réservés |
| `UNCERTAIN` | issue inconnue (délai, refus annoncé, doublon, interruption) | réservés |
| `RECONCILIATION_REQUIRED` | 24 h sans preuve, ou statut relu incohérent | réservés |
| `SUCCEEDED` | `SUCCESS` **relu** chez CinetPay (final) | dépensés |
| `FAILED` | `FAILED` / `INSUFFICIENT_BALANCE` **relu** chez CinetPay (final) | libérés |

Transitions validées par le serveur (`canTransition`) ; l'interface n'envoie jamais de statut.
Jamais réussi sur : réponse HTTP acceptée, référence générée, accusé de réception,
notification. `NOT_FOUND` ne prouve jamais un échec. Aucune sortie manuelle de
`RECONCILIATION_REQUIRED` n'existe (R-41).

## 6. Autorisations

- Toutes les routes : JWT + rôle `admin` + session d'administration (D-061), revérifiés par le
  routeur. Le projet n'a qu'un rôle `admin` : aucun rôle supplémentaire n'est inventé.
- **Séparation des responsabilités imposée en base** : l'initiateur n'approuve ni ne rejette sa
  demande (`CHECK approved_by <> initiated_by`, `decided_by <> initiated_by`) ; celui qui
  enregistre un bénéficiaire ne peut pas attester sa vérification. Il faut donc **deux comptes
  administrateurs**. Limite : n'importe quel autre administrateur peut approuver ; la mise en
  exécution et l'annulation sont ouvertes à tout administrateur (R-39).
- Une approbation n'a lieu qu'une fois (transition + version contrôlée).

## 7. Idempotence, concurrence, réconciliation

- Création : `Idempotency-Key` obligatoire, unique par initiateur ; rejeu = même demande (200),
  autre contenu = 409.
- Engagements de fonds (création, approbation, mise en exécution, résultats d'envoi) :
  `LOCK TABLE platform_payouts IN SHARE ROW EXCLUSIVE MODE` dans la transaction, recalcul du
  retirable sous ce verrou : deux approbations concurrentes ne réservent jamais plus que le
  disponible. Aucune transaction n'est ouverte pendant un appel CinetPay.
- Envoi : revendication `READY → SUBMITTING` par UPDATE conditionnel (version), **un seul envoi
  par retrait garanti en base** (`submission_attempts ≤ 1`), même référence `LP…` à vie. Seul
  un échec certain AVANT l'envoi (`not_sent`) ramène à `READY`. Une revendication restée
  `SUBMITTING` plus de 5 minutes (arrêt) devient `UNCERTAIN`, jamais renvoyée.
- Données figées par déclencheur : montant, devise, bénéficiaire, référence, initiateur, frais
  estimés ; statut final immuable ; aucune suppression ; historique en ajout seul.
- Relecture `GET /v1/transfer/{LP…}` : exécuteur (toutes les 30 s), notification, bouton,
  rapprochement. Référence, montant ou devise incohérents → `RECONCILIATION_REQUIRED`.
- Notification : `notify_token` comparé à son empreinte SHA-256 (temps constant), puis statut
  relu ; le corps n'est jamais cru ; doublons sans effet.
- Rapprochement manuel (`POST /reconcile`) : relit la trésorerie et les retraits ouverts,
  reprend les envois interrompus, **n'envoie jamais rien**.
- Limite : l'API CinetPay accessible ne liste pas les mouvements du compte ; le rapprochement
  porte sur les opérations connues de Le Ter (une par une) et sur le solde, pas sur un relevé.

## 8. Audit

`admin_audit_log` (dans la même transaction que l'action) : `PAYOUT_BENEFICIARY_CREATED`,
`_VERIFIED`, `_DISABLED`, `TREASURY_OBSERVED`, `PLATFORM_PAYOUT_CREATED`, `_APPROVED`,
`_REJECTED`, `_CANCELLED`, `_RELEASED`, `_VIEWED`, `_RECONCILED`. `platform_payout_events`
retrace chaque transition (acteur ou système, ordre strict). Jamais de numéro complet, de
jeton, de clé ni de secret dans les journaux, l'audit, l'historique ou l'API (numéro masqué
`+2376** *** *56`).

## 9. Bénéficiaire

MTN Mobile Money Cameroun seulement. Format exigé : `+237` + 9 chiffres commençant par 6. Les
préfixes par opérateur ne sont **pas** vérifiés (sources divergentes, portabilité des numéros).
La syntaxe ne prouve ni l'opérateur ni le titulaire : un AUTRE administrateur atteste une
vérification hors système (note obligatoire). Le numéro complet n'est stocké qu'en base
(nécessaire au transfert), jamais renvoyé. Exigences CinetPay d'identification du bénéficiaire :
à confirmer (R-40).

## 10. Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PLATFORM_PAYOUTS_ENABLED` | `false` | 1er verrou de l'exécution |
| `PLATFORM_PAYOUT_NOTIFY_URL` | — | URL publique de `/api/platform-payouts/cinetpay/notify` (≤ 120), requise si activé |
| `PLATFORM_PAYOUT_FEE_BPS`, `PLATFORM_PAYOUT_FEE_FIXED` | — | barème contractuel des frais ; absent = aucun retrait possible |

L'exécution exige **en plus** que les transferts CinetPay soient disponibles au sens de D-077
(`CINETPAY_TRANSFERS_ENABLED`, attestation de production…). Aucun bouton ni paramètre de
l'interface ne peut l'activer. Identifiants : ceux des achats (`CINETPAY_API_KEY`,
`CINETPAY_API_PASSWORD`).

Migration : `npm run db:migrate` (ajout seul : `0033_platform_payouts.sql`).

## 11. Activation future (hors périmètre, procédure distincte)

1. Contrat CinetPay : Mass Payout/transfert autorisé pour ce compte, au Cameroun, en XAF, pour
   des versements à la plateforme elle-même ; barème des frais ; plafonds ; liste blanche d'IP.
2. Conformité contractuelle et réglementaire de l'activité.
3. Bénéficiaire vérifié (titulaire du compte MTN) selon les exigences CinetPay.
4. Sandbox : vérifier `GET /v1/balances` (code de succès, forme de `available_balance`),
   `POST /v1/transfer`, `GET /v1/transfer/{id}` (`NOT_FOUND`, `TRANSACTION_EXIST`, frais
   renvoyés), la notification, puis un parcours complet de bout en bout.
5. Contrôle des soldes et du rapprochement ; vérification de l'idempotence et de la reprise.
6. Autorisation explicite de mise en production, puis seulement : `PLATFORM_PAYOUTS_ENABLED=true`,
   URL de notification, barème ; contrôler au démarrage le journal
   « Retraits de la plateforme : EXÉCUTION ACTIVÉE ».

## 12. Tests

Aucun transfert réel : passerelles simulées.

- `backend/tests/unit/platform-finance/platform-finance.test.ts` : calculs, bornes, inconnu ≠ 0,
  numéros, transitions, configuration, trois verrous.
- `backend/tests/unit/platform-finance/cinetpay-balance.test.ts` : contrat `GET /v1/balances`
  (`fetch` simulé), motif de transfert.
- `backend/tests/integration/platform-finance/platform-payout-api.test.ts` (PGlite) : accès,
  indicateurs, bénéficiaires, création, approbation, rejet, annulation, contraintes de base,
  concurrence, fonds des joueurs, exécution désactivée, transferts simulés (confirmation, échec,
  non envoyé, incertain, réponse tardive, refus annoncé, `NOT_FOUND`, redémarrage, deux
  exécuteurs, incohérence, notifications), rapprochement sans envoi, audit et confidentialité.
- `backend/tests/integration/platform-finance/postgres-platform-payout-concurrency.test.ts` :
  vrai PostgreSQL, exécuté seulement avec `TEST_DATABASE_URL=<base de test dédiée>`.
- `administration/tests/platform-payouts.test.tsx` : indicateurs, états, liste, création,
  droits, dialogues.
