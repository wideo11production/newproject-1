package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/nats-io/nats.go"
	"newproject/services/recommendation-service/src/model"
	"newproject/services/recommendation-service/src/repository"
	"newproject/services/recommendation-service/src/config"
)

// Event types for recommendation events
const (
	EventTypeClick    = "click"
	EventTypeFollow   = "follow"
	EventTypeWatch    = "watch"
	EventTypeUnfollow = "unfollow"
)

// RecommendationEvent represents an event from the NATS backbone
type RecommendationEvent struct {
	EventType string      `json:"event_type"`
	UserID    string      `json:"user_id"`
	Payload   interface{} `json:"payload,omitempty"`
	Timestamp int64       `json:"timestamp"` // Unix milliseconds
}

// ClickEventPayload represents payload for click events
type ClickEventPayload struct {
	ContentID string `json:"content_id"`
	Position  int    `json:"position,omitempty"` // Position in feed/list where clicked
}

// FollowEventPayload represents payload for follow events
type FollowEventPayload struct {
	TargetID string `json:"target_id"` // Could be user ID or category ID
	TargetType string `json:"target_type"` // "user" or "category"
}

// WatchEventPayload represents payload for watch events
type WatchEventPayload struct {
	ContentID     string `json:"content_id"`
	DurationWatched float64 `json:"duration_watched"` // In seconds
	DurationTotal   float64 `json:"duration_total"`   // Total content duration
	DeviceType    string `json:"device_type"`
	NetworkType   string `json:"network_type"`
	TimeOfDay     string `json:"time_of_day"`
	DayOfWeek     string `json:"day_of_week"`
	Season        string `json:"season"`
}

// Consumer manages NATS subscription for recommendation events
type Consumer struct {
	nc     *nats.Conn
	repo   *repository.RecommendationRepository
	cfg    *config.Config
	sub    *nats.Subscription
	ctx    context.Context
	cancel context.CancelFunc
}

