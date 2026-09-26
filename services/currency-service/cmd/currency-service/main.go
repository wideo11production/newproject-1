// Currency Service - Multi-currency microservice
//
// PURPOSE: Ek hi jagah (SSOT table) se saare currency rates serve karna.
// Baaki har service (billing, storefront, payouts) WAHI table se padhe -
// isliye har request pe rate fetch/update karne ki zaroorat NAHI.
//
// COST PHILOSOPHY (aapka hard rule - "kisi ko ek bhi penny nahi"):
//   - Default fetcher = "manual" (seed data). Koi NETWORK call hi nahi.
//   - Isliye default configuration me ye service paise nahi kharch kar sakta.
//   - Optional "frankfurter" source free hai aur API key NAHI maangta.
//   - PAID sources (Open Exchange / Fixer / CurrencyLayer) jaan-boojh kar
//     nahi diye gaye - kyunki wahan se silent billing ho sakti hai.
//
// 24-HOUR FIXED SCHEDULE:
//   Rater "fixed interval" (24h) par update hote hain, cron nahi.
//   Kyun: cron "daily" hota hai, "every 24 hours" nahi. Agar ek run late ho
//   to har agla run bhi late hota jaata hai aur gap badhta rehta hai.
//   Fixed-interval scheduler se gap hamesha exactly 24 ghante rehta hai.
//
// Hinglish comments: har block ka arth
package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// ExchangeRate ek currency pair ka rate store karta hai
//
// YE TABLE HI SSOT HAI. Baaki sab services yahin se padhte hain.
type ExchangeRate struct {
	ID            uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	BaseCurrency  string    `gorm:"size:3;not null;uniqueIndex:idx_pair" json:"base_currency"`
	QuoteCurrency string    `gorm:"size:3;not null;uniqueIndex:idx_pair" json:"quote_currency"`
	Rate          float64   `gorm:"type:numeric(20,8);not null" json:"rate"`
	Source        string    `gorm:"size:64;not null" json:"source"`
	FetchedAt     time.Time `gorm:"not null;index" json:"fetched_at"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (ExchangeRate) TableName() string { return "exchange_rates" }

// ConversionHistory har conversion ko record karta hai (audit trail ke liye)
type ConversionHistory struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	FromCur   string    `gorm:"size:3;not null;index" json:"from_currency"`
	ToCur     string    `gorm:"size:3;not null;index" json:"to_currency"`
	Amount    float64   `gorm:"type:numeric(20,4);not null" json:"amount"`
	RateUsed  float64   `gorm:"type:numeric(20,8);not null" json:"rate_used"`
	Converted float64   `gorm:"type:numeric(20,4);not null" json:"converted"`
	RateAgeS  int64     `json:"rate_age_seconds"`
	CreatedAt time.Time `json:"created_at"`
}

func (ConversionHistory) TableName() string { return "conversion_history" }

// AppConfig SSOT-driven configuration
type AppConfig struct {
	Port              string
	DBHost            string
	DBPort            string
	DBUser            string
	DBPassword        string
	DBName            string
	DBSSLMode         string
	// Rate update interval - 24 ghante
	RateUpdateInterval time.Duration
	RateFetchTimeout   time.Duration
	// Default source: "manual" (no network) ya "frankfurter"/"exchangerate-api"
	RateSource         string
	// ExchangeRateAPI key - SECONDARY source ke liye. SSOT (.env) se aata hai.
	// NOTE: ye kabhi code me hardcoded nahi hoga - sirf env se.
	ExchangeRateAPIKey string
	BaseCurrency       string
	// Rounding: currency amounts 2 decimal places par round hoti hain.
	// Aapne ye rule confirm kiya tha - "2 points par round off".
	RoundingPlaces int
}

var cfg AppConfig

// loadConfig SSOT se configuration load karta hai (.env / container env)
// Koi bhi value code me hardcoded NAHI hai.
func loadConfig() {
	cfg.Port = envStr("CURRENCY_SERVICE_PORT", "8086")
	cfg.DBHost = envStr("CURRENCY_DB_HOST", "localhost")
	cfg.DBPort = envStr("CURRENCY_DB_PORT", "5432")
	cfg.DBUser = envStr("CURRENCY_DB_USER", "postgres")
	cfg.DBPassword = envStr("CURRENCY_DB_PASSWORD", "postgres")
	cfg.DBName = envStr("CURRENCY_DB_NAME", "currency_service")
	cfg.DBSSLMode = envStr("CURRENCY_DB_SSLMODE", "disable")

	// 24 ghante = 86400 seconds (SSOT se, default 24h)
	intervalHours := envInt("CURRENCY_RATE_UPDATE_INTERVAL_HOURS", 24)
	cfg.RateUpdateInterval = time.Duration(intervalHours) * time.Hour
	cfg.RateFetchTimeout = time.Duration(envInt("CURRENCY_RATE_FETCH_TIMEOUT_SECONDS", 30)) * time.Second

	// DEFAULT = "manual" -> koi network call NAHI -> zero cost guarantee
	cfg.RateSource = envStr("CURRENCY_RATE_SOURCE", "manual")
	cfg.BaseCurrency = envStr("CURRENCY_BASE_CURRENCY", "INR")

	// ExchangeRate API key - SECONDARY (failover) source ke liye
	// SSOT se aata hai, kabhi hardcoded nahi
	cfg.ExchangeRateAPIKey = envStr("EXCHANGERATE_API_KEY", "")

	// Rounding places - 2 decimal (currency standard, aapne confirm kiya)
	cfg.RoundingPlaces = envInt("CURRENCY_ROUNDING_PLACES", 2)
}

// roundCurrency currency amount ko configured decimal places tak round karta hai
//
// RULE: 2 decimal places (paise me). Ye ROUND half-up hai:
//   16.6665 -> 16.67
//   4.9995  -> 5.00
//   12.34   -> 12.34 (already 2dp)
//
// KYUN ZAROORI: bina rounding ke floating point arithmetic drift karta hai -
// jaise 0.1 + 0.2 = 0.30000000000000004. Paise me ye kabhi nahi hona chahiye.
// Hinglish: paise ko 2 decimal tak round karte hain - half-up rule
func roundCurrency(amount float64, places int) float64 {
	shift := math.Pow(10, float64(places))
	return math.Round(amount*shift) / shift
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}

// seedRates default reference rates (INR base)
//
// YE "MANUAL" SOURCE HAI - yahi default hai. Iska matlab:
//   - Koi API call NAHI
//   - Koi API key NAHI
//   - Koi paisa NAHI
//   - Fully deterministic aur offline
//
// Baaki sab services inhi rates se padhenge. Rates update karne ke liye
// admin inhe badal sakta hai ya free source enable kar sakta hai.
var seedRates = map[string]float64{
	"INR": 1.0,        // base
	"USD": 0.012,       // 1 USD ~ 83 INR
	"EUR": 0.0113,      // 1 EUR ~ 88.5 INR
	"GBP": 0.0105,      // 1 GBP ~ 95 INR
	"JPY": 1.85,        // 1 JPY ~ 0.54 INR
	"AUD": 0.0183,      // 1 AUD ~ 54.6 INR
	"CAD": 0.0175,      // 1 CAD ~ 57 INR
	"SGD": 0.0096,      // 1 SGD ~ 104 INR
	"AED": 0.044,       // 1 AED ~ 22.7 INR
	"CNY": 0.088,       // 1 CNY ~ 11.4 INR
	"NZD": 0.0196,      // 1 NZD ~ 51 INR
	"CHF": 0.0118,      // 1 CHF ~ 84.7 INR
}

// supportedCurrencies wo list hai jo hum store karte hain
var supportedCurrencies = []string{
	"USD", "EUR", "GBP", "JPY", "AUD", "CAD", "SGD", "AED", "CNY", "NZD", "CHF",
}

// refreshRates rates ko DB me upsert karta hai
//
// 3 MODES (CURRENCY_RATE_SOURCE se, SSOT):
//   manual           = OFFLINE seed data. Koi network call NAHI. Zero cost.
//   frankfurter      = LIVE + failover. Primary Frankfurter, secondary
//                      exchangerate-api. Free dono.
//   exchangerate-api = LIVE, sirf secondary source use karo (testing)
//
// FAILOVER: "frankfurter" mode me agar Frankfurter fail hua to
// exchangerate-api automatically pick hoga (fetcher.go me implemented).
func refreshRates(db *gorm.DB, source string) (int, string, error) {
	var rates map[string]float64
	var usedSource string

	switch source {
	case "frankfurter", "exchangerate-api":
		// LIVE mode - dual source with failover
		fetcher := NewRateFetcher(
			cfg.BaseCurrency,
			supportedCurrencies,
			cfg.RateFetchTimeout,
			cfg.ExchangeRateAPIKey,
		)

		ctx, cancel := context.WithTimeout(context.Background(), cfg.RateFetchTimeout)
		defer cancel()

		result, err := fetcher.FetchAll(ctx)
		if err != nil {
			// Dono source fail. Rates UNCHANGED rehne do (stale ho jayenge
			// par system BREAK nahi hoga) - ye resilience hai.
			log.Printf("[CURRENCY] BOTH SOURCES FAILED: %v - keeping old rates", err)
			return 0, "", err
		}
		rates = result.Rates
		usedSource = result.SourceUsed

	default:
		// manual (default) - OFFLINE, koi network call nahi
		rates = make(map[string]float64, len(seedRates))
		for code, rate := range seedRates {
			rates[code] = rate
		}
		usedSource = "manual"
	}

	// DB me upsert karo
	now := time.Now()
	count := 0

	for quote, rate := range rates {
		if rate <= 0 {
			continue
		}

		record := ExchangeRate{
			BaseCurrency:  cfg.BaseCurrency,
			QuoteCurrency: quote,
			Rate:          rate,
			Source:        usedSource,
			FetchedAt:     now,
		}

		// Upsert: (base, quote) unique index pe conflict hone par update karo
		err := db.Where("base_currency = ? AND quote_currency = ?",
			cfg.BaseCurrency, quote).
			Assign(map[string]interface{}{
				"rate":       rate,
				"source":     usedSource,
				"fetched_at": now,
			}).
			FirstOrCreate(&record).Error

		if err != nil {
			return count, usedSource, err
		}
		count++
	}

	return count, usedSource, nil
}

// getRate conversion ke liye rate laata hai
//
// INDIRECT lookup: pehle direct pair (INR->USD), phir inverse (USD->INR)
// Isse har possible pair handle ho jata hai bina har combination store kiye.
func getRate(db *gorm.DB, from, to string) (*ExchangeRate, error) {
	from = strings.ToUpper(strings.TrimSpace(from))
	to = strings.ToUpper(strings.TrimSpace(to))

	// Same currency - rate 1 hai, koi lookup nahi
	if from == to {
		return &ExchangeRate{BaseCurrency: from, QuoteCurrency: to, Rate: 1.0, Source: "identity"}, nil
	}

	// Direct pair try karo
	var rate ExchangeRate
	err := db.Where("base_currency = ? AND quote_currency = ?", from, to).First(&rate).Error
	if err == nil {
		return &rate, nil
	}

	// Inverse pair try karo - phir 1/rate kar denge
	err = db.Where("base_currency = ? AND quote_currency = ?", to, from).First(&rate).Error
	if err == nil {
		inverse := 1.0 / rate.Rate
		return &ExchangeRate{
			BaseCurrency:  from,
			QuoteCurrency: to,
			Rate:          inverse,
			Source:        rate.Source + " (inverse)",
			FetchedAt:     rate.FetchedAt,
		}, nil
	}

	return nil, fmt.Errorf("no rate found for %s -> %s", from, to)
}

// convert amount ko ek currency se doosri me badalta hai
//
// ROUNDING: converted amount ko 2 decimal places tak round kiya jaata hai
// (cfg.RoundingPlaces, SSOT se). Bina rounding floating point drift karta hai
// jo paise me kabhi accept nahi hona chahiye.
func convert(db *gorm.DB, amount float64, from, to string) (float64, float64, int64, error) {
	rate, err := getRate(db, from, to)
	if err != nil {
		return 0, 0, 0, err
	}

	// Round karo - yahi rule DB me bhi jaata hai
	rawConverted := amount * rate.Rate
	converted := roundCurrency(rawConverted, cfg.RoundingPlaces)

	ageSeconds := int64(time.Since(rate.FetchedAt).Seconds())

	return converted, rate.Rate, ageSeconds, nil
}

// startScheduler 24-ghante ke fixed interval par rates refresh karta hai
//
// FIXED INTERVAL (cron nahi) - jaisa spec me tha.
// Cron "daily" hota hai jo drift karta hai; fixed interval nahi karta.
func startScheduler(ctx context.Context, db *gorm.DB) {
	ticker := time.NewTicker(cfg.RateUpdateInterval)
	defer ticker.Stop()

	// Startup par ek immediate refresh (taaki table kabhi khali na rahe)
	if n, src, err := refreshRates(db, cfg.RateSource); err != nil {
		log.Printf("[CURRENCY] Initial rate refresh FAILED: %v", err)
	} else {
		log.Printf("[CURRENCY] Initial rate refresh done: %d rates (source=%s)", n, src)
	}

	for {
		select {
		case <-ctx.Done():
			log.Println("[CURRENCY] Scheduler stopping")
			return
		case t := <-ticker.C:
			start := time.Now()
			n, src, err := refreshRates(db, cfg.RateSource)
			if err != nil {
				log.Printf("[CURRENCY] Rate refresh FAILED at %s: %v",
					t.Format(time.RFC3339), err)
				continue
			}
			log.Printf("[CURRENCY] Rate refresh done: %d rates in %v from %s (next in %v)", n, time.Since(start), src, cfg.RateUpdateInterval)
		}
	}
}

func main() {
	loadConfig()

	// Structured logs - Hinglish + timestamps
	log.SetFlags(log.LstdFlags)
	log.Printf("[CURRENCY] Starting | port=%s | source=%s | interval=%v",
		cfg.Port, cfg.RateSource, cfg.RateUpdateInterval)

	if cfg.RateSource == "manual" {
		log.Println("[CURRENCY] MODE: manual - koi network call nahi, zero cost guarantee")
	}

	// ---- Database connect ----
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName, cfg.DBSSLMode)

	// DB retry: postgres container abhi start ho raha ho sakta hai
	var db *gorm.DB
	var err error
	for i := 1; i <= 10; i++ {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err == nil {
			break
		}
		log.Printf("[CURRENCY] DB not ready (attempt %d/10): %v", i, err)
		time.Sleep(3 * time.Second)
	}
	if err != nil {
		log.Fatalf("[CURRENCY] FATAL: could not connect to database: %v", err)
	}

	// ---- AutoMigrate ----
	if err := db.AutoMigrate(&ExchangeRate{}, &ConversionHistory{}); err != nil {
		log.Fatalf("[CURRENCY] FATAL: migration failed: %v", err)
	}
	log.Println("[CURRENCY] Migrations done (exchange_rates, conversion_history)")

	// ---- Scheduler background me ----
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go startScheduler(ctx, db)

	// ---- HTTP server ----
	gin.SetMode(envStr("GIN_MODE", "release"))
	r := gin.New()
	r.Use(gin.Recovery())

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":         "ok",
			"service":        "currency-service",
			"source":         cfg.RateSource,
			"interval_hours": int(cfg.RateUpdateInterval.Hours()),
			"timestamp":      time.Now().UTC(),
		})
	})

	// Saare rates list karo
	r.GET("/api/v1/rates", func(c *gin.Context) {
		var rates []ExchangeRate
		if err := db.Where("base_currency = ?", cfg.BaseCurrency).Find(&rates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load rates"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"base_currency": cfg.BaseCurrency,
			"count":         len(rates),
			"source":        cfg.RateSource,
			"rates":         rates,
		})
	})

	// Specific pair ka rate
	r.GET("/api/v1/rates/:base/:quote", func(c *gin.Context) {
		rate, err := getRate(db, c.Param("base"), c.Param("quote"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, rate)
	})

	// Conversion - amount ek currency se doosri me
	r.POST("/api/v1/convert", func(c *gin.Context) {
		var req struct {
			Amount float64 `json:"amount" binding:"required"`
			From   string  `json:"from" binding:"required"`
			To     string  `json:"to" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "amount, from, to are required"})
			return
		}

		converted, rateUsed, ageSeconds, err := convert(db, req.Amount, req.From, req.To)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}

		// Audit trail - har conversion record hota hai
		history := ConversionHistory{
			FromCur:   strings.ToUpper(req.From),
			ToCur:     strings.ToUpper(req.To),
			Amount:    req.Amount,
			RateUsed:  rateUsed,
			Converted: converted,
			RateAgeS:  ageSeconds,
		}
		if err := db.Create(&history).Error; err != nil {
			// Audit fail ho jaye to conversion fail NAHI hota - sirf log
			log.Printf("[CURRENCY] audit write failed: %v", err)
		}

		// Stale rate warning (rate 24h se purana hai to batao)
		warning := ""
		if ageSeconds > int64(cfg.RateUpdateInterval.Seconds()) {
			warning = "rate is stale (older than update interval)"
		}

		c.JSON(http.StatusOK, gin.H{
			"from":            strings.ToUpper(req.From),
			"to":              strings.ToUpper(req.To),
			"amount":          req.Amount,
			"converted":       converted,
			"rate_used":       rateUsed,
			"rate_age_seconds": ageSeconds,
			"warning":         warning,
		})
	})

	// Manual rate refresh (admin use) - koi network nahi
	r.POST("/api/v1/rates/refresh", func(c *gin.Context) {
		n, src, err := refreshRates(db, cfg.RateSource)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message": "rates refreshed",
			"count":   n,
			// NOTE: "source" ab actual fetched source dikhata hai (failover ho
			// sakta hai), configured source nahi. Ye zaroori hai taaki pata chale
			// ki data primary se aaya ya secondary se.
			"source":          src,
			"configured_mode": cfg.RateSource,
		})
	})

	// Conversion history (audit)
	r.GET("/api/v1/conversions", func(c *gin.Context) {
		var history []ConversionHistory
		if err := db.Order("created_at DESC").Limit(100).Find(&history).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load history"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"conversions": history})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("[CURRENCY] Server listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[CURRENCY] server failed: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
	log.Println("[CURRENCY] Shutting down...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[CURRENCY] forced shutdown: %v", err)
	}
	log.Println("[CURRENCY] Stopped")
}
