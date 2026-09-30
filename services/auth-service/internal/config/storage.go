package config

// ============================================================================
// STORAGE (MinIO / self-hosted S3)
// ============================================================================
//
// REQUIREMENT: avatar/file upload apne KHUD ke MinIO me jaye - kisi paid
// provider (S3/CloudFront/GCS) par nahi.
//
// ---- WHY PRESIGNED URL (and not server-side upload proxy) ----
// Do tarike ho sakte the:
//
//  A) Server proxy: browser -> auth-service -> MinIO
//     Problem: har image ke bytes auth-service se guzarte hain. Upar bandwidth
//     + memory + latency. 5MB avatar ke liye poori app server busy.
//
//  B) Presigned URL: browser seedha MinIO PUT karta hai
//     Auth-service sirf ek chhoti signed URL bana deta hai. Bytes BILKUL
//     browser se MinIO jaate hain - app server par zero load.
//     Ye wahi pattern hai jo real production products use karte hain.
//
// Isliye B chuna.
//
// ---- SECURITY NOTES ----
//  1. Presigned URL me EXPIRY hoti hai (default 15 min) - iske baad wo
//     signature invalid ho jata hai. Isse ek leak hui URL window me hi
//     usable rehti hai.
//  2. Object key me user ID jaata hai, user ka naam NAHI. Isse:
//     - koi PII URL me leak nahi hota
//     - object rename karna mushkil hota hai
//  3. Content-Type server side validate hota hai (sirf image types).
//     Arbitrary file (jaise .html, .svg with script) upload na ho sake.
//
// Hinglish comments: har block ka arth

// StorageConfig - MinIO connection + bucket settings
type StorageConfig struct {
	// MinIO endpoint (host:port, no scheme)
	Endpoint string `mapstructure:"endpoint"`
	// Access key. Compose se aata hai.
	AccessKey string `mapstructure:"access_key"`
	SecretKey string `mapstructure:"secret_key"`
	// Bucket jisme avatars jaayenge
	AvatarBucket string `mapstructure:"avatar_bucket"`
	// Bucket jisme channel covers jaayenge.
	//
	// WHY A SEPARATE BUCKET: covers wide banners hain (16:9), avatars square
	// hain. Inhe ek hi bucket me daalne par size/lifecycle rules ek jaisa
	// rakhna impossible ho jata hai - aur ek oversized "cover" avatar size
	// limit se nikal kar poore bucket ko bhar sakta hai.
	CoverBucket string `mapstructure:"cover_bucket"`
	// Presigned URL ki TTL (minutes)
	PresignTTLMinutes int `mapstructure:"presign_ttl_minutes"`
	// Browser ko dene wali public base URL (e.g. http://localhost:9000)
	PublicHost string `mapstructure:"public_host"`
	// True = MinIO secure (HTTPS) use karo
	UseSSL bool `mapstructure:"use_ssl"`
	// Dev me true rakho - tab tak jab tak MinIO local par hi hai.
	// Production me MUST false hona chahiye jab tak real TLS nahi hai.
	Enabled bool `mapstructure:"enabled"`
	// ManageBucket - kya ye service bucket KHUD banayegi aur uski policy
	// khud set karegi (`MakeBucket` + `SetBucketPolicy`).
	//
	// ---- KYUN YE FLAG ZAROORI HAI ----
	// `MakeBucket` ko `s3:CreateBucket` chahiye, aur `SetBucketPolicy` ko
	// `s3:PutBucketPolicy`. Root account ke paas dono hain, isliye pehle ye
	// chupke se kaam kar raha tha.
	//
	// Par jab auth-service ko MINIO ROOT chhodkar bucket-scoped service
	// account pe migrate kiya (Phase A / gap #1), to wo account DELIBERATELY
	// in dono actions ko NAHI kar sakta - kyunki unke bina bucket create
	// karwane ka matlab hai "leak hua account naye bucket bana sakta hai",
	// jo hum exactly band karna chahte hain.
	//
	// Isliye provisioning ka kaam `minio-init` container karta hai (root ke
	// saath, ek baar), aur yahan flag false ho jaata hai.
	//
	// DEFAULT true rakha hai taaki purane setups (jahan sirf root creds
	// hain) bina kuch kiye na toot-te hain.
	ManageBucket bool `mapstructure:"manage_bucket"`
}

// Getter with safe defaults
func (s *StorageConfig) GetAvatarBucket() string {
	if s == nil || s.AvatarBucket == "" {
		return "avatars"
	}
	return s.AvatarBucket
}

func (s *StorageConfig) GetCoverBucket() string {
	if s == nil || s.CoverBucket == "" {
		return "covers"
	}
	return s.CoverBucket
}

func (s *StorageConfig) GetPresignTTL() int {
	if s == nil || s.PresignTTLMinutes <= 0 {
		return 15
	}
	return s.PresignTTLMinutes
}

func (s *StorageConfig) GetPublicHost() string {
	if s == nil || s.PublicHost == "" {
		return "localhost:9000"
	}
	return s.PublicHost
}

func (s *StorageConfig) GetEndpoint() string {
	if s == nil || s.Endpoint == "" {
		return "localhost:9000"
	}
	return s.Endpoint
}

// AllowedImageTypes - sirf ye content types upload ho sakte hain.
//
// SECURITY: ye allowlist hai. Sirf in types ko accept karte hain, isse
// koi malicious file (`.html`, `.svg` with embedded <script>, `.exe`)
// upload nahi ho sakti - wo later serve hote to stored XSS ban jaata.
//
// NOTE: SVG DELIBERATELY EXCLUDE HAI. SVG me <script> ho sakta hai, isliye
// ye image format nahi maana jata jab tak sanitize na kiya jaaye. Sirf
// raster formats (PNG/JPEG/WebP/GIF) - jo browser `<img>` me render karte
// waqt script NAHI chalate.
var AllowedImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif":  true,
}

// MaxAvatarBytes - 5 MB.
//
// Chhota isliye rakha hai kyunki ye PROFILE IMAGE hai, content nahi.
// Bade file: memory + upload time dono pe buri. 5MB me har normal avatar
// aa jaata hai (even 4K screenshot).
const MaxAvatarBytes int64 = 5 * 1024 * 1024 // 5MB

// MaxCoverBytes - 4 MB.
//
// Covers CHHOTI limit kyun (avatar se bhi kam) jabki wo widescreen hoti hain:
// cover browser me `background-image` / `<img>` ke roop me render hota hai, jo
// har viewport width par stretch hoti hai. Matlab ek 4MB cover har visitor ke
// bandwidth khaayegi, jabki 4MB avatar sirf ek 96px circle me dikhti hai.
//
// Realistic 4K banner JPEG ~400KB hota hai, to 4MB already generous hai.
// Isse koi absurdly bada upload (RAW/PNG screenshot) pehle hi reject ho
// jayega instead of silently serving a 40MB image to every visitor.
const MaxCoverBytes int64 = 4 * 1024 * 1024 // 4MB

// AllowedImageExtensions - extension -> content type map.
// Browser sirf filename bhejta hai, content-type unreliable hota hai,
// isliye hum dono cross-check karte hain (sirf extension match karna
// bhi dangerous hota hai - `.png` naam ke andar HTML ho sakta hai).
var AllowedImageExtensions = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif":  "image/gif",
}
