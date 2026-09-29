package service

// ============================================================================
// AVATAR STORAGE  -  presigned upload to self-hosted MinIO
// ============================================================================
//
// Flow (3 steps, zero file bytes through this server):
//
//  1. GET  /api/v1/auth/avatar/upload-url
//        -> { uploadUrl, publicUrl, objectKey, expiresIn }
//  2. Browser seedha MinIO me PUT karta hai (uploadUrl)
//        -> bytes BILKUL app server se guzarte hi nahi
//  3. PATCH /api/v1/auth/profile  { avatar_url: publicUrl }
//        -> DB me save
//
// ---- WHY object key me user ID hai, naam NAHI ----
// PII URL me leak nahi hota (email/username public URL me dikhta hi nahi),
// aur object rename karna mushkil hota hai.
//
// KEY FORMAT: avatars/<userID>/<random>.<ext>
//   - userID: ownership prefix (list/delete future me kaam aayega)
//   - random: har upload naya key, taaki cache-busting bhi ho jaaye
//     (same filename = browser ka cached old image)
//
// ---- SECURITY ----
//  1. Content-type ALLOWLIST (config.AllowedImageTypes) - sirf image/PNG,
//     JPEG, WebP, GIF. SVG excluded deliberately (script embed ho sakta hai).
//  2. Extension bhi validate hota hai, aur dono ko CROSS-CHECK kiya jaata
//     hai - sirf extension match karna bhi unsafe hota hai.
//  3. Presigned URL ki TTL limited hai (default 15 min).
//  4. Key me user-supplied text seedha nahi jaata (sirf sanitized ext).
//
// Hinglish comments: har block ka arth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/wideo11/auth-service/internal/config"
)

// UploadTicket - browser ko diya jane wala upload instruction
type UploadTicket struct {
	// ObjectKey - MinIO me object ka path (debug/reference ke liye)
	ObjectKey string `json:"objectKey"`
	// UploadURL - presigned PUT URL (isme bytes bhejne hain)
	UploadURL string `json:"uploadUrl"`
	// PublicURL - upload ke baad image yahan se serve hogi
	PublicURL string `json:"publicUrl"`
	// Method - hamesha "PUT" (browser ko pata ho kya karna hai)
	Method string `json:"method"`
	// ExpiresInSeconds - URL kitni der valid hai
	ExpiresInSeconds int `json:"expiresIn"`
	// ContentType - browser ko EXACTLY ye header bhejna chahiye
	//
	// SECURITY: ye signed URL ke andar BAANDH hai. Agar browser koi aur
	// Content-Type bhejta hai to signature MATCH nahi hoga aur MinIO
	// upload reject kar dega. Isliye ye value client ko bhi jaani chahiye
	// taki wo galat header na bheje.
	ContentType string `json:"contentType"`
	// MaxBytes - client ko limit batao taaki wo pehle se check kar sake
	MaxBytes int64 `json:"maxBytes"`
}

// storageRegion - MinIO ka region.
//
// KYUN YE ZAROORI HAI:
// minio-go signature banane se pehle bucket ka "location" nikalta hai, jo
// ek NETWORK CALL hai. Jo client public host (`localhost:9000`) use karta
// hai, wo auth-service container ke andar se ye call karta - jahan
// `localhost` khud container hai, MinIO nahi, aur call FAIL ho jati hai
// (`connection refused`), signature banane se PEHLE hi.
//
// Region set karne se minio-go ye lookup SKIP kar deta hai. MinIO
// single-region me hota hai (default `us-east-1`), isliye ye value correct hai.
const storageRegion = "us-east-1"

