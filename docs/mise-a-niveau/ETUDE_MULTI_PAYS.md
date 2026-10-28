# LeTer — Étude d'impact : achats et retraits hors Cameroun (27/10/2026)

Cible fixée par le propriétaire (D-172) : **tous les pays où MTN Mobile Money ou Orange Money
existent**. Rien n'est implémenté ; ce document décrit l'existant, les décisions à prendre et le
découpage proposé. Aucun pays n'est présumé autorisé, ni commercialement ni juridiquement.

## 1. Existant

| Domaine | Comportement actuel | Où |
|---|---|---|
| Inscription | **Tous les pays** (libphonenumber, D-070) | `frontend/src/lib/phone-countries.ts`, validation serveur |
| Devise du compte de jeu | **XAF pour tous**, quel que soit le pays (D-050) ; 1 jeton = 1 FCFA | `frontend/src/lib/phone-countries.ts` (`ACCOUNT_CURRENCY`), `backend/src/domain/payments/payment.ts` |
| Achat de jetons | XAF seulement ; opérateurs `MTN_CM`, `OM_CM` ; opérateur déduit du plan de numérotation camerounais (`+237 6xx`) | `domain/payments/payment.ts` (`operatorOfPhone`, `DIRECT_PAY_OPERATORS`), `services/payments/cinetpay/*` |
| Retrait | Numéro d'inscription `+237` + 9 chiffres, opérateur déduit, XAF | `domain/wallet/withdrawal.ts`, `services/withdrawals/*` |
| Versements de la plateforme | `MTN_CM`, numéro `+2376…` | `services/platform-finance/*` |
| Base de données | `CHECK (currency IN ('XAF'))`, `operator IN ('OM_CM','MTN_CM')`, `msisdn ~ '^\+2376…'` | migrations `0017`, `0021`, `0031`, `0033` (appliquées : **jamais modifiées**, D-026) |
| Affichage des montants | « FCFA » uniquement (`CurrencyCode = 'XAF'`) | `frontend/src/lib/money.ts` |

Conséquence aujourd'hui : un joueur inscrit hors Cameroun **ne peut ni recharger ni retirer**,
donc ne peut pas jouer (toutes les parties sont payantes).

Fichiers concernés (hors tests) : ~30 dans `backend/src` (paiements, retraits, finances de la
plateforme, tournois, administration, validateurs) et ~12 dans `frontend/src` (portefeuille,
recharge, pays, montants).

## 2. Décisions à prendre avant tout développement

1. **Liste des pays de la première vague**, pays par pays (pas « tous » d'un coup).
2. **Couverture CinetPay** pour chacun : opérateurs effectivement ouverts sur le contrat
   (achat ET transfert), codes opérateur, plafonds, frais, devise de règlement. À obtenir par
   écrit de CinetPay ; ne pas déduire de la documentation publique.
3. **Devise** :
   - zone XOF (UEMOA) : parité officielle fixe avec le XAF (les deux sont liés à l'euro au même
     taux), donc 1 XOF = 1 jeton est arithmétiquement exact ; reste à décider si le compte
     affiche « FCFA » sans distinction ;
   - autres devises : **taux de change, source, fréquence de mise à jour et arrondi** à fixer
     par le propriétaire ; le brief interdit d'inventer un taux.
4. **Conformité** pays par pays (jeux avec mises, retraits) : validation juridique écrite.
5. **Numéro de retrait** : reste le numéro d'inscription (règle actuelle) — à confirmer pour
   chaque pays (portabilité des numéros, opérateur déduit ou choisi).

## 3. Découpage proposé (une fois les décisions prises)

| Lot | Contenu | Risque | Tests |
|---|---|---|---|
| L1 | Table de configuration des pays ouverts (pays, devise, opérateurs, plafonds), désactivée par défaut, administrable ; le Cameroun comme seule ligne active | Faible | unitaires, intégration |
| L2 | Nouvelle migration élargissant les `CHECK` (devise, opérateur, numéro) **sans toucher aux migrations appliquées** | Moyen (base) | migration sur copie de la base PROD |
| L3 | Achat : opérateur par pays, montant en devise locale → jetons (entiers, arrondi en faveur du joueur, comme D-054) | **Élevé** (argent) | unitaires de conversion, sandbox CinetPay par pays |
| L4 | Retrait : même logique, transfert CinetPay par pays | **Élevé** | sandbox, puis montants réels minimaux |
| L5 | Application : affichage de la devise locale, messages « pays non ouvert » | Moyen | jest |
| L6 | Site vitrine : liste des pays ouverts (lue de la configuration, jamais écrite à la main) | Faible | tests du site |

Chaque lot passe par le TEST (`api-beta.leter.cm`) avant la PROD (D-171).
