-- GARAM TIA : plus de détection anti-collusion (D-144, remplace D-125).
--
-- Une table GARAM ne peut plus être créée surveillée : l'API ignore l'option et la base le
-- refuse (contrainte ci-dessous). `suspicion_detection_enabled` reste immuable (D-043,
-- migration 0011) : aucune ligne existante n'est réécrite, d'où `NOT VALID` (seules les
-- nouvelles lignes sont vérifiées). Une ancienne table GARAM surveillée, s'il en existe, est
-- traitée comme non surveillée par l'application (aucune analyse, aucun consentement) ; ses
-- signaux et alertes déjà enregistrés sont conservés (historique, audit).

ALTER TABLE sessions ADD CONSTRAINT sessions_no_detection_for_garam
  CHECK (NOT (game_type = 'GARAM' AND suspicion_detection_enabled)) NOT VALID;
