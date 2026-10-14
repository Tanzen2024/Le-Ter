-- Consentement à la géolocalisation d'une table surveillée (R-36, D-046, D-095).
--
-- Un consentement appartient à UNE participation : un joueur À SA PLACE dans UNE session
-- (`session_players`), identifiée par sa date d'arrivée (`joined_at`). Un joueur qui quitte
-- la table puis revient a une nouvelle participation et doit consentir à nouveau. Le
-- consentement vaut pour les parties suivantes de la même participation (même table).
--
-- `game_id` : partie à l'écran de laquelle le consentement a été donné (traçabilité).
-- Un refus n'est jamais enregistré : refuser, c'est quitter la table (D-095).

CREATE TABLE detection_consents (
  session_id   uuid        NOT NULL,
  player_id    uuid        NOT NULL,
  joined_at    timestamptz NOT NULL,
  game_id      uuid        REFERENCES games (id) ON DELETE SET NULL,
  consented_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, player_id, joined_at),
  FOREIGN KEY (session_id, player_id)
    REFERENCES session_players (session_id, player_id) ON DELETE CASCADE
);