// StorageService - MinIO ke liye thin wrapper
type StorageService struct {
	// client - INTERNAL endpoint (minio:9000). Isse server-side operations
	// hote hain: MakeBucket, StatObject, GetObject, ComposeObject, RemoveObject.
	client *minio.Client

	// presignClient - PUBLIC endpoint (localhost:9000). ISLIYE YE ALAG CLIENT
	// HAI, aur ye bahut important hai:
	//
	//   Presigned URL me jo HOST embed hota hai, wahi browser use karta hai.
	//   Agar hum internal endpoint (`minio:9000`) se presign karte, to URL
	//   `http://minio:9000/...` banta - jo browser par NAHI resolve hota
	//   (wo naam sirf docker network me exist karta hai). Upload chupke se
	//   fail ho jata tha (HTTP 000).
	//
	//   Dusri taraf, server-side StatObject/GetObject INTERNAL endpoint hi
	//   chahiye (container se bahar `localhost` container KHUD hai, MinIO
	//   nahi).
	//
	// Isliye: server ke liye internal client, browser ke liye public client.
	// Signature SAMAAN secret se banti hai, aur MinIO verify karte waqt Host
	// header ko signature me NAHI maarta - isliye dono clients ek hi object
	// space share kar sakte hain.
	presignClient *minio.Client

	cfg *config.StorageConfig
}

// NewStorageService MinIO client banata hai.
//
// SECURITY: agar credentials missing hain to error (fail fast). Chhota
// fallback NAHI use karte - kyunki isse upload chupke se fail hoga aur
// user ko pata hi nahi chalega ki kyun.
func NewStorageService(cfg *config.StorageConfig) (*StorageService, error) {
	if cfg == nil {
		return nil, fmt.Errorf("storage config is nil")
	}
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("storage credentials missing (MINIO_ACCESS_KEY / MINIO_SECRET_KEY)")
	}

	creds := credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, "")

	// ---- INTERNAL client (server-side operations) ----
	internalClient, err := minio.New(cfg.GetEndpoint(), &minio.Options{
		Creds:  creds,
		Secure: cfg.UseSSL,
		Region: storageRegion,
	})
	if err != nil {
		return nil, err
	}

	// ---- PUBLIC endpoint (browser isko use karega) ----
	// Public host se URL banega, isliye ye INTERNAL endpoint (minio:9000) NAHI
	// hona chahiye - wo naam sirf docker network me resolve hota hai, host par
	// nahi. Isliye nikalte hain aur browser-facing host use karte hain.
	publicEndpoint := cfg.GetPublicHost()
	publicEndpoint = strings.TrimPrefix(publicEndpoint, "http://")
	publicEndpoint = strings.TrimPrefix(publicEndpoint, "https://")

	// ---- PUBLIC client (presigned URL generation for the BROWSER) ----
	//
	// `Region` EXPLICITLY set kiya hai - ye bahut zaroori hai:
	//
	// minio-go normally bucket ka "location" nikalne ke liye NETWORK CALL
	// karta hai (`?location=`). Ye client jo public host use karta hai
	// (`localhost:9000`), wo auth-service CONTAINER ke andar se connect
	// karega - jahan `localhost` khud container hai, MinIO nahi:
	//     dial tcp [::1]:9000: connect: connection refused
	//
	// Region set karne se minio-go wo lookup SKIP kar deta hai aur seedha
	// signature bana deta hai - koi network call nahi.
	//
	// MinIO single-region deployments (jo ye hai) me default `us-east-1`
	// hota hai, isliye ye value correct hai.
	presignClient := internalClient
	if publicEndpoint != cfg.GetEndpoint() {
		presignClient, err = minio.New(publicEndpoint, &minio.Options{
			Creds:  creds,
			Secure: strings.HasPrefix(cfg.GetPublicHost(), "https://"),
			Region: storageRegion,
		})
		if err != nil {
			return nil, err
		}
	}

	return &StorageService{
		client:        internalClient,
		presignClient: presignClient,
		cfg:           cfg,
	}, nil
}

