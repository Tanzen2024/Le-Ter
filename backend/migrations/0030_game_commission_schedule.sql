-- Commission des parties ordinaires (D-074, révisée) : prélevée sur les mises des PERDANTS,
-- au taux de la tranche de la mise (barème configurable), doublé par la Kora.
--
-- - Le gagnant n'est plus débité : il garde sa mise. Brut = mise perdue par perdant ×
--   (participants − 1) ; brut = commission + gain net (inchangé).
-- - `commission_bps` reste le taux de la tranche FIGÉ au démarrage ; `applied_commission_bps`
--   est le taux réellement appliqué au règlement (doublé si Kora), aussi écrit dans
--   `platform_ledger.fee_bps`.
-- - Le paramètre `game_commission_percent` (taux unique) est remplacé par
--   `game_commission_schedule` (liste de tranches). Clé absente : barème initial du code.
--
-- Ajouts et remplacements de contraintes seulement ; aucune partie réglée n'est recalculée.
-- Les règlements écrits sous l'ancienne formule (0029, brut = unité × participants) restent
-- valides : la nouvelle contrainte ne s'applique qu'aux lignes ayant `applied_commission_bps`.

ALTER TABLE game_settlements ADD COLUMN applied_commission_bps integer
  CHECK (applied_commission_bps BETWEEN 0 AND 10000);

-- Contrainte SETTLED de 0029 (sans nom) : retrouvée par sa définition.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'game_settlements'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%(unit_amount * participants)%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE game_settlements DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE game_settlements ADD CONSTRAINT game_settlements_settled_amounts_check CHECK (
  status <> 'SETTLED' OR (
    outcome IN ('SIMPLE', 'KORA') AND winner_id IS NOT NULL AND participants >= 2
    AND gross_amount = commission_amount + net_gain
    AND (
      -- 0029 : mise de chaque participant, gagnant compris.
      (applied_commission_bps IS NULL AND gross_amount = unit_amount * participants)
      -- 0030 : mises des perdants seulement.
      OR (applied_commission_bps IS NOT NULL
          AND gross_amount = unit_amount * (participants - 1)))));

DELETE FROM system_settings WHERE key = 'game_commission_percent';
ALTER TABLE system_settings DROP CONSTRAINT system_settings_key_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_check CHECK (key IN (
  'detection_enabled', 'tournament_platform_fee_percent', 'initial_tournament_tokens',
  'default_tournament_stake', 'maximum_pending_tournaments_per_player',
  'tournament_transition_minutes', 'tournament_ranking_tokens_weight_percent',
  'tournament_ranking_games_weight_percent', 'tournament_initial_tokens_coefficient',
  'tournament_stake_per_game_coefficient', 'game_commission_schedule'));

-- 0021 imposait un nombre à toute clé autre que `detection_enabled` : le barème est une liste.
ALTER TABLE system_settings DROP CONSTRAINT system_settings_tournament_number_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_value_type_check CHECK (
  CASE key
    WHEN 'detection_enabled' THEN jsonb_typeof(value) = 'boolean'
    WHEN 'game_commission_schedule' THEN jsonb_typeof(value) = 'array'
    ELSE jsonb_typeof(value) = 'number'
  END);
