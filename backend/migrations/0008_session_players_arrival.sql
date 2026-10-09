-- Ordre d'arrivée des joueurs dans une session (R-19, D-037).
--
-- Quand le J1 d'une partie EN ATTENTE quitte la session, le nouveau J1 est le joueur
-- suivant dans l'ORDRE D'ARRIVÉE dans la session. Ni le siège (ordre de la table), ni
-- l'identifiant, ni `joined_at` (deux arrivées peuvent porter le même instant) ne
-- représentent cet ordre de façon fiable : `arrival` est un rang explicite, propre à la
-- session (1 = créateur, puis 2, 3…). Un joueur qui revient reçoit un NOUVEAU rang, le
-- plus grand : il est le dernier arrivé.

ALTER TABLE session_players ADD COLUMN arrival integer;

-- Données existantes : rang selon l'instant d'arrivée, seule information disponible.
WITH ranked AS (
  SELECT session_id, player_id,
         row_number() OVER (PARTITION BY session_id ORDER BY joined_at) AS rank
  FROM session_players
)
UPDATE session_players sp
SET arrival = r.rank
FROM ranked r
WHERE r.session_id = sp.session_id AND r.player_id = sp.player_id;

ALTER TABLE session_players ALTER COLUMN arrival SET NOT NULL;
ALTER TABLE session_players ADD CONSTRAINT session_players_arrival_positive CHECK (arrival >= 1);
ALTER TABLE session_players
  ADD CONSTRAINT session_players_arrival_unique UNIQUE (session_id, arrival);