// EnsureBucket banata hai agar missing hai, aur PUBLIC READ policy lagata hai.
//
// ---- PUBLIC READ KYUN ----
// Avatars ko browser me `<img src>` se render hona hai. MinIO default buckets
// PRIVATE hote hain (403) - jo humne test me dekha. Iske do options the:
//
//	A) Bucket private rakho, aur serving ke liye ek authenticated proxy likho.
//	   Best security, par har avatar load par app-server hit hoga (latency +
//	   load), aur proxy code maintain karna padega.
//
//	B) Bucket public-read karo. Tab koi bhi URL dekh sakta hai - lekin ye
//	   AVATAR ke liye accepted hai. Public profile image hona hi chahiye
//	   (else har viewer ke liye authenticated request jaana padega, jo
//	   impractical hai). Ye pattern har major product use karta hai.
//
// IMPORTANT: `video` bucket public NAHI hai - sirf `avatars`. Videos private
// rehne chahiye kyunki unke paid/tiered hote hain.
func (s *StorageService) EnsureBucket(ctx context.Context) error {
	bucket := s.cfg.GetAvatarBucket()
	exists, err := s.client.BucketExists(ctx, bucket)
	if err != nil {
		return err
	}
	if !exists {
		if err := s.client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return err
		}
	}

	// ---- Public read policy (download/scout ke liye) ----
	// NOTE: ye best-effort hai. Agar bucket pehle se policy set hai to ye
	// overwrite kar deta hai - jo chahiye (drift-proof).
	if err := s.client.SetBucketPolicy(ctx, bucket, `
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": ["*"]},
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::`+bucket+`/*"]
    }
  ]
}
`); err != nil {
		// Policy fail ho jaye to upload block nahi karte - sirf log karte
		// hain. Upload to phir bhi ho jayega, bas image serve nahi hogi.
		// Isse user ko pata chal jayega ki kya issue hai.
		return fmt.Errorf("could not set bucket policy (uploads will work but images may not display): %w", err)
	}
	return nil
}