// NewConsumer creates a new NATS consumer for recommendation events
func NewConsumer(cfg *config.Config, repo *repository.RecommendationRepository) (*Consumer, error) {
	// Connect to NATS
	nc, err := nats.Connect(cfg.NATS.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &Consumer{
		nc:     nc,
		repo:   repo,
		cfg:    cfg,
		ctx:    ctx,
		cancel: cancel,
	}, nil
}

// Start begins listening for events on the recommended subjects
func (c *Consumer) Start() error {
	// We'll subscribe to the analytics subject which we assume carries recommendation events
	// In a more granular setup, we could have separate subjects for each event type
	subject := c.cfg.NATS.Subjects.Analytics
	if subject == "" {
		subject = "recommendation.analytics" // fallback
	}

	var err error
	c.sub, err = c.nc.Subscribe(subject, c.handleEvent)
	if err != nil {
		return fmt.Errorf("failed to subscribe to subject %s: %w", subject, err)
	}

	// Flush to ensure subscription is registered
	if err := c.nc.Flush(); err != nil {
		return fmt.Errorf("failed to flush NATS connection: %w", err)
	}

	log.Printf("Started NATS consumer for subject: %s", subject)
	return nil
}

// Stop closes the subscription and connection
func (c *Consumer) Stop() {
	if c.sub != nil {
		c.sub.Unsubscribe()
	}
	c.cancel()
	if c.nc != nil {
		c.nc.Close()
	}
	log.Printf("Stopped NATS consumer")
}

// handleEvent processes incoming NATS events
func (c *Consumer) handleEvent(msg *nats.Msg) {
	var event RecommendationEvent
	if err := json.Unmarshal(msg.Data, &event); err != nil {
		log.Printf("Error decoding NATS event: %v", err)
		return
	}

	// Process event based on type
	switch event.EventType {
	case EventTypeClick:
		c.handleClickEvent(event)
	case EventTypeFollow:
		c.handleFollowEvent(event)
	case EventTypeUnfollow:
		c.handleUnfollowEvent(event)
	case EventTypeWatch:
		c.handleWatchEvent(event)
	default:
		log.Printf("Unknown event type: %s", event.EventType)
	}
}

// handleClickEvent updates user's engagement based on click
func (c *Consumer) handleClickEvent(event RecommendationEvent) {
	payload, ok := event.Payload.(map[string]interface{})
	if !ok {
		log.Printf("Invalid click event payload")
		return
	}
	clickEvent := ClickEventPayload{}
	if err := mapToStruct(payload, &clickEvent); err != nil {
		log.Printf("Error parsing click event payload: %v", err)
		return
	}

	// For simplicity, we'll just log the click. In a real system, we might update engagement score.
	// We could update the UserPreferenceMatrix to increase the score for the content's category, language, etc.
	// But we don't have the content details here. We would need to fetch the content from the repository.
	// For now, we'll just note that a click occurred.
	log.Printf("User %s clicked on content %s", event.UserID, clickEvent.ContentID)
	// TODO: Update engagement metrics in the database
}

// handleFollowEvent updates user's followed categories or users
func (c *Consumer) handleFollowEvent(event RecommendationEvent) {
	payload, ok := event.Payload.(map[string]interface{})
	if !ok {
		log.Printf("Invalid follow event payload")
		return
	}
	followEvent := FollowEventPayload{}
	if err := mapToStruct(payload, &followEvent); err != nil {
		log.Printf("Error parsing follow event payload: %v", err)
		return
	}

	ctx := context.Background()
	switch followEvent.TargetType {
	case "user":
		// Add to followed users
		prefMatrix, err := c.repo.GetUserPreferenceMatrix(ctx, event.UserID)
		if err != nil {
			log.Printf("Error getting user preference matrix: %v", err)
			return
		}
		// Avoid duplicates
		found := false
		for _, uid := range prefMatrix.FollowedUsers {
			if uid == followEvent.TargetID {
				found = true
				break
			}
		}
		if !found {
			prefMatrix.FollowedUsers = append(prefMatrix.FollowedUsers, followEvent.TargetID)
			if err := c.repo.UpdateUserPreferenceMatrix(ctx, prefMatrix); err != nil {
				log.Printf("Error updating user preference matrix: %v", err)
			} else {
				log.Printf("User %s started following user %s", event.UserID, followEvent.TargetID)
			}
		}
	case "category":
		// Add to followed categories
		prefMatrix, err := c.repo.GetUserPreferenceMatrix(ctx, event.UserID)
		if err != nil {
			log.Printf("Error getting user preference matrix: %v", err)
			return
		}
		// Avoid duplicates
		found := false
		for _, cat := range prefMatrix.FollowedCategories {
			if cat == followEvent.TargetID {
				found = true
				break
			}
		}
		if !found {
			prefMatrix.FollowedCategories = append(prefMatrix.FollowedCategories, followEvent.TargetID)
			if err := c.repo.UpdateUserPreferenceMatrix(ctx, prefMatrix); err != nil {
				log.Printf("Error updating user preference matrix: %v", err)
			} else {
				log.Printf("User %s started following category %s", event.UserID, followEvent.TargetID)
			}
		}
	default:
		log.Printf("Unknown target type for follow: %s", followEvent.TargetType)
	}
}

// handleUnfollowEvent removes user's followed categories or users
func (c *Consumer) handleUnfollowEvent(event RecommendationEvent) {
	payload, ok := event.Payload.(map[string]interface{})
	if !ok {
		log.Printf("Invalid unfollow event payload")
		return
	}
	followEvent := FollowEventPayload{}
	if err := mapToStruct(payload, &followEvent); err != nil {
		log.Printf("Error parsing unfollow event payload: %v", err)
		return
	}

	ctx := context.Background()
	switch followEvent.TargetType {
	case "user":
		// Remove from followed users
		prefMatrix, err := c.repo.GetUserPreferenceMatrix(ctx, event.UserID)
		if err != nil {
			log.Printf("Error getting user preference matrix: %v", err)
			return
		}
		newList := []string{}
		for _, uid := range prefMatrix.FollowedUsers {
			if uid != followEvent.TargetID {
				newList = append(newList, uid)
			}
		}
		if len(newList) < len(prefMatrix.FollowedUsers) {
			prefMatrix.FollowedUsers = newList
			if err := c.repo.UpdateUserPreferenceMatrix(ctx, prefMatrix); err != nil {
				log.Printf("Error updating user preference matrix: %v", err)
			} else {
				log.Printf("User %s unfollowed user %s", event.UserID, followEvent.TargetID)
			}
		}
	case "category":
		// Remove from followed categories
		prefMatrix, err := c.repo.GetUserPreferenceMatrix(ctx, event.UserID)
		if err != nil {
			log.Printf("Error getting user preference matrix: %v", err)
			return
		}
		newList := []string{}
		for _, cat := range prefMatrix.FollowedCategories {
			if cat != followEvent.TargetID {
				newList = append(newList, cat)
			}
		}
		if len(newList) < len(prefMatrix.FollowedCategories) {
			prefMatrix.FollowedCategories = newList
			if err := c.repo.UpdateUserPreferenceMatrix(ctx, prefMatrix); err != nil {
				log.Printf("Error updating user preference matrix: %v", err)
			} else {
				log.Printf("User %s unfollowed category %s", event.UserID, followEvent.TargetID)
			}
		}
	default:
		log.Printf("Unknown target type for unfollow: %s", followEvent.TargetType)
	}
}

// handleWatchEvent updates watch duration curves
func (c *Consumer) handleWatchEvent(event RecommendationEvent) {
	payload, ok := event.Payload.(map[string]interface{})
	if !ok {
		log.Printf("Invalid watch event payload")
		return
	}
	watchEvent := WatchEventPayload{}
	if err := mapToStruct(payload, &watchEvent); err != nil {
		log.Printf("Error parsing watch event payload: %v", err)
		return
	}

	// Get the content to know its category, etc.
	content, err := c.repo.GetContentItemByUUID(context.Background(), watchEvent.ContentID)
	if err != nil {
		log.Printf("Error getting content for watch event: %v", err)
		return
	}
	if content == nil {
		log.Printf("Content not found for watch event: %s", watchEvent.ContentID)
		return
	}

	// Create watch duration curve
	curve := &model.WatchDurationCurve{
		UserID:         event.UserID,
		ContentID:      watchEvent.ContentID,
		Category:       content.Category,
		ContentType:    content.ContentType,
		DurationWatched: watchEvent.DurationWatched,
		DurationTotal:   watchEvent.DurationTotal,
		CompletionRate:  watchEvent.DurationWatched / watchEvent.DurationTotal,
		EngagementScore: calculateEngagementScore(watchEvent.DurationWatched, watchEvent.DurationTotal),
		DeviceType:      watchEvent.DeviceType,
		NetworkType:     watchEvent.NetworkType,
		TimeOfDay:       watchEvent.TimeOfDay,
		DayOfWeek:       watchEvent.DayOfWeek,
		Season:          watchEvent.Season,
	}

	if err := c.repo.SaveWatchDurationCurve(context.Background(), curve); err != nil {
		log.Printf("Error saving watch duration curve: %v", err)
	} else {
		log.Printf("Saved watch duration curve for user %s, content %s", event.UserID, watchEvent.ContentID)
	}
}

// calculateEngagementScore computes an engagement score based on completion rate
func calculateEngagementScore(durationWatched, durationTotal float64) float64 {
	if durationTotal == 0 {
		return 0.0
	}
	completionRate := durationWatched / durationTotal
	// Simple heuristic: completion rate squared to emphasize full watches
	return completionRate * completionRate
}

// mapToStruct converts a map to a struct using JSON marshaling/unmarshaling
func mapToStruct(src map[string]interface{}, dst interface{}) error {
	data, err := json.Marshal(src)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dst)
}