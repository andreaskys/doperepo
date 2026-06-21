-- Estende venues p/ o fluxo de anunciar: localização, geo, comodidades, rascunho,
-- e galeria de fotos.
CREATE TYPE venue_status AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE venues
    ADD COLUMN city      TEXT             NOT NULL DEFAULT '',
    ADD COLUMN state     TEXT             NOT NULL DEFAULT '',
    ADD COLUMN latitude  DOUBLE PRECISION,
    ADD COLUMN longitude DOUBLE PRECISION,
    -- ponytail: amenities como text[] (lista fixa no front). Sem tabelas de join
    -- até existir catálogo dinâmico com metadados.
    ADD COLUMN amenities TEXT[]           NOT NULL DEFAULT '{}',
    ADD COLUMN status    venue_status     NOT NULL DEFAULT 'DRAFT';

CREATE INDEX idx_venues_status ON venues(status);
CREATE INDEX idx_venues_city ON venues(city);

CREATE TABLE venue_photos (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venue_id   BIGINT      NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    object_key TEXT        NOT NULL, -- chave no MinIO (p/ deletar)
    url        TEXT        NOT NULL, -- URL pública p/ <img>
    position   INT         NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_venue_photos_venue_id ON venue_photos(venue_id);
