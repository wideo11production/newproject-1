# MinIO Prometheus Exporter
# Ye chhota service REAL MinIO bucket stats padhke Prometheus text format
# me expose karti hai. Official MinIO image blocked hone ki wajah se humne
# MinIO source se build kiya tha, aur us build ka metrics path HTML deta hai -
# isliye ye exporter zaroori thi (koi placeholder "SEEDED" value nahi).
#
# Hinglish comments: har block ka arth
FROM golang:1.26-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo \
    -o minio-exporter ./cmd/minio-exporter

FROM alpine:3.19
RUN apk add --no-cache ca-certificates curl
WORKDIR /app
COPY --from=builder /app/minio-exporter .

# Port 9100 - node-exporter style convention (Prometheus scrape port)
EXPOSE 9100
ENV PORT=9100

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:9100/health || exit 1

ENTRYPOINT ["./minio-exporter"]
