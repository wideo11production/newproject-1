# Currency Service - Multi-currency microservice
# Ye service exchange_rates table ko SSOT (single source of truth) banati hai.
# Baaki sab services WAHI table se rates padhte hain - isliye har request pe
# rate fetch/update karne ki zaroorat NAHI.
#
# Hinglish comments: har block ka arth
# NOTE: Go 1.26 use kiya ja raha hai kyunki dependencies ka go directive
# "1.25"/"1.26" hai. 1.24 image par build fail hota tha:
#   "go.mod requires go >= 1.25.0 (running go 1.24.x; GOTOOLCHAIN=local)"
# Same fix jo auth-service me kiya tha.
FROM golang:1.26-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# CGO off - Alpine runtime me chal sake
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o currency-service ./cmd/currency-service

# Runtime stage
FROM alpine:3.19

# ca-certificates: TLS ke liye
# tzdata: timezone handling
# curl: healthcheck ke liye
RUN apk add --no-cache ca-certificates tzdata curl

WORKDIR /app

COPY --from=builder /app/currency-service .

# Port 8086 - auth(8085) ke baad, koi conflict nahi
EXPOSE 8086

ENV PORT=8086
ENV ENVIRONMENT=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8086/health || exit 1

# Binary WORKDIR /app me hai - relative path use karte hain
# (absolute path root me dhundhta hai aur fail hota hai - ye doosre services
#  ka ek common bug tha)
ENTRYPOINT ["./currency-service"]
