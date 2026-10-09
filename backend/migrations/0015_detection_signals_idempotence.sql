-- Idempotence des signaux de détection (R-36, étape 3, D-047).
--
-- Une même analyse rejouée (même partie, même type, mêmes joueurs dans le même ordre, même
-- version d'algorithme) ne crée jamais un second signal. Les doublons éventuels déjà
-- présents sont d'abord retirés (le plus ancien est conservé).

DELETE FROM detection_signals d
USING detection_signals older
WHERE d.game_id = older.game_id
  AND d.type = older.type
  AND d.player_ids = older.player_ids
  AND d.algorithm_version = older.algorithm_version
  AND (older.created_at, older.id) < (d.created_at, d.id);

CREATE UNIQUE INDEX detection_signals_identity_key
  ON detection_signals (game_id, type, player_ids, algorithm_version);
