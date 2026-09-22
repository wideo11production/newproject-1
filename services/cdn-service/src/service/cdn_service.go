package service

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"newproject/services/cdn-service/src/model"
	"newproject/services/cdn-service/src/repository"
)

type CDNService struct {
	repo *repository.CDNRepository
	// Provider clients would be initialized here
	cloudFrontClient *cloudFrontClient
	cloudflareClient *cloudflareClient
}

type cloudFrontClient struct {
	keyPairID    string
	privateKey   *rsa.PrivateKey
	defaultRegion string
}

type cloudflareClient struct {
	apiKey     string
	zoneID     string
	email      string
}

func NewCDNService(repo *repository.CDNRepository) *CDNService {
	return &CDNService{
		repo: repo,
	}
}

// CDNConfig Management

func (s *CDNService) CreateCDNConfig(ctx context.Context, req CreateCDNConfigRequest) (*CDNConfigResponse, error) {
	config := &model.CDNConfig{
		UUID:        uuid.New(),
		Name:        req.Name,
		Provider:    model.CDNProvider(req.Provider),
		Domain:      req.Domain,
		OriginDomain: req.OriginDomain,
		OriginPath:  req.OriginPath,
		Enabled:     req.Enabled,
		DefaultTTL:  req.DefaultTTL,
		MaxTTL:      req.MaxTTL,
		MinTTL:      req.MinTTL,
		Compress:    req.Compress,
		RequireSignedURLs: req.RequireSignedURLs,
		AllowedIPs:  req.AllowedIPs,
		BlockedCountries: req.BlockedCountries,
		CustomHeaders: req.CustomHeaders,
	}

	if config.DefaultTTL == 0 {
		config.DefaultTTL = 86400
	}
	if config.MaxTTL == 0 {
		config.MaxTTL = 31536000
	}

	if err := s.repo.Create(ctx, config); err != nil {
		return nil, fmt.Errorf("failed to create CDN config: %w", err)
	}

	// Initialize provider client
	s.initProviderClient(config)

	return &CDNConfigResponse{
		UUID:        config.UUID.String(),
		Name:        config.Name,
		Provider:    string(config.Provider),
		Domain:      config.Domain,
		Enabled:     config.Enabled,
		DefaultTTL:  config.DefaultTTL,
	}, nil
}

func (s *CDNService) GetCDNConfig(ctx context.Context, id uint) (*CDNConfigResponse, error) {
	config, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return &CDNConfigResponse{
		UUID:        config.UUID.String(),
		Name:        config.Name,
		Provider:    string(config.Provider),
		Domain:      config.Domain,
		OriginDomain: config.OriginDomain,
		OriginPath:   config.OriginPath,
		Enabled:      config.Enabled,
		DefaultTTL:   config.DefaultTTL,
		MaxTTL:       config.MaxTTL,
		MinTTL:       config.MinTTL,
		Compress:     config.Compress,
		RequireSignedURLs: config.RequireSignedURLs,
	}, nil
}

func (s *CDNService) ListCDNConfigs(ctx context.Context, limit, offset int) ([]*CDNConfigResponse, error) {
	configs, err := s.repo.List(ctx, limit, offset)
	if err != nil {
		return nil, err
	}

	var result []*CDNConfigResponse
	for _, c := range configs {
		result = append(result, &CDNConfigResponse{
			UUID:        c.UUID.String(),
			Name:        c.Name,
			Provider:    string(c.Provider),
			Domain:      c.Domain,
			OriginDomain: c.OriginDomain,
			Enabled:     c.Enabled,
			DefaultTTL:   c.DefaultTTL,
		})
	}
	return result, nil
}