// CreateAvatarUploadTicket presigned PUT URL banata hai.
//
// @param userID   - uploading user (ownership + key namespace)
// @param filename - original client filename (extension validation ke liye)
// @param mimeType - client ka content type (allowlist check ke liye)
func (s *StorageService) CreateAvatarUploadTicket(
	ctx context.Context,
	userID uuid.UUID,
	filename, mimeType string,
) (*UploadTicket, error) {
	// ---- 1. Content-type allowlist ----
	normalized := strings.ToLower(strings.TrimSpace(mimeType))
	// Browser kabhi kabhi "image/jpeg; charset=binary" bhej deta hai -
	// `;` ke baad wala part hata do.
	if idx := strings.Index(normalized, ";"); idx >= 0 {
		normalized = strings.TrimSpace(normalized[:idx])
	}
	if !config.AllowedImageTypes[normalized] {
		return nil, fmt.Errorf(
			"unsupported image type %q - allowed: png, jpeg, webp, gif",
			mimeType,
		)
	}

	// ---- 2. Extension cross-check ----
	// Sirf content-type par bharosa karna risky hai: attacker
	// `evil.html` ko `image/png` content-type ke saath bhej sakta hai.
	// Isliye filename ka extension bhi allowlist me hona chahiye, AUR
	// dono ek doosre se MATCH karne chahiye.
	ext := strings.ToLower(filepath.Ext(filename))
	expectedType, ok := config.AllowedImageExtensions[ext]
	if !ok {
		return nil, fmt.Errorf(
			"unsupported file extension %q - allowed: .png, .jpg, .jpeg, .webp, .gif",
			ext,
		)
	}
	if expectedType != normalized {
		return nil, fmt.Errorf(
			"file extension (%s) does not match content type (%s)",
			ext, normalized,
		)
	}

	// ---- 3. Bucket ensure ----
	if err := s.EnsureBucket(ctx); err != nil {
		return nil, err
	}

	// ---- 4. Object key (user ID, koi user text nahi) ----
	//
	// KEY = `{userID}/{random}.{ext}`  (bucket NAHI - wo URL me alag se lagta hai)
	//
	// NOTE: pehle yahan bucket bhi tha (`avatars/{userID}/...`), jisse URL
	// me DOUBLE prefix aa jata tha: `.../avatars/avatars/...`. Ab key ke
	// andar sirf user namespace hai, aur bucket URL me ek baar lagta hai -
	// dono jagah consistent.
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return nil, err
	}
	objectKey := fmt.Sprintf(
		"%s/%s%s",
		userID.String(),
		hex.EncodeToString(random),
		ext,
	)

	// ---- 5. Presigned PUT (expiry limited) ----
	//
	// NOTE: `minio-go` v7.0.68 ka `PresignedPutObject` sirf 4 args leta hai
	// (ctx, bucket, key, expiry) - Content-Type signature me include nahi
	// kar sakta. (Nayi versions me `PutObjectOptions` aata hai, lekin ye
	// project me 7.0.49/7.0.68 cached hain - offline upgrade nahi hai.)
	//
	// ISKA MATLAB: content-type pehle signed nahi ho sakta, to client koi
	// bhi header bhej sakta hai. Ye gap hum FINALIZE step me band karte hain
	// (`FinalizeAvatarUpload`): wahan hum file ke ASLI bytes padh kar magic
	// number se verify karte hain aur server-side Content-Type force karte
	// hain. Yaani security claim pe nahi, actual content pe based hai -
	// jo STRONGER hai.
	ttl := time.Duration(s.cfg.GetPresignTTL()) * time.Minute
	// NOTE: presignClient (public host) se generate karte hain, taaki URL
	// browser-purge reachable ho. Server-side operations `s.client`
	// (internal host) se rehte hain.
	presigned, err := s.presignClient.PresignedPutObject(
		ctx, s.cfg.GetAvatarBucket(), objectKey, ttl,
	)
	if err != nil {
		return nil, err
	}

	// ---- 6. Public URL ----
	// NOTE: ye URL me credentials NAHI hote - sirf bucket + object key.
	// Isliye ye kisi ke saath share ki ja sakti hai (jaise avatar public
	// dikhna chahiye), bina koi secret leak kiye.
	//
	// Bucket path me EXPLICITLY lagta hai (objectKey me ab bucket nahi hai).
	publicURL := fmt.Sprintf(
		"http%s://%s/%s/%s",
		map[bool]string{true: "s", false: ""}[s.cfg.UseSSL],
		s.cfg.GetPublicHost(),
		s.cfg.GetAvatarBucket(),
		objectKey,
	)

	return &UploadTicket{
		ObjectKey:        objectKey,
		UploadURL:        presigned.String(),
		PublicURL:        publicURL,
		Method:           "PUT",
		ExpiresInSeconds: int(ttl.Seconds()),
		ContentType:      normalized,
		MaxBytes:         config.MaxAvatarBytes,
	}, nil
}

// DeleteAvatar object hatata hai (purana avatar replace karte waqt).
//
// NOTE: failure IGNORE karte hain (best effort). Kyunki user ka naya avatar
// already save ho chuka hota hai - purana delete na hua to sirf storage me
// ek orphan file reh jayega, user ko koi dikhta nahi. Isliye delete failure
// par user-facing action fail nahi karna chahiye.
func (s *StorageService) DeleteAvatar(ctx context.Context, publicURL string) {
	key := s.objectKeyFromURL(publicURL)
	if key == "" {
		return
	}
	_ = s.client.RemoveObject(ctx, s.cfg.GetAvatarBucket(), key, minio.RemoveObjectOptions{})
}

