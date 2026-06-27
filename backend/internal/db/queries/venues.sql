-- name: CreateVenue :one
-- Nasce como DRAFT (default da coluna status).
INSERT INTO venues (
    host_id, title, description, capacity, price_per_day,
    address, neighborhood, city, state, complement, cep, latitude, longitude, amenities, features
) VALUES (
    @host_id, @title, @description, @capacity, @price_per_day,
    @address, @neighborhood, @city, @state, @complement, @cep, @latitude, @longitude, @amenities, @features
)
RETURNING *;

-- name: GetVenueByID :one
SELECT * FROM venues WHERE id = $1;

-- name: SearchPublishedVenues :many
-- Listagem pública com filtros opcionais (sentinela vazio = sem filtro).
SELECT
    v.id, v.title, v.description, v.capacity, v.price_per_day, v.city, v.state,
    COALESCE((SELECT p.url FROM venue_photos p WHERE p.venue_id = v.id ORDER BY p.position, p.id LIMIT 1), '')::text AS cover_url
FROM venues v
WHERE v.status = 'PUBLISHED'
  AND (@city::text = '' OR lower(v.city) = lower(@city::text))
  AND (@min_capacity::int = 0 OR v.capacity >= @min_capacity::int)
  AND (@max_price::numeric = 0 OR v.price_per_day <= @max_price::numeric)
  AND (@q::text = '' OR v.title ILIKE '%' || @q::text || '%' OR v.description ILIKE '%' || @q::text || '%')
  AND (cardinality(@amenities::text[]) = 0 OR v.amenities @> @amenities::text[])
ORDER BY v.created_at DESC
LIMIT 60;

-- name: ListVenuesByHost :many
SELECT * FROM venues WHERE host_id = $1 ORDER BY created_at DESC;

-- name: UpdateVenue :one
UPDATE venues SET
    title         = @title,
    description   = @description,
    capacity      = @capacity,
    price_per_day = @price_per_day,
    address       = @address,
    neighborhood  = @neighborhood,
    city          = @city,
    state         = @state,
    complement    = @complement,
    cep           = @cep,
    latitude      = @latitude,
    longitude     = @longitude,
    amenities     = @amenities,
    features      = @features
WHERE id = @id
RETURNING *;

-- name: PublishVenue :one
UPDATE venues SET status = 'PUBLISHED' WHERE id = $1 RETURNING *;

-- name: DeleteVenue :exec
DELETE FROM venues WHERE id = $1;

-- name: AddVenuePhoto :one
INSERT INTO venue_photos (venue_id, object_key, url, position)
VALUES (@venue_id, @object_key, @url, @position)
RETURNING *;

-- name: ListVenuePhotos :many
SELECT * FROM venue_photos WHERE venue_id = $1 ORDER BY position, id;

-- name: GetVenuePhoto :one
SELECT * FROM venue_photos WHERE id = $1;

-- name: DeleteVenuePhoto :exec
DELETE FROM venue_photos WHERE id = $1;

-- name: ListVenuePhotoKeys :many
SELECT object_key FROM venue_photos WHERE venue_id = $1;

-- name: ListPublishedPhotos :many
SELECT p.venue_id, v.title AS venue_title, p.url
FROM venue_photos p
JOIN venues v ON v.id = p.venue_id
WHERE v.status = 'PUBLISHED'
ORDER BY p.venue_id, p.position
LIMIT 30;
