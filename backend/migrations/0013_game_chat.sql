-- Chat de partie (D-045). Un message appartient toujours à UNE partie existante et à un
-- compte existant. Le contenu est du texte brut (jamais du HTML) ; sa limite applicative
-- (MAX_CHAT_MESSAGE_LENGTH = 500, domain/chat/chat.ts) est aussi garantie ici.
--
-- L'appartenance de l'expéditeur à la partie est vérifiée par l'insertion elle-même
-- (PostgresChatRepository.insert) et non par une clé étrangère vers `game_players` : un
-- joueur qui quitte une partie en attente en est retiré, et ses messages doivent rester.
--
-- `client_message_id` : clé d'envoi choisie par le client pour UNE intention d'envoi ; un
-- renvoi (double appui, coupure réseau) retrouve le message au lieu d'en créer un second.

CREATE TABLE game_chat_messages (
  id                uuid        PRIMARY KEY,
  game_id           uuid        NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  sender_id         uuid        NOT NULL REFERENCES users (id),
  content           text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  client_message_id text        NOT NULL CHECK (char_length(client_message_id) BETWEEN 8 AND 128),
  created_at        timestamptz NOT NULL,
  CONSTRAINT game_chat_messages_client_message_unique
    UNIQUE (game_id, sender_id, client_message_id)
);

-- Historique d'une partie, par pages, dans l'ordre total (created_at, id). Sert aussi
-- toutes les recherches par `game_id` seul (préfixe de l'index).
CREATE INDEX game_chat_messages_game_created_idx
  ON game_chat_messages (game_id, created_at, id);
