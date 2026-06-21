-- name: CreateVenue :one
-- Nasce como DRAFT (default da coluna status).
INSERT INTO venues (
    host_id, title, description, capacity, price_per_day,
    address, city, state, latitude, longitude, amenities, features
) VALUES (
    @host_id, @title, @description, @capacity, @price_per_day,
    @address, @city, @state, @latitude, @longitude, @amenities, @features
)
RETURNING *;

-- name: GetVenueByID :one
SELECT * FROM venues WHERE id = $1;

-- name: ListPublishedVenues :many
-- Listagem pública da home: só publicados, com a foto de capa (1ª foto).
SELECT
    v.id, v.title, v.description, v.capacity, v.price_per_day, v.city, v.state,
    COALESCE((SELECT p.url FROM venue_photos p WHERE p.venue_id = v.id ORDER BY p.position, p.id LIMIT 1), '')::text AS cover_url
FROM venues v
WHERE v.status = 'PUBLISHED'
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
    city          = @city,
    state         = @state,
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
