-- Bornes du nombre de joueurs d'un tournoi, réglables par l'administration.
--
-- `tournament_minimum_players` : plus petit minimum de participants accepté à la création d'un
-- tournoi (entier ≥ 2 ; valeur initiale du code : 20).
-- `tournament_maximum_players` : plus grand maximum accepté ; JSON `null` = aucun plafond (∞,
-- valeur initiale du code). Remplacent les bornes fixes 20 à 1 000 (D-057, D-103).
--
-- Nouvelles clés seulement : aucune ligne n'est insérée. Tant qu'une clé n'a jamais été
-- enregistrée, le serveur applique la valeur initiale du code. Aucun tournoi n'est modifié.

ALTER TABLE system_settings DROP CONSTRAINT system_settings_key_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_check CHECK (key IN (
  'detection_enabled', 'tournament_platform_fee_percent', 'initial_tournament_tokens',
  'default_tournament_stake', 'maximum_pending_tournaments_per_player',
  'tournament_transition_minutes', 'tournament_ranking_tokens_weight_percent',
  'tournament_ranking_games_weight_percent', 'tournament_initial_tokens_coefficient',
  'tournament_stake_per_game_coefficient', 'game_commission_schedule',
  'withdrawal_limit_count', 'withdrawal_limit_period',
  'tournament_minimum_players', 'tournament_maximum_players'));

-- Joueurs : entier ≥ 2 ; maximum : JSON `null` (∞) aussi. CASE imbriqués : la conversion
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
    ELSE jsonb_typeof(value) = 'number'
  END);