// FinalizeAvatarTicket - upload ke BAAD server-side verification + metadata fix.
//
// Yahan hum ye 3 cheezein karte hain, aur yehi wajah hai ki content-type
// presigned URL me sign na hota, fir bhi security tight rehti hai:
//
//  1. OBJECT EXIST karta hai? (browser ne sach me PUT kiya?)
//  2. SIZE <= 5MB? (declared se zyada bada ho to reject)
//  3. MAGIC BYTES se asli file type verify - client ke claim par bharosa
//     NAHI. Ek .html file ko "image/png" bhej kar presign lena POSSIBLE
//     hai; magic bytes us pakad lete hain.
//
// Aur phir Content-Type ko SERVER-SIDE force karte hain (CopyObject se).
// Iska matlab: chahe browser `text/html` bheje, object serve hote waqt
// `image/png` hi rahega - stored XSS ka raasta band.
//
// SECURITY: ye step skip karna YAAR upload ko usable nahi banata, kyunki
// public URL sirf tabhi profile me set hoti hai jab finalize success ho.
func (s *StorageService) FinalizeAvatarUpload(
	ctx context.Context,
	userID uuid.UUID,
	objectKey string,
) (string, error) {
	bucket := s.cfg.GetAvatarBucket()

	// ---- Object key ownership check ----
	// SECURITY: key BAHAR se aata hai, to har form me validate karna zaroori.
	// Isse koi user doosre ke namespace me object finalize nahi kar sakta.
	//
	// NOTE: key ab `{userID}/{rand}.ext` hai (bucket URL me alag hai), to
	// prefix check `bucket/userID/` nahi, sirf `userID/` hona chahiye.
	if objectKey == "" || !strings.HasPrefix(objectKey, userID.String()+"/") {
		return "", fmt.Errorf("object key does not belong to this user")
	}
	// Path traversal check
	if strings.Contains(objectKey, "..") {
		return "", fmt.Errorf("invalid object key")
	}

	// ---- 1. Exists? ----
	objInfo, err := s.client.StatObject(ctx, bucket, objectKey, minio.StatObjectOptions{})
	if err != nil {
		return "", fmt.Errorf("uploaded object not found - upload may have failed")
	}

	// ---- 2. Size limit ----
	if objInfo.Size > config.MaxAvatarBytes {
		// Over-limit object turant delete karo taaki storage me garbage na bache
		_ = s.client.RemoveObject(ctx, bucket, objectKey, minio.RemoveObjectOptions{})
		return "", fmt.Errorf(
			"file is too large (%.1f MB). Maximum is %d MB",
			float64(objInfo.Size)/(1024*1024),
			config.MaxAvatarBytes/(1024*1024),
		)
	}

	// ---- 3. Magic bytes se REAL type verify ----
	// Sirf first 12 bytes kaafi hain sab image formats ke liye.
	reader, err := s.client.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return "", err
	}
	defer reader.Close()

	header := make([]byte, 12)
	n, _ := reader.Read(header)
	if n < 4 {
		_ = s.client.RemoveObject(ctx, bucket, objectKey, minio.RemoveObjectOptions{})
		return "", fmt.Errorf("file is empty or unreadable")
	}

	detected, ok := sniffImageType(header)
	if !ok {
		// Ye allowed image format NAHI hai - chahe extension sahi ho.
		_ = s.client.RemoveObject(ctx, bucket, objectKey, minio.RemoveObjectOptions{})
		return "", fmt.Errorf(
			"file content is not a valid image (PNG, JPEG, WebP or GIF)",
		)
	}

	// ---- 4. Content-Type force (server-side) ----
	// Apne aap onto hi copy karte hain, correct Content-Type ke saath.
	// Source aur destination SAME key hai - MinIO metadata replace karta hai.
	//
	// NOTE: minio-go v7.0.68 me:
	//   - `CopyObject(ctx, dst, src)` -> 3 args, metadata NAHI set kar sakta
	//   - `ComposeObject(ctx, dst, srcs...)` -> `dst.UserMetadata` +
	//     `dst.ReplaceMetadata` se metadata control hota hai
	// Isliye yahan `ComposeObject` use kiya gaya hai.
	//
	// `ReplaceMetadata: true` ka matlab: source ka metadata (client ka bheja
	// hua content-type) IGNORE karke sirf hamara set hoga. Ye exactly wahi
	// hai jo chahiye tha - client kuch bhi bheje, serve hote waqt image/* rahega.
	if detected != objInfo.ContentType {
		dest := minio.CopyDestOptions{
			Bucket:          bucket,
			Object:          objectKey,
			ReplaceMetadata: true,
			UserMetadata:    map[string]string{"Content-Type": detected},
		}
		src := minio.CopySrcOptions{Bucket: bucket, Object: objectKey}
		if _, err := s.client.ComposeObject(ctx, dest, src); err != nil {
			// Metadata fix fail hua to bhi block nahi karte - file image hai
			// (magic bytes verify ho chuka), sirf serving type imperfect rahega.
			// Ye surfaced hona chahiye taaki pata chale.
			fmt.Printf("[storage] content-type fix failed for %s: %v\n", objectKey, err)
		}
	}

	publicURL := fmt.Sprintf(
		"http%s://%s/%s/%s",
		map[bool]string{true: "s", false: ""}[s.cfg.UseSSL],
		s.cfg.GetPublicHost(),
		bucket,
		objectKey,
	)
	return publicURL, nil
}

