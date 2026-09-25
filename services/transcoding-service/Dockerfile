# Transcoding Service Dockerfile
# Multi-stage build for FFmpeg-based video transcoding service
# Runs OUTSIDE GKE compute nodes - on dedicated transcoding infrastructure
# Output stored directly in MinIO/GCS 'video' bucket
# Streaming happens directly from storage bucket/CDN, bypassing GKE completely

# Stage 1: Builder - Compile Go application
FROM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git make

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY cmd/ ./cmd/
COPY src/ ./src/

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o transcoding-service ./cmd/main.go

# Stage 2: Runtime - Minimal image with FFmpeg
FROM alpine:3.18

# Install FFmpeg and runtime dependencies
# FFmpeg for HLS transcoding - CORE REQUIREMENT for video processing
# All video transcoding happens here, NOT in GKE pods
RUN apk add --no-cache \
    ffmpeg \
    ca-certificates \
    tzdata \
    curl

# Create non-root user for security
RUN addgroup -g 1000 -S transcoding && \
    adduser -u 1000 -S transcoding -G transcoding

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/transcoding-service .

# Create directories for temporary processing
RUN mkdir -p /tmp/transcoding && chown -R transcoding:transcoding /tmp/transcoding

# Switch to non-root user
USER transcoding

# Expose port (8083 for video-core as specified)
EXPOSE 8083

# Health check for Kubernetes
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8083/health || exit 1

# Run the transcoding service
ENTRYPOINT ["./transcoding-service"]

# Environment variables for configuration
ENV PORT=8083
ENV MINIO_ENDPOINT=minio:9000
ENV MINIO_ACCESS_KEY=minioadmin
ENV MINIO_SECRET_KEY=minioadmin
ENV GCS_BUCKET=video
ENV FFMPEG_THREADS=4