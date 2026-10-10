# MinIO Client (mc) - built from source
# KYUN SOURCE SE: minio/mc official image bhi Docker Hub par blocked hai
# ("pull access denied"), isliye binary source se build kar rahe hain.
# Ye sirf bucket provisioning ke liye init container me use hota hai.
FROM golang:1.24-alpine AS builder

ARG MC_VERSION=RELEASE.2024-06-12T14-34-03Z

WORKDIR /build
RUN CGO_ENABLED=0 GOOS=linux go install -ldflags "-s -w" \
    "github.com/minio/mc@${MC_VERSION}"

FROM alpine:3.19
# curl isliye hai kyunki init script provisioning se PEHLE MinIO ke
# /minio/health/live endpoint ko poll karta hai (health-gate, step 0).
# Alpine me curl default nahi aata - bina iske gate chup-chaap fail hoti.
RUN apk add --no-cache ca-certificates curl
COPY --from=builder /go/bin/mc /usr/local/bin/mc

# Provisioning logic + IAM policies travel WITH the image, so the init
# container needs no bind mount and works identically on any host.
COPY init-storage.sh /usr/local/bin/init-storage.sh
COPY policies /policies
RUN chmod +x /usr/local/bin/init-storage.sh

# Default to the provisioning script. The binary is still at /usr/local/bin/mc
# so an operator can drop into this image and run mc by hand.
ENTRYPOINT ["/usr/local/bin/init-storage.sh"]