func (s *CDNService) UpdateCDNConfig(ctx context.Context, id uint, req UpdateCDNConfigRequest) (*CDNConfigResponse, error) {
	config, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.Name != "" {
		config.Name = req.Name
	}
	if req.Domain != "" {
		config.Domain = req.Domain
	}
	if req.OriginDomain != "" {
		config.OriginDomain = req.OriginDomain
	}
	if req.OriginPath != "" {
		config.OriginPath = req.OriginPath
	}
	if req.Enabled != nil {
		config.Enabled = *req.Enabled
	}
	if req.DefaultTTL > 0 {
		config.DefaultTTL = req.DefaultTTL
	}
	if req.MaxTTL > 0 {
		config.MaxTTL = req.MaxTTL
	}
	if req.Compress != nil {
		config.Compress = *req.Compress
	}
	if req.RequireSignedURLs != nil {
		config.RequireSignedURLs = *req.RequireSignedURLs
	}

	if err := s.repo.Update(ctx, config); err != nil {
		return nil, err
	}

	return &CDNConfigResponse{
		UUID:        config.UUID.String(),
		Name:        config.Name,
		Provider:    string(config.Provider),
		Domain:      config.Domain,
		Enabled:     config.Enabled,
	}, nil
}

func (s *CDNService) DeleteCDNConfig(ctx context.Context, id uint) error {
	return s.repo.Delete(ctx, id)
}

// Cache Rule Management

func (s *CDNService) CreateCacheRule(ctx context.Context, configID uint, req CreateCacheRuleRequest) (*CDNCacheRuleResponse, error) {
	// Verify config exists
	_, err := s.repo.GetByID(ctx, configID)
	if err != nil {
		return nil, err
	}

	rule := &model.CDNCacheRule{
		UUID:          uuid.New(),
		CDNConfigID:   configID,
		PathPattern:   req.PathPattern,
		TTL:           req.TTL,
		AllowedMethods: req.AllowedMethods,
		CachedMethods:  req.CachedMethods,
		ForwardHeaders: req.ForwardHeaders,
		ForwardQueryString: req.ForwardQueryString,
		ForwardCookies: req.ForwardCookies,
		Compress:      req.Compress,
		Priority:      req.Priority,
		Enabled:       req.Enabled,
	}

	if rule.TTL == 0 {
		rule.TTL = 86400
	}

	if err := s.repo.CreateRule(ctx, rule); err != nil {
		return nil, err
	}

	return &CDNCacheRuleResponse{
		UUID:          rule.UUID.String(),
		PathPattern:   rule.PathPattern,
		TTL:           rule.TTL,
		Compress:      rule.Compress,
		Priority:      rule.Priority,
		Enabled:       rule.Enabled,
	}, nil
}

func (s *CDNService) ListCacheRules(ctx context.Context, configID uint) ([]*CDNCacheRuleResponse, error) {
	rules, err := s.repo.GetRulesByConfig(ctx, configID)
	if err != nil {
		return nil, err
	}

	var result []*CDNCacheRuleResponse
	for _, r := range rules {
		result = append(result, &CDNCacheRuleResponse{
			UUID:          r.UUID.String(),
			PathPattern:   r.PathPattern,
			TTL:           r.TTL,
			Compress:      r.Compress,
			Priority:      r.Priority,
			Enabled:       r.Enabled,
		})
	}
	return result, nil
}

func (s *CDNService) UpdateCacheRule(ctx context.Context, id uint, req UpdateCacheRuleRequest) (*CDNCacheRuleResponse, error) {
	rule, err := s.repo.GetRuleByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if req.PathPattern != "" {
		rule.PathPattern = req.PathPattern
	}
	if req.TTL > 0 {
		rule.TTL = req.TTL
	}
	if req.Compress != nil {
		rule.Compress = *req.Compress
	}
	if req.Priority > 0 {
		rule.Priority = req.Priority
	}
	if req.Enabled != nil {
		rule.Enabled = *req.Enabled
	}

	if err := s.repo.UpdateRule(ctx, rule); err != nil {
		return nil, err
	}

	return &CDNCacheRuleResponse{
		UUID:          rule.UUID.String(),
		PathPattern:   rule.PathPattern,
		TTL:           rule.TTL,
		Compress:      rule.Compress,
		Priority:      rule.Priority,
		Enabled:       rule.Enabled,
	}, nil
}

func (s *CDNService) DeleteCacheRule(ctx context.Context, id uint) error {
	return s.repo.DeleteRule(ctx, id)
}

// Cache Invalidation

func (s *CDNService) CreateInvalidation(ctx context.Context, configID uint, req CreateInvalidationRequest) (*CDNInvalidationResponse, error) {
	config, err := s.repo.GetByID(ctx, configID)
	if err != nil {
		return nil, err
	}

	u := uuid.New()
	invalidationID := s.generateInvalidationID(config.Provider)

	paths, _ := json.Marshal(req.Paths)

	inv := &model.CDNInvalidation{
		UUID:           u,
		CDNConfigID:    configID,
		InvalidationID: invalidationID,
		Paths:          string(paths),
		Status:         "pending",
		RequestedBy:    req.RequestedBy,
	}

	if err := s.repo.CreateInvalidation(ctx, inv); err != nil {
		return nil, err
	}

	s.initProviderClient(config)

	// Submit invalidation to provider
	go s.submitInvalidation(inv)

	return &CDNInvalidationResponse{
		UUID:           inv.UUID.String(),
		InvalidationID: inv.InvalidationID,
		Paths:          req.Paths,
		Status:         inv.Status,
		CreatedAt:      inv.CreatedAt.Format(time.RFC3339),
	}, nil
}

func (s *CDNService) GetInvalidation(ctx context.Context, id uint) (*CDNInvalidationResponse, error) {
	inv, err := s.repo.GetInvalidationByID(ctx, id)
	if err != nil {
		return nil, err
	}

	var paths []string
	json.Unmarshal([]byte(inv.Paths), &paths)

	return &CDNInvalidationResponse{
		UUID:           inv.UUID.String(),
		InvalidationID: inv.InvalidationID,
		Paths:          paths,
		Status:         inv.Status,
		ErrorMessage:   inv.ErrorMessage,
		CreatedAt:      inv.CreatedAt.Format(time.RFC3339),
	}, nil
}

func (s *CDNService) ListInvalidations(ctx context.Context, configID uint, limit, offset int) ([]*CDNInvalidationResponse, error) {
	invs, err := s.repo.ListInvalidationsByConfig(ctx, configID, limit, offset)
	if err != nil {
		return nil, err
	}

	var result []*CDNInvalidationResponse
	for _, inv := range invs {
		var paths []string
		json.Unmarshal([]byte(inv.Paths), &paths)

		result = append(result, &CDNInvalidationResponse{
			UUID:           inv.UUID.String(),
			InvalidationID: inv.InvalidationID,
			Paths:          paths,
			Status:         inv.Status,
			CreatedAt:      inv.CreatedAt.Format(time.RFC3339),
		})
	}
	return result, nil
}

func (s *CDNService) submitInvalidation(inv *model.CDNInvalidation) {
	var paths []string
	json.Unmarshal([]byte(inv.Paths), &paths)

	var status string
	var err error

	switch inv.Status {
	case "pending":
		// Simulate provider submission
		status = "completed"
		now := time.Now()
		inv.CompletedAt = &now
		err = nil
	}

	if err != nil {
		status = "failed"
		inv.ErrorMessage = err.Error()
	}

	inv.Status = status
	s.repo.UpdateInvalidation(context.Background(), inv)
}

// Signed URL Generation

func (s *CDNService) GenerateSignedURL(ctx context.Context, configID uint, req GenerateSignedURLRequest) (*SignedURLResponse, error) {
	config, err := s.repo.GetByID(ctx, configID)
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().Add(time.Duration(req.ExpirySeconds) * time.Second)
	if req.ExpirySeconds == 0 {
		expiresAt = time.Now().Add(3600 * time.Second) // 1 hour default
	}

	signedURL, err := s.generateProviderSignedURL(config, req.ResourcePath, expiresAt, req.IPRestriction)
	if err != nil {
		return nil, fmt.Errorf("failed to generate signed URL: %w", err)
	}

	su := &model.CDNSignedURL{
		UUID:          uuid.New(),
		CDNConfigID:   configID,
		ResourcePath:  req.ResourcePath,
		SignedURL:     signedURL,
		ExpiresAt:     expiresAt,
		IPRestriction: req.IPRestriction,
	}

	if err := s.repo.CreateSignedURL(ctx, su); err != nil {
		return nil, err
	}

	return &SignedURLResponse{
		Token:     su.UUID.String(),
		SignedURL: signedURL,
		ExpiresAt: expiresAt.Format(time.RFC3339),
	}, nil
}

func (s *CDNService) ValidateSignedURL(ctx context.Context, token string, resourcePath string, clientIP string) (bool, error) {
	su, err := s.repo.GetByToken(ctx, token)
	if err != nil {
		return false, err
	}

	if time.Now().After(su.ExpiresAt) {
		return false, fmt.Errorf("signed URL has expired")
	}

	if su.IPRestriction != "" && su.IPRestriction != clientIP {
		return false, fmt.Errorf("IP address not allowed")
	}

	// Mark as used
	su.Used = true
	now := time.Now()
	su.UsedAt = &now
	s.repo.UpdateSignedURL(ctx, su)

	return true, nil
}

func (s *CDNService) generateProviderSignedURL(config *model.CDNConfig, resourcePath string, expiresAt time.Time, ipRestriction string) (string, error) {
	baseURL := "https://" + config.Domain + resourcePath

	switch config.Provider {
	case model.CDNProviderCloudFront:
		return s.generateCloudFrontSignedURL(config, baseURL, expiresAt)
	case model.CDNProviderCloudflare:
		return s.generateCloudflareSignedURL(config, baseURL, expiresAt)
	default:
		return baseURL + "?expires=" + strconv.FormatInt(expiresAt.Unix(), 10), nil
	}
}

func (s *CDNService) generateCloudFrontSignedURL(config *model.CDNConfig, url string, expiresAt time.Time) (string, error) {
	// Parse private key
	_, err := s.initCloudFrontClient(config)
	if err != nil {
		return "", err
	}

	expireTime := expiresAt.Unix()
	policy := fmt.Sprintf(`{"Statement":[{"Resource":"%s*","Condition":{"DateLessThan":{"AWS:EpochTime":%d},"IpAddress":{"AWS:SourceIp":"0.0.0.0/0"}}]}`, url, expireTime)

	// Use custom policy
	signedURL, err := s.cloudFrontClient.signURLCustom(url, policy)
	if err != nil {
		return "", err
	}

	return signedURL, nil
}

func (s *CDNService) generateCloudflareSignedURL(config *model.CDNConfig, url string, expiresAt time.Time) (string, error) {
	// Generate token with expiry
	token := uuid.New().String()
	exp := expiresAt.Unix()

	// Cloudflare signed URLs use a token-based approach
	signedURL := url + "?token=" + token + "&exp=" + strconv.FormatInt(exp, 10)

	return signedURL, nil
}

func (s *CDNService) initCloudFrontClient(config *model.CDNConfig) (*cloudFrontClient, error) {
	if s.cloudFrontClient == nil {
		client := &cloudFrontClient{
			keyPairID: config.CloudFrontKeyPairID,
			defaultRegion: config.OriginDomain,
		}
		s.cloudFrontClient = client
	}
	return s.cloudFrontClient, nil
}

func (s *CDNService) initCloudflareClient(config *model.CDNConfig) (*cloudflareClient, error) {
	if s.cloudflareClient == nil {
		client := &cloudflareClient{
			apiKey: config.CloudflareAPIKey,
			zoneID: config.CloudflareZoneID,
			email:  config.CloudflareEmail,
		}
		s.cloudflareClient = client
	}
	return s.cloudflareClient, nil
}

func (s *CDNService) initProviderClient(config *model.CDNConfig) {
	switch config.Provider {
	case model.CDNProviderCloudFront:
		s.initCloudFrontClient(config)
	case model.CDNProviderCloudflare:
		s.initCloudflareClient(config)
	}
}

// Cloudfront signed URL implementation using custom policy
func (c *cloudFrontClient) signURLCustom(url, policy string) (string, error) {
	if c.privateKey == nil {
		// Generate a mock signed URL for now
		return url + "&Policy=" + base64.RawURLEncoding.EncodeToString([]byte(policy)) + "&Signature=mock_signature&Key-Pair-Id=" + c.keyPairID, nil
	}

	// Standard CloudFront signing
	digest := sha1.Sum([]byte(policy))
	signature, err := rsa.SignPKCS1v15(rand.Reader, c.privateKey, crypto.SHA1, digest[:])
	if err != nil {
		return "", err
	}

	policyEncoded := base64.RawURLEncoding.EncodeToString([]byte(policy))
	signatureEncoded := base64.RawURLEncoding.EncodeToString(signature)

	return url + "?Policy=" + policyEncoded + "&Signature=" + signatureEncoded + "&Key-Pair-Id=" + c.keyPairID, nil
}

// Video CDN Mapping

func (s *CDNService) CreateVideoMapping(ctx context.Context, req CreateVideoMappingRequest) (*VideoMappingResponse, error) {
	// Check if mapping already exists
	existing, _ := s.repo.GetByVideoID(ctx, req.VideoID)
	if existing != nil {
		return nil, fmt.Errorf("mapping already exists for video %s", req.VideoID)
	}

	mapping := &model.VideoCDNMapping{
		UUID:              uuid.New(),
		VideoID:           req.VideoID,
		CDNConfigID:       req.CDNConfigID,
		HLSPath:           req.HLSPath,
		DASHPath:          req.DASHPath,
		ThumbnailPath:     req.ThumbnailPath,
		SpritePath:        req.SpritePath,
		SubtitlePath:      req.SubtitlePath,
		RequireSignedURL:  req.RequireSignedURL,
		SignedURLTTL:      req.SignedURLTTL,
		AllowedCountries:  req.AllowedCountries,
		BlockedCountries:  req.BlockedCountries,
		Enabled:           req.Enabled,
	}

	if mapping.SignedURLTTL == 0 {
		mapping.SignedURLTTL = 3600
	}

	if err := s.repo.CreateMapping(ctx, mapping); err != nil {
		return nil, err
	}

	return &VideoMappingResponse{
		UUID:          mapping.UUID.String(),
		VideoID:       mapping.VideoID,
		CDNConfigID:   mapping.CDNConfigID,
		Enabled:       mapping.Enabled,
	}, nil
}

func (s *CDNService) GetVideoMapping(ctx context.Context, videoID string) (*VideoMappingResponse, error) {
	mapping, err := s.repo.GetByVideoID(ctx, videoID)
	if err != nil {
		return nil, err
	}

	return &VideoMappingResponse{
		UUID:          mapping.UUID.String(),
		VideoID:       mapping.VideoID,
		CDNConfigID:   mapping.CDNConfigID,
		HLSPath:       mapping.HLSPath,
		DASHPath:      mapping.DASHPath,
		ThumbnailPath: mapping.ThumbnailPath,
		SpritePath:    mapping.SpritePath,
		SubtitlePath:  mapping.SubtitlePath,
		RequireSignedURL: mapping.RequireSignedURL,
		SignedURLTTL:  mapping.SignedURLTTL,
		Enabled:       mapping.Enabled,
	}, nil
}

func (s *CDNService) PurgeVideoCache(ctx context.Context, videoID string, paths []string) (*PurgeResponse, error) {
	mapping, err := s.repo.GetByVideoID(ctx, videoID)
	if err != nil {
		return nil, err
	}

	config, err := s.repo.GetByID(ctx, mapping.CDNConfigID)
	if err != nil {
		return nil, err
	}

	// Build paths to invalidate
	var invalidatePaths []string
	if len(paths) == 0 {
		// Invalidate all paths for this video
		invalidatePaths = []string{
			mapping.HLSPath + "/*",
			mapping.DASHPath + "/*",
			mapping.ThumbnailPath + "/*",
		}
	} else {
		invalidatePaths = paths
	}

	// Create invalidation request
	invalidationReq := CreateInvalidationRequest{
		Paths: invalidatePaths,
	}

	invResp, err := s.CreateInvalidation(ctx, mapping.CDNConfigID, invalidationReq)
	if err != nil {
		return nil, err
	}

	return &PurgeResponse{
		VideoID:        videoID,
		PathsInvalidated: len(invalidatePaths),
		InvalidationID: invResp.InvalidationID,
		Status:         invResp.Status,
	}, nil
}

// Analytics

