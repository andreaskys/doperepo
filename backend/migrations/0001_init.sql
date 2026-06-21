-- Schema inicial do MVP de aluguel de espaços.
-- citext  -> e-mail case-insensitive com UNIQUE nativo (sem lower() na app).
-- btree_gist -> permite misturar igualdade (venue_id) com overlap de range de
--               datas numa única exclusion constraint (a trava anti-overbooking
--               no nível do banco).
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role AS ENUM ('GUEST', 'HOST');
CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT          NOT NULL,
    email         CITEXT        NOT NULL UNIQUE,
    password_hash TEXT          NOT NULL,
    role          user_role     NOT NULL DEFAULT 'GUEST',
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE venues (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    host_id       BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT          NOT NULL,
    description   TEXT          NOT NULL DEFAULT '',
    capacity      INT           NOT NULL CHECK (capacity > 0),
    price_per_day NUMERIC(12,2) NOT NULL CHECK (price_per_day >= 0),
    address       TEXT          NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_venues_host_id ON venues(host_id);

CREATE TABLE bookings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venue_id    BIGINT         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    guest_id    BIGINT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date  DATE           NOT NULL,
    end_date    DATE           NOT NULL,
    total_price NUMERIC(12,2)  NOT NULL CHECK (total_price >= 0),
    status      booking_status NOT NULL DEFAULT 'PENDING',
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CHECK (start_date < end_date)
);
CREATE INDEX idx_bookings_venue_id ON bookings(venue_id);
CREATE INDEX idx_bookings_guest_id ON bookings(guest_id);

-- Garantia dura no nível do banco: duas reservas ativas do mesmo espaço não
-- podem ter datas sobrepostas. Isso COMPLEMENTA (não substitui) o SELECT FOR
-- UPDATE da API — o lock serializa o check-then-insert; esta constraint é a
-- rede de segurança caso a lógica da app tenha uma brecha.
-- daterange '[)' é semi-aberto: reservas encostadas (uma termina onde a outra
-- começa) NÃO colidem.
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (
        venue_id WITH =,
        daterange(start_date, end_date, '[)') WITH &&
    ) WHERE (status <> 'CANCELLED');
