# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

# Copy go.mod first, then go.sum if exists, then download deps
# This handles missing go.sum gracefully during build
COPY go.mod ./
COPY go.sum* ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o billing-service ./cmd/billing-service

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/billing-service .

EXPOSE 8082

ENV PORT=8082
ENV ENVIRONMENT=production

# Binary WORKDIR /app ke andar hai, isliye relative path use karte hain
# Absolute "/billing-service" root path dhundhta hai aur binary /app me hone se fail hota tha
ENTRYPOINT ["./billing-service"]
