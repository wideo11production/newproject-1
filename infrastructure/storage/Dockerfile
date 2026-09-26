# ====================================================================
# MINIO - Self-hosted S3-compatible object storage (built from SOURCE)
# ====================================================================
# KYUN SOURCE SE BUILD KAR RAHE HAIN:
# MinIO ka official container image (minio/minio) Docker Hub AUR quay.io
# dono se BLOCKED hai is environment me:
#   "pull access denied / insufficient_scope"  (Docker Hub)
#   "401 UNAUTHORIZED"                          (quay.io)
# Isliye image pull karna possible nahi tha.
#
# MinIO khud ek GO program hai - isliye hum uska binary directly source se
# build karte hain. Isse:
#   - Koi registry dependency nahi (Google/vendor trap avoided)
#   - Binary hamare control me hai
#   - Self-hosted hai - kisi teesre party ko ek bhi penny nahi jaati
#
# Runtime image sirf Alpine + binary hai (~60MB), bahut halki.
#
# Hinglish comments: har block ka arth
FROM golang:1.24-alpine AS builder

ARG MINIO_VERSION=RELEASE.2024-06-13T22-53-53Z

WORKDIR /build

# CGO off karte hain taaki binary static bane (Alpine runtime me chal sake)
# GOFLAGS me mod=mod isliye ki read-only module cache ke saath kaam kare
RUN set -eux; \
    CGO_ENABLED=0 GOOS=linux go install \
      -tags "oss" \
      -ldflags "-s -w" \
      "github.com/minio/minio@${MINIO_VERSION}"; \
    ls -la /go/bin/ || true

# ---- Runtime stage: sirf Alpine + binary ----
FROM alpine:3.19

# ca-certificates: TLS ke liye
# curl: healthcheck ke liye
RUN apk add --no-cache ca-certificates curl

# MinIO binary ko sahi jagah copy karo
COPY --from=builder /go/bin/minio /usr/local/bin/minio

# Data directory - named volume par mount hoga
RUN mkdir -p /data

ENV MINIO_ROOT_USER=${MINIO_ROOT_USER}
ENV MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}

EXPOSE 9000 9001

VOLUME /data

# Healthcheck: MinIO ka live endpoint (curl se, isliye curl install kiya)
HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:9000/minio/health/live || exit 1

# `server /data --console-address :9001`:
#   server   = MinIO start
#   /data    = storage root
#   --console-address :9001 = console UI ka port
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
