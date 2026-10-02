# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o analytics-service ./cmd/analytics-service

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Absolute destination, because ENTRYPOINT below is an absolute path.
#
# The binary was copied to `/app/analytics-service` while `ENTRYPOINT` is
# `["/analytics-service"]`, so the runtime failed with
# `stat /analytics-service: no such file or directory`. This Dockerfile had
# never been built before, which is the only reason the mismatch survived.
#
# Fixing the destination rather than the ENTRYPOINT: an absolute entrypoint
# cannot be affected by WORKDIR, so the image behaves the same no matter what
# the working directory is set to later.
COPY --from=builder /app/analytics-service /analytics-service

# Port note
# -------
# This said 8086 while the service actually listened on 8091 (`server.port` in
# `src/config/config.go`, and `SERVER_PORT` from compose). Two numbers for one
# service is how someone ends up debugging the wrong port.
#
# The runtime port comes from `SERVER_PORT`, not from `ENV PORT` below - the Go
# process reads viper, not the environment, so `ENV PORT` here is documentation
# only. Kept only so `docker inspect` shows something sensible.
EXPOSE 8091

ENV PORT=8091
ENV ENVIRONMENT=production

ENTRYPOINT ["/analytics-service"]
