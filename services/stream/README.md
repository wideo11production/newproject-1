# Video Transcoding Service

This service handles asynchronous video transcoding using FFmpeg to convert uploaded master files into multiple adaptive bitrate renditions for HLS streaming.

## Features

- Concurrent worker pool for parallel transcoding
- Support for multiple resolutions: 360p, 480p, 720p, 1080p
- HLS (HTTP Live Streaming) manifest generation
- Configurable FFmpeg presets and quality settings
- Job queuing and processing with retry mechanisms
- Progress tracking and status reporting
- Integration with MinIO for input/output storage
- Metadata extraction (duration, resolution, bitrate, etc.)
- Manifest generation for adaptive bitrate streaming

## API Endpoints

### Job Management
1. `POST /api/v1/transcode/jobs` - Submit a new transcoding job
   - Request: `{ "upload_id": "uuid" }`
   - Response: `{ "job_id": "uuid", "status": "submitted" }`

2. `GET /api/v1/transcode/jobs/{job_id}` - Get job status
   - Response: Job details including progress, current step, timestamps

3. `GET /api/v1/transcode/jobs/{job_id}/outputs` - Get job outputs
   - Response: Array of transcoded files with resolutions, bitrates, paths

4. `GET /api/v1/transcode/jobs/{job_id}/manifests` - Get job manifests
   - Response: Array of HLS manifests (main and variant)

5. `DELETE /api/v1/transcode/jobs/{job_id}` - Cancel a job
   - Response: `{ "message": "job cancelled successfully" }`

## Transcoding Pipeline

When a job is processed, the service performs the following steps:

1. **Download**: Fetch the master file from MinIO to temporary storage
2. **Metadata Extraction**: Use FFprobe to get video properties (duration, resolution, etc.)
3. **Transcoding**: For each target resolution (360p, 480p, 720p, 1080p):
   - Scale video to target resolution
   - Encode with specified bitrate and preset
   - Generate HLS segment files
4. **Manifest Generation**:
   - Create individual variant playlists for each resolution
   - Create master manifest that references all variants
5. **Upload**: Upload all generated files to MinIO
6. **Completion**: Mark job as completed and update database

## Output Structure

Transcoded files are stored in MinIO as:
```
transcodes/{job_id}/
├── main.m3u8              # Master manifest
├── 360p.m3u8              # 360p variant playlist
├── 480p.m3u8              # 480p variant playlist
├── 720p.m3u8              # 720p variant playlist
├── 1080p.m3u8             # 1080p variant playlist
├── 360p_00001.ts          # 360p video segments
├── 360p_00002.ts
├── ...                    # Additional segments
├── 480p_00001.ts          # 480p video segments
├── ...                    # And so on for each resolution
```

## Dependencies

- Go 1.22+
- PostgreSQL
- MinIO (self-hosted S3-compatible storage)
- FFmpeg (with libx264 and aac support) OR mock transcoder for development
- Gin web framework
- Google UUID
- MinIO Go SDK
- Lib/pq (PostgreSQL driver)
- Gorilla/securecookie (indirect via sessions)
- Jonboulle/clockindirect via koanf

## Running the Service

```bash
# Development (uses mock transcoder)
go run src/main.go

# Production (requires FFmpeg installation)
# 1. Install FFmpeg: sudo apt-get install ffmpeg
# 2. Run with config pointing to FFmpeg binaries
go run src/main.go

# With Docker (example)
docker build -t video-transcode .
docker run -p 8083:8083 --env-file .env video-transcode
```

## Integration Notes

This service is designed to work with:
- Upload services that notify when uploads are complete (via message queue or database polling)
- CDN or streaming services that serve the HLS manifests and segments
- Notification systems that alert users when processing is complete
- Storage lifecycle policies that manage retention of transcoded assets

The service does not handle upload ingestion itself - it focuses solely on transcoding completed uploads into adaptive bitrate streams.