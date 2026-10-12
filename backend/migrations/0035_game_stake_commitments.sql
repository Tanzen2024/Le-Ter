-- Parties ordinaires (D-080, révise D-074) : la mise n'est plus SÉQUESTRÉE au démarrage, elle
-- est ENGAGÉE. Le solde et le disponible affichés du joueur restent identiques pendant toute
-- la partie ; le seul mouvement de jetons a lieu au règlement.
--
-- Avant : le démarrage réservait 2 × M (`wallet_reservations` + `wallets.reserved`), ce qui
-- faisait baisser le disponible affiché de 2 × M dès le démarrage.
-- Après : le démarrage écrit toujours une `wallet_reservations` ACTIVE avec `game_id`
-- (engagement, trace, idempotence), mais `wallets.reserved` ne compte plus que les
-- inscriptions aux tournois. Les engagements sont déduits des seuls contrôles de dépense
-- faits sous le verrou du portefeuille (retrait, inscription à un tournoi, autre démarrage).
--
-- Conversion des parties EN COURS au moment de la migration : leurs engagements actifs sont
-- retirés de `wallets.reserved` (sinon le règlement, qui ne touche plus `reserved`, les y
-- laisserait pour toujours). Aucun solde (`balance`), aucune écriture du registre et aucune
-- partie réglée n'est modifiée : seul le disponible affiché revient à sa valeur réelle.
--
-- Retour arrière : impossible sans réappliquer `reserved += amount` pour chaque engagement
-- encore actif ; ne pas revenir au code D-074 après cette migration.

UPDATE wallets w
SET reserved = w.reserved - c.committed
FROM (
  SELECT wallet_id, sum(amount) AS committed
  FROM wallet_reservations
  WHERE game_id IS NOT NULL AND status = 'ACTIVE'
  GROUP BY wallet_id
) c
WHERE w.user_id = c.wallet_id;

-- Lecture des engagements d'un joueur sous le verrou de son portefeuille (chaque dépense).
CREATE INDEX wallet_reservations_active_game_commitments_idx
  ON wallet_reservations (wallet_id)
  WHERE game_id IS NOT NULL AND status = 'ACTIVE';
