-- Nom et mot de passe d'une partie privée (D-039).
--
-- Pour le joueur, une « partie privée » est la table qu'il ouvre : son nom et son mot de
-- passe appartiennent donc à la SESSION (D-033), concept technique qui porte les parties
-- successives. Ils sont fixés à la création et ne changent plus.
--
-- `name` : visible dans la liste « Rechercher une partie » (1 à 40 caractères). Les
-- sessions antérieures n'en ont pas : l'interface affiche alors « Partie de <créateur> ».
-- `password_hash` : hash bcrypt du mot de passe facultatif ; jamais le mot de passe en clair,
-- jamais exposé par l'API (seulement `hasPassword`).

ALTER TABLE sessions
  ADD COLUMN name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 40),
  ADD COLUMN password_hash text;
