-- Índices p/ a busca pública (item #3). Índice funcional em lower(city) casa
-- com o filtro lower(v.city) = lower($1) — nome próprio porque 0002 já criou
-- idx_venues_city em city (btree simples, não serve p/ lower()).
-- GIN em amenities acelera o operador @>. Texto livre (ILIKE '%q%') fica sem
-- índice no MVP (trigram é melhoria futura).
CREATE INDEX IF NOT EXISTS idx_venues_city_lower ON venues (lower(city));
CREATE INDEX IF NOT EXISTS idx_venues_capacity   ON venues (capacity);
CREATE INDEX IF NOT EXISTS idx_venues_price      ON venues (price_per_day);
CREATE INDEX IF NOT EXISTS idx_venues_amenities  ON venues USING gin (amenities);
