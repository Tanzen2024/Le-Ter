-- Tournois : message de remerciement différé de fin de tournoi (D-117). AJOUTS seulement : aucune
-- notification existante n'est modifiée ni supprimée.
--
-- 1. `available_at` : instant à partir duquel une notification est visible du joueur. NULL (toutes
--    les notifications existantes et les autres types) = visible dès sa création, comme avant.
--    Le remerciement est écrit dans la transaction du classement officiel (boîte d'envoi
--    durable) avec `available_at` = publication des résultats + 10 s : il ne dépend ni d'un
--    minuteur, ni de la présence du joueur, et la clé (user_id, dedupe_key) l'empêche d'être
--    écrit deux fois.

ALTER TABLE notifications ADD COLUMN available_at timestamptz;
ALTER TABLE notifications ADD CONSTRAINT notifications_available_after_creation
  CHECK (available_at IS NULL OR available_at >= created_at);

-- 2. Nouveau type de notification.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'TOURNAMENT_APPROVED', 'TOURNAMENT_REGISTRATION_CONFIRMED', 'TOURNAMENT_CANCELLED',
  'TOURNAMENT_STARTED', 'TOURNAMENT_RESULTS_AVAILABLE', 'TOURNAMENT_PRIZE_CREDITED',
  'TOURNAMENT_TABLE_CLOSED', 'MODERATION_WARNING', 'COMPLAINT_UPDATE',
  'TOURNAMENT_THANK_YOU'));
