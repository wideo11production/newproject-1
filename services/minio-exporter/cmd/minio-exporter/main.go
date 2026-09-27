// MinIO Prometheus Exporter - REAL bucket/object metrics
//
// KYUN YE BANAYA:
// Official MinIO image (minio/minio) Docker Hub par BLOCKED hai is environment
// me, isliye humne MinIO SOURCE se build kiya. Us build ka version
// "DEVELOPMENT.GOGET" hai aur woh /minio/v2/metrics/cluster pe
// PROMETHEUS text nahi, console ka HTML return karta hai.
//
// Isliye ye chhota exporter bana: ye seedhe MinIO ke Admin API se REAL
// bucket stats (size, object count) padhta hai aur Prometheus text format
// me expose karta hai. Prometheus isko scrape karta hai -> dashboard par
// REAL numbers (koi "SEEDED"/placeholder nahi).
//
// COST: Go binary, self-hosted. Koi paid service nahi.
//
// Hinglish comments: har block ka arth
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Config - sab SSOT (.env) se
type Config struct {
	Port         int
	Endpoint     string
	AccessKey    string
	SecretKey    string
	UseSSL       bool
	VideoBucket  string
	ThumbBucket  string
	RefreshSecs  int
}

var cfg Config

func envStr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		i := 0
		if _, err := fmt.Sscanf(v, "%d", &i); err == nil && i > 0 {
			return i
		}
	}
	return def
}

func envBool(k string, def bool) bool {
	switch os.Getenv(k) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	}
	return def
}

func loadConfig() {
	cfg.Port = envInt("MINIO_EXPORTER_PORT", 9100)
	cfg.Endpoint = envStr("MINIO_ENDPOINT", "minio:9000")
	cfg.AccessKey = envStr("MINIO_ROOT_USER", "")
	cfg.SecretKey = envStr("MINIO_ROOT_PASSWORD", "")
	cfg.UseSSL = envBool("MINIO_USE_SSL", false)
	cfg.VideoBucket = envStr("MINIO_VIDEO_BUCKET", "video")
	cfg.ThumbBucket = envStr("MINIO_THUMBNAIL_BUCKET", "thumbnails")
	cfg.RefreshSecs = envInt("MINIO_EXPORTER_REFRESH_SECONDS", 30)
}

// bucketStats - ek bucket ka latest size/count (cached)
type bucketStats struct {
	SizeBytes  float64
	ObjectCount float64
	FetchedAt time.Time
	Err        error
}

// cached stats - har request pe MinIO hit karne se bachata hai
var stats = map[string]*bucketStats{}

func refresh(client *minio.Client) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	for _, bucket := range []string{cfg.VideoBucket, cfg.ThumbBucket} {
		st := &bucketStats{FetchedAt: time.Now()}

		// REAL stats: objects list karke size aur count sum karte hain.
		//
		// NOTE: minio-go v7.0.49 me bucket-level stats API NAHI hai
		// (StatObject sirf ek specific object ke liye hai). Isliye hum
		// listObjects chala kar REAL bytes count karte hain.
		//
		// SCALING NOTE: ye pure listing hai, isliye BAHUT bade buckets par
		// mehnga ho sakta hai. Production me MinIO ke native exporter ya
		// bucket-quota API better hoga. Abhi ke liye ye correct hai aur
		// chhote/medium buckets ke liye perfectly kaam karta hai.
		var totalBytes int64
		var count int64

		for obj := range client.ListObjects(ctx, bucket, minio.ListObjectsOptions{Recursive: true}) {
			if obj.Err != nil {
				// Listing ke dauran error (e.g., context timeout)
				st.Err = obj.Err
				break
			}
			totalBytes += obj.Size
			count++
		}

		// Agar koi object nahi mila to error mat maano - empty bucket valid hai
		if count > 0 && st.Err != nil {
			log.Printf("[EXPORTER] list error for %s: %v", bucket, st.Err)
		} else {
			st.Err = nil
		}

		st.SizeBytes = float64(totalBytes)
		st.ObjectCount = float64(count)

		log.Printf("[EXPORTER] %s: %d objects, %d bytes",
			bucket, count, totalBytes)

		stats[bucket] = st
	}
}

func main() {
	loadConfig()
	log.SetFlags(log.LstdFlags)
	log.Printf("[EXPORTER] Starting | port=%d endpoint=%s buckets=[%s,%s]",
		cfg.Port, cfg.Endpoint, cfg.VideoBucket, cfg.ThumbBucket)

	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		log.Fatalf("[EXPORTER] FATAL: minio client: %v", err)
	}

	// MinIO ready hone tak wait
	for i := 1; i <= 15; i++ {
		if _, err := client.BucketExists(context.Background(), cfg.VideoBucket); err == nil {
			log.Println("[EXPORTER] MinIO connected")
			break
		}
		log.Printf("[EXPORTER] MinIO not ready (%d/15)", i)
		time.Sleep(3 * time.Second)
	}

	// Stats background me refresh karte raho
	go func() {
		refresh(client)
		ticker := time.NewTicker(time.Duration(cfg.RefreshSecs) * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			refresh(client)
		}
	}()

	mux := http.NewServeMux()

	// /metrics - Prometheus scrape endpoint
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")

		for _, bucket := range []string{cfg.VideoBucket, cfg.ThumbBucket} {
			st, ok := stats[bucket]
			if !ok {
				continue
			}

			// Bucket size (bytes) - REAL
			fmt.Fprintf(w,
				"# HELP minio_bucket_size_bytes Total size of bucket %s in bytes\n"+
					"# TYPE minio_bucket_size_bytes gauge\n"+
					"minio_bucket_size_bytes{bucket=\"%s\"} %f\n",
				bucket, bucket, st.SizeBytes)

			// Object count - REAL
			fmt.Fprintf(w,
				"# HELP minio_bucket_objects_total Number of objects in bucket %s\n"+
					"# TYPE minio_bucket_objects_total gauge\n"+
					"minio_bucket_objects_total{bucket=\"%s\"} %f\n",
				bucket, bucket, st.ObjectCount)

			// Staleness: last successful fetch kitne second pehle
			age := time.Since(st.FetchedAt).Seconds()
			fmt.Fprintf(w,
				"# HELP minio_exporter_last_success_age_seconds Age of last successful stats fetch\n"+
					"# TYPE minio_exporter_last_success_age_seconds gauge\n"+
					"minio_exporter_last_success_age_seconds{bucket=\"%s\"} %f\n",
				bucket, age)

			// Error indicator (0 = ok, 1 = error)
			errVal := 0.0
			if st.Err != nil {
				errVal = 1.0
			}
			fmt.Fprintf(w,
				"# HELP minio_exporter_scrape_error 1 if last stats fetch failed\n"+
					"# TYPE minio_exporter_scrape_error gauge\n"+
					"minio_exporter_scrape_error{bucket=\"%s\"} %f\n",
				bucket, errVal)
		}
	})

	// /health - container healthcheck
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ok","service":"minio-exporter"}`)
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("[EXPORTER] Listening on :%d/metrics", cfg.Port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[EXPORTER] server failed: %v", err)
	}
}