func (s *CDNService) GetCDNAnalytics(ctx context.Context, configID uint, startDate, endDate time.Time) (*CDNAnalyticsResponse, error) {
	stats, err := s.repo.GetAggregatedStats(ctx, configID, startDate, endDate)
	if err != nil {
		return nil, err
	}

	totalReq := stats["total_requests"].(int64)
	totalBytes := stats["total_bytes"].(int64)
	cacheHits := stats["cache_hits"].(int64)
	cacheMisses := stats["cache_misses"].(int64)

	var hitRatio float64
	if totalReq > 0 {
		hitRatio = float64(cacheHits) / float64(totalReq) * 100
	}

	return &CDNAnalyticsResponse{
		ConfigID:        configID,
		StartDate:       startDate.Format("2006-01-02"),
		EndDate:         endDate.Format("2006-01-02"),
		TotalRequests:   totalReq,
		BytesTransferred: totalBytes,
		CacheHits:       cacheHits,
		CacheMisses:     cacheMisses,
		CacheHitRatio:   hitRatio,
	}, nil
}

func (s *CDNService) getProviderName(provider model.CDNProvider) string {
	switch provider {
	case model.CDNProviderCloudFront:
		return "CloudFront"
	case model.CDNProviderCloudflare:
		return "Cloudflare"
	case model.CDNProviderAkamai:
		return "Akamai"
	case model.CDNProviderFastly:
		return "Fastly"
	default:
		return "Unknown"
	}
}

func (s *CDNService) generateInvalidationID(provider model.CDNProvider) string {
	switch provider {
	case model.CDNProviderCloudFront:
		return "I" + uuid.New().String()[:8] + time.Now().Format("20060102150405")
	case model.CDNProviderCloudflare:
		return "purge_" + uuid.New().String()[:8]
	default:
		return "inv_" + uuid.New().String()[:8]
	}
}

// Request/Response types

type CreateCDNConfigRequest struct {
	Name                string `json:"name"`
	Provider            string `json:"provider"`
	Domain              string `json:"domain"`
	OriginDomain        string `json:"origin_domain"`
	OriginPath          string `json:"origin_path"`
	Enabled             bool   `json:"enabled"`
	DefaultTTL          int    `json:"default_ttl"`
	MaxTTL              int    `json:"max_ttl"`
	MinTTL              int    `json:"min_ttl"`
	Compress            bool   `json:"compress"`
	RequireSignedURLs   bool   `json:"require_signed_urls"`
	AllowedIPs          string `json:"allowed_ips"`
	BlockedCountries    string `json:"blocked_countries"`
	CustomHeaders       string `json:"custom_headers"`
	CloudFrontKeyPairID string `json:"cloudfront_key_pair_id"`
	CloudFrontPrivateKey string `json:"cloudfront_private_key"`
	CloudflareZoneID    string `json:"cloudflare_zone_id"`
	CloudflareAPIKey    string `json:"cloudflare_api_key"`
}

type UpdateCDNConfigRequest struct {
	Name              *string `json:"name,omitempty"`
	Domain            *string `json:"domain,omitempty"`
	OriginDomain      *string `json:"origin_domain,omitempty"`
	OriginPath        *string `json:"origin_path,omitempty"`
	Enabled           *bool   `json:"enabled,omitempty"`
	DefaultTTL        *int    `json:"default_ttl,omitempty"`
	MaxTTL            *int    `json:"max_ttl,omitempty"`
	Compress          *bool   `json:"compress,omitempty"`
	RequireSignedURLs *bool   `json:"require_signed_urls,omitempty"`
}

type CreateCacheRuleRequest struct {
	PathPattern        string `json:"path_pattern"`
	TTL                int    `json:"ttl"`
	AllowedMethods     string `json:"allowed_methods"`
	CachedMethods      string `json:"cached_methods"`
	ForwardHeaders     string `json:"forward_headers"`
	ForwardQueryString bool   `json:"forward_query_string"`
	ForwardCookies     string `json:"forward_cookies"`
	Compress           bool   `json:"compress"`
	Priority           int    `json:"priority"`
	Enabled            bool   `json:"enabled"`
}

