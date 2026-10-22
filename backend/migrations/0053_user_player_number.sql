-- Numéro d'ordre du joueur sur la plateforme (D-133).
--
-- Rang d'inscription : le premier compte créé porte le n° 1, le suivant le n° 2, etc. Attribué
-- une seule fois par PostgreSQL à la création du compte (séquence), jamais par l'application ni
-- par le client ; unique, immuable et jamais réutilisé. Une inscription annulée après le tirage
-- laisse un numéro inutilisé (propriété des séquences) : les numéros restent croissants, sans
-- garantie d'absence de trou.
--
-- Comptes existants : numérotés dans l'ordre de leur création (`created_at`, puis `id` pour
-- départager deux créations simultanées).

CREATE SEQUENCE users_player_number_seq AS bigint;

ALTER TABLE users ADD COLUMN player_number bigint;

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM users
)
UPDATE users u SET player_number = o.n FROM ordered o WHERE u.id = o.id;

SELECT setval(
  'users_player_number_seq',
  COALESCE((SELECT max(player_number) FROM users), 0) + 1,
  false
);

ALTER TABLE users
  ALTER COLUMN player_number SET DEFAULT nextval('users_player_number_seq'),
  ALTER COLUMN player_number SET NOT NULL,
  ADD CONSTRAINT users_player_number_positive CHECK (player_number > 0);

ALTER SEQUENCE users_player_number_seq OWNED BY users.player_number;

CREATE UNIQUE INDEX users_player_number_key ON users (player_number);

-- Immuable : aucune mise à jour ne peut changer le numéro d'un compte.
CREATE FUNCTION users_player_number_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.player_number IS DISTINCT FROM OLD.player_number THEN
    RAISE EXCEPTION 'users.player_number est immuable (compte %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_player_number_guard
  BEFORE UPDATE OF player_number ON users
  FOR EACH ROW EXECUTE FUNCTION users_player_number_guard();
