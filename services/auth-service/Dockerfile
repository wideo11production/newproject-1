# Build stage
# NOTE: Go 1.26 use kiya ja raha hai (pehle 1.24 tha) kyunki go-webauthn ke
# dependencies (jaise golang.org/x/crypto v0.57.0) ka go directive "1.26.0" hai.
# 1.24 image par build fail ho jata tha:
#   "go.mod requires go >= 1.26.0 (running go 1.24.13; GOTOOLCHAIN=local)"
# Baaki Go services 1.22/1.24 par hi kaaam kar rahi hain - unhe touch nahi kiya.
FROM golang:1.26-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o auth-service ./cmd/auth-service

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/auth-service .

# Port 8085: 8081 already webhook-receiver ka hai, isliye auth-service ke liye
# alag port rakha gaya hai taaki do services collide na karein
# Hinglish: port collision avoid karne ke liye 8085 use kiya
EXPOSE 8085

ENV PORT=8085
ENV ENVIRONMENT=production

# Binary WORKDIR /app ke andar hai, isliye relative path use karte hain.
# Absolute "/auth-service" root path dhundhta hai aur binary /app me hone se fail hota tha
# Hinglish: relative entrypoint zaroori hai warna container start hi nahi hoga
ENTRYPOINT ["./auth-service"]