type UpdateCacheRuleRequest struct {
	PathPattern *string `json:"path_pattern,omitempty"`
	TTL         *int    `json:"ttl,omitempty"`
	Compress    *bool   `json:"compress,omitempty"`
	Priority    *int    `json:"priority,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`
}

type CreateInvalidationRequest struct {
	Paths       []string `json:"paths"`
	RequestedBy uint     `json:"requested_by"`
}

type GenerateSignedURLRequest struct {
	ResourcePath  string `json:"resource_path"`
	ExpirySeconds int    `json:"expiry_seconds"`
	IPRestriction string `json:"ip_restriction,omitempty"`
}

type CreateVideoMappingRequest struct {
	VideoID           string `json:"video_id"`
	CDNConfigID       uint   `json:"cdn_config_id"`
	HLSPath           string `json:"hls_path"`
	DASHPath          string `json:"dash_path"`
	ThumbnailPath     string `json:"thumbnail_path"`
	SpritePath        string `json:"sprite_path"`
	SubtitlePath      string `json:"subtitle_path"`
	RequireSignedURL  bool   `json:"require_signed_url"`
	SignedURLTTL      int    `json:"signed_url_ttl"`
	AllowedCountries  string `json:"allowed_countries"`
	BlockedCountries  string `json:"blocked_countries"`
	Enabled           bool   `json:"enabled"`
}

type CDNConfigResponse struct {
	UUID               string `json:"uuid"`
	Name               string `json:"name"`
	Provider           string `json:"provider"`
	Domain             string `json:"domain"`
	OriginDomain       string `json:"origin_domain"`
	OriginPath         string `json:"origin_path"`
	Enabled            bool   `json:"enabled"`
	DefaultTTL         int    `json:"default_ttl"`
	MaxTTL             int    `json:"max_ttl"`
	MinTTL             int    `json:"min_ttl"`
	Compress           bool   `json:"compress"`
	RequireSignedURLs  bool   `json:"require_signed_urls"`
}

type CDNCacheRuleResponse struct {
	UUID    string `json:"uuid"`
	PathPattern string `json:"path_pattern"`
	TTL      int  `json:"ttl"`
	Compress bool `json:"compress"`
	Priority int  `json:"priority"`
	Enabled  bool `json:"enabled"`
}

type CDNInvalidationResponse struct {
	UUID           string   `json:"uuid"`
	InvalidationID string   `json:"invalidation_id"`
	Paths          []string `json:"paths"`
	Status         string   `json:"status"`
	ErrorMessage   string   `json:"error_message"`
	CreatedAt      string   `json:"created_at"`
}

type SignedURLResponse struct {
	Token     string `json:"token"`
	SignedURL string `json:"signed_url"`
	ExpiresAt string `json:"expires_at"`
}

type VideoMappingResponse struct {
	UUID             string `json:"uuid"`
	VideoID          string `json:"video_id"`
	CDNConfigID      uint   `json:"cdn_config_id"`
	HLSPath          string `json:"hls_path"`
	DASHPath         string `json:"dash_path"`
	ThumbnailPath    string `json:"thumbnail_path"`
	SpritePath       string `json:"sprite_path"`
	SubtitlePath     string `json:"subtitle_path"`
	RequireSignedURL bool   `json:"require_signed_url"`
	SignedURLTTL     int    `json:"signed_url_ttl"`
	Enabled          bool   `json:"enabled"`
}

type PurgeResponse struct {
	VideoID          string `json:"video_id"`
	PathsInvalidated int    `json:"paths_invalidated"`
	InvalidationID   string `json:"invalidation_id"`
	Status           string `json:"status"`
}

type CDNAnalyticsResponse struct {
	ConfigID         uint    `json:"config_id"`
	StartDate        string  `json:"start_date"`
	EndDate          string  `json:"end_date"`
	TotalRequests    int64   `json:"total_requests"`
	BytesTransferred int64   `json:"bytes_transferred"`
	CacheHits        int64   `json:"cache_hits"`
	CacheMisses      int64   `json:"cache_misses"`
	CacheHitRatio    float64 `json:"cache_hit_ratio"`
}