# Transcoding Service - REAL FFmpeg + MinIO HLS pipeline
#
# KEY DIFFERENCE: ye image purane se bada hai kyunki FFmpeg install hota hai.
# Bina FFmpeg ke HLS transcode POSSIBLE hi nahi - FFmpeg hi .m3u8/.ts
# chunks generate karta hai.
#
# Alpine pe ffmpeg package official community repo se available hai.
#
# COST: FFmpeg aur MinIO dono self-hosted. Koi paid service nahi.
#
# Hinglish comments: har block ka arth

# ---- Stage 1: Build (Go binary compile) ----
FROM golang:1.26-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# CGO off - Alpine runtime me chal sake
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo \
    -o transcoding-service ./cmd/transcoding-service

# ---- Stage 2: Runtime (FFmpeg + binary) ----
FROM alpine:3.19

# ffmpeg      = HLS transcode ke liye (CORE dependency)
# ca-certs    = TLS
# tzdata      = timezone
# curl        = healthcheck
RUN apk add --no-cache ffmpeg ca-certificates tzdata curl

WORKDIR /app

COPY --from=builder /app/transcoding-service .

# Port 8083 - video-core port (aapke spec ke mutabiq)
EXPOSE 8083

ENV PORT=8083
ENV GIN_MODE=release

# Healthcheck - container alive hai ya nahi
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8083/health || exit 1

# Binary WORKDIR /app me hai - RELATIVE path use karte hain.
# Absolute path ("./..." bhool kar "/transcoding-service") root me dhundhta
# hai aur fail hota hai - ye baaki Go services ka common bug tha.
# Hinglish: relative entrypoint zaroori hai
ENTRYPOINT ["./transcoding-service"]
