-- name: CreateUser :one
INSERT INTO users (name, email, password_hash, role)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: UpdateUserRole :one
UPDATE users SET role = $2 WHERE id = $1 RETURNING *;

-- name: UpdateUserProfile :one
UPDATE users SET name = @name, bio = @bio WHERE id = @id RETURNING *;

-- name: UpdateUserAvatar :one
UPDATE users SET avatar_url = @avatar_url WHERE id = @id RETURNING *;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = @password_hash WHERE id = @id;
