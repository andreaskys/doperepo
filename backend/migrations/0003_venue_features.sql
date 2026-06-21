-- "O que tem no espaço": etiquetas livres digitadas pelo HOST, separadas das
-- amenities (lista fixa). text[] como as amenities.
ALTER TABLE venues ADD COLUMN features TEXT[] NOT NULL DEFAULT '{}';
