# syntax=docker/dockerfile:1

# --- dev: source montada pelo compose, roda direto com `go run` ---
# ponytail: sem air/reflex. Reinicia o serviço pra recarregar. Adicione air se
# o ciclo de feedback incomodar.
FROM golang:1.23-alpine AS dev
WORKDIR /app
RUN apk add --no-cache git
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
EXPOSE 8080
CMD ["go", "run", "./cmd/api"]

# --- build: binário estático ---
FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /api ./cmd/api

# --- runtime: imagem mínima ---
FROM alpine:3.20 AS runtime
RUN apk add --no-cache ca-certificates
COPY --from=build /api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