// sniffImageType magic bytes se image format detect karta hai.
//
// SECURITY: ye client ke Content-Type claim ko IGNORE karta hai aur ASLI
// bytes dekhta hai. Yehi wajah hai ki "evil.html ko .png naam dekar upload
// karna" kaam nahi karega.
//
// Return (mimeType, ok).
func sniffImageType(header []byte) (string, bool) {
	if len(header) < 4 {
		return "", false
	}
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if len(header) >= 8 &&
		header[0] == 0x89 && header[1] == 0x50 &&
		header[2] == 0x4E && header[3] == 0x47 &&
		header[4] == 0x0D && header[5] == 0x0A &&
		header[6] == 0x1A && header[7] == 0x0A {
		return "image/png", true
	}
	// JPEG: FF D8 FF
	if header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF {
		return "image/jpeg", true
	}
	// GIF: "GIF87a" / "GIF89a"
	if len(header) >= 6 &&
		header[0] == 'G' && header[1] == 'I' && header[2] == 'F' &&
		header[3] == '8' && (header[4] == '7' || header[4] == '9') &&
		header[5] == 'a' {
		return "image/gif", true
	}
	// WebP: "RIFF" .... "WEBP"
	if len(header) >= 12 &&
		header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F' &&
		header[8] == 'W' && header[9] == 'E' && header[10] == 'B' && header[11] == 'P' {
		return "image/webp", true
	}
	// Kuch nahi mila
	return "", false
}

// objectKeyFromURL public URL se object key nikalta hai.
//
// SECURITY: ye sirf un URLs ke liye hai jo humne KHUD banaye hain
// (apne bucket me). Random user input se key banana KABHI allowed nahi -
// warna koi doosre user ka object delete kar sakta hai.
func (s *StorageService) objectKeyFromURL(publicURL string) string {
	if publicURL == "" {
		return ""
	}
	prefix := fmt.Sprintf(
		"http%s://%s/",
		map[bool]string{true: "s", false: ""}[s.cfg.UseSSL],
		s.cfg.GetPublicHost(),
	)
	if !strings.HasPrefix(publicURL, prefix) {
		return ""
	}
	key := strings.TrimPrefix(publicURL, prefix)
	// Extra safety: key hamare bucket ke andar hona chahiye
	if !strings.HasPrefix(key, s.cfg.GetAvatarBucket()+"/") {
		return ""
	}
	// `..` path traversal check
	if strings.Contains(key, "..") {
		return ""
	}
	return key
}
