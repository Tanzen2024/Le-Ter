-- Prix d'entrée minimal pour créer un tournoi, réglable par l'administration (D-105).
--
-- `tournament_minimum_entry_fee` (valeur initiale du code : 500 FCFA) : entier ≥ 1 (jamais de
-- tournoi gratuit, D-071). Remplace le minimum fixe de 500 FCFA (D-054, D-071).
--
-- Nouvelle clé seulement : aucune ligne n'est insérée. Tant que la clé n'a jamais été
-- enregistrée, le serveur applique la valeur initiale du code. Aucun tournoi n'est modifié.
ALTER TABLE system_settings DROP CONSTRAINT system_settings_key_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_check CHECK (key IN (
  'detection_enabled', 'tournament_platform_fee_percent', 'initial_tournament_tokens',
  'default_tournament_stake', 'maximum_pending_tournaments_per_player',
  'tournament_transition_minutes', 'tournament_ranking_tokens_weight_percent',
  'tournament_ranking_games_weight_percent', 'tournament_initial_tokens_coefficient',
  'tournament_stake_per_game_coefficient', 'game_commission_schedule',
  'withdrawal_limit_count', 'withdrawal_limit_period',
  'tournament_minimum_players', 'tournament_maximum_players',
  'tournament_minimum_duration_minutes', 'tournament_maximum_duration_minutes',
  'tournament_minimum_entry_fee'));

-- Joueurs : entier ≥ 2 ; maximum : JSON `null` (∞) aussi. Durées et prix d'entrée minimal : entier ≥ 1.
-- CASE imbriqués : la conversion
-- numérique n'est évaluée que pour un nombre JSON.
ALTER TABLE system_settings DROP CONSTRAINT system_settings_value_type_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_value_type_check CHECK (
  CASE key
    WHEN 'detection_enabled' THEN jsonb_typeof(value) = 'boolean'
    WHEN 'game_commission_schedule' THEN jsonb_typeof(value) = 'array'
    WHEN 'withdrawal_limit_count' THEN
      CASE jsonb_typeof(value)
        WHEN 'null' THEN true
        WHEN 'number' THEN (value::text)::numeric >= 1
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    WHEN 'withdrawal_limit_period' THEN
      CASE jsonb_typeof(value)
        WHEN 'null' THEN true
        WHEN 'number' THEN (value::text)::numeric >= 1
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    WHEN 'tournament_minimum_players' THEN
      CASE jsonb_typeof(value)
        WHEN 'number' THEN (value::text)::numeric >= 2
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    WHEN 'tournament_maximum_players' THEN
      CASE jsonb_typeof(value)
        WHEN 'null' THEN true
        WHEN 'number' THEN (value::text)::numeric >= 2
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    WHEN 'tournament_minimum_duration_minutes' THEN
      CASE jsonb_typeof(value)
        WHEN 'number' THEN (value::text)::numeric >= 1
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    WHEN 'tournament_maximum_duration_minutes' THEN
      CASE jsonb_typeof(value)
        WHEN 'number' THEN (value::text)::numeric >= 1
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    WHEN 'tournament_minimum_entry_fee' THEN
      CASE jsonb_typeof(value)
        WHEN 'number' THEN (value::text)::numeric >= 1
          AND (value::text)::numeric = trunc((value::text)::numeric)
        ELSE false
      END
    ELSE jsonb_typeof(value) = 'number'
  END);
