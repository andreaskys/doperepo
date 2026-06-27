-- name: CreateNotification :exec
INSERT INTO notifications (user_id, booking_id, type)
VALUES (@user_id, @booking_id, @type);

-- name: ListNotificationsByUser :many
SELECT n.id, n.type, n.read, n.created_at,
       n.booking_id, v.title AS venue_title, b.start_date, b.end_date
FROM notifications n
JOIN bookings b ON b.id = n.booking_id
JOIN venues v ON v.id = b.venue_id
WHERE n.user_id = $1
ORDER BY n.created_at DESC
LIMIT 20;

-- name: CountUnreadNotifications :one
SELECT count(*) FROM notifications WHERE user_id = $1 AND read = false;

-- name: MarkNotificationsRead :exec
UPDATE notifications SET read = true WHERE user_id = $1 AND read = false;
