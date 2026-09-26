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

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o dashboard-service ./cmd/dashboard-service

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/dashboard-service .

EXPOSE 8080

ENV PORT=8080
ENV ENVIRONMENT=production

# Binary WORKDIR /app ke andar hai, isliye relative path use karte hain
# Absolute "/dashboard-service" root path dhundhta hai aur binary /app me hone se fail hota tha
ENTRYPOINT ["./dashboard-service"]
