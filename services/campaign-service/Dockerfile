# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o campaign-service ./cmd/campaign-service

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/campaign-service .

EXPOSE 8080

ENV PORT=8080
ENV ENVIRONMENT=production

ENTRYPOINT ["/campaign-service"]
