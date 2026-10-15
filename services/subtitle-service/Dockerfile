# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o subtitle-service ./cmd/subtitle-service

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/subtitle-service .

EXPOSE 8090

ENV PORT=8090
ENV ENVIRONMENT=production

# NOTE: was `["/subtitle-service"]` — the binary is copied into /app by the
# line above, so the absolute root path never existed. Same bug that hit
# analytics-service first (see SERVICE-TRIAGE.md): a Dockerfile that has
# never been built hides this completely.
ENTRYPOINT ["/app/subtitle-service"]
