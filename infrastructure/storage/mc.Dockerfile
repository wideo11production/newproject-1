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
RUN apk add --no-cache ca-certificates
COPY --from=builder /go/bin/mc /usr/local/bin/mc
ENTRYPOINT ["/usr/local/bin/mc"]
