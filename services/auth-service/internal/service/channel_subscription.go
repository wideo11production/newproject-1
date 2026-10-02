// Channel subscriptions: subscribe, unsubscribe, and the DERIVED count.
//
// =============================================================================
// THE DERIVED COUNT
// =============================================================================
//
// Every read of "how many subscribers" goes through the
// `channel_subscriber_counts` view, cached in Redis for a short TTL. Nothing
// increments a number.
//
// The cache exists because the count is read on every channel page view and
// recomputing it each time would be a COUNT per page load. It is deliberately
// SHORT-TTL and deliberately invalidated on write, so the two failure modes -
// a stale number, and no cache at all - both land on "briefly wrong" rather than
// "permanently wrong". See `subscribeDB` for the invalidation.

package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// Errors. Distinct types rather than a shared "failed", because each one means
// something different to the caller and the client needs to say so.
var (
	// ErrChannelNotSubscribed - cancelling something that is not subscribed.
	// Not ErrChannelNotFound: the channel is there, the SUBSCRIPTION is not, and
	// conflating them produces a 404 that sends a user hunting for a channel
	// that exists.
	ErrChannelNotSubscribed = errors.New("not subscribed to this channel")

	// ErrCannotSubscribeOwnChannel - a creator subscribing to themselves.
	ErrCannotSubscribeOwnChannel = errors.New("you cannot subscribe to your own channel")
)

// subscriberCountCacheTTL is how long a derived count is reused.
//
// Sixty seconds is a judgement call and worth being explicit about the trade:
// a subscribe or unsubscribe INVALIDATES the entry, so this TTL only bounds how
// long a count can be stale after a write that somehow missed its invalidation -
// a cross-process write, a rolled-back cache op. It bounds staleness; it is not
// the primary correctness mechanism, and treating it as one would be a mistake.
const subscriberCountCacheTTL = 60 * time.Second

func channelCountCacheKey(channelID uuid.UUID) string {
	return "channel:subs:" + channelID.String()
}

// CountCache is the narrow slice of Redis this service needs.
//
// An INTERFACE rather than `*redis.Client`, for two reasons:
//   - the repo wraps Redis in `internal/redisx.Client`, which keeps its inner
//     client private. Taking `*redis.Client` would mean unwrapping that, or
//     adding a getter to a wrapper that has no other reason to expose one.
//   - three methods is small enough to fake in a test, and the subscriber-count
//     logic is exactly the thing worth testing without a live Redis.
//
// Note what is NOT here: no TTL, no SetNX, no pipelines. A wider interface
// would be a wider contract to keep working.
type CountCache interface {
	Get(ctx context.Context, key string) *redis.StringCmd
	Set(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.StatusCmd
	Del(ctx context.Context, keys ...string) *redis.IntCmd
}

// ChannelSubscriptionService owns subscriptions and the derived count.
type ChannelSubscriptionService struct {
	db    *gorm.DB
	cache CountCache
}

// NewChannelSubscriptionService builds the service.
//
// `cache` may be nil: the derived count then falls through to the database on
// every read, which is slower and always correct. Redis being down must not make
// subscribing impossible.
func NewChannelSubscriptionService(db *gorm.DB, cache CountCache) *ChannelSubscriptionService {
	return &ChannelSubscriptionService{db: db, cache: cache}
}

// Subscribe adds a viewer to a channel, or reactivates an existing row.
//
// IDEMPOTENT by construction. Subscribing twice is not an error and does not
// create a second row - the unique constraint on (channel_id, user_id) means
// "subscribe" is a statement about desired state, not an event to be counted.
// That is what makes a client retry safe.
//
// `FirstSubscribedAt` is preserved across a re-subscribe, deliberately: it is
// "how long have they been here", and a user who cancels and comes back has not
// become a new subscriber.
func (s *ChannelSubscriptionService) Subscribe(
	ctx context.Context, channelID, userID uuid.UUID, tier string,
) (*model.ChannelSubscription, error) {
	if tier == "" {
		tier = model.SubscriptionTierFree
	}
	if tier != model.SubscriptionTierFree && tier != model.SubscriptionTierPaid {
		return nil, fmt.Errorf("unknown subscription tier %q", tier)
	}

	// ---- The channel must exist and be live ----
	var channel model.Channel
	err := s.db.WithContext(ctx).
		Select("id, user_id, is_active, deleted_at").
		Where("id = ?", channelID).
		First(&channel).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, model.ErrChannelNotFound
		}
		return nil, err
	}

	// Self-subscribe is refused rather than tolerated. It is a free way to make
	// a creator's own number look better, and nothing legitimate needs it.
	if channel.UserID == userID {
		return nil, ErrCannotSubscribeOwnChannel
	}

	now := time.Now().UTC()

	// ---- Create or reactivate ----
	//
	// `OnConflict` does the work, so this is ONE round trip and cannot race with
	// a concurrent subscribe. Doing it as read-then-write would reintroduce
	// exactly the lost-update problem this whole design exists to avoid.
	var sub model.ChannelSubscription
	err = s.db.WithContext(ctx).
		Where("channel_id = ? AND user_id = ?", channelID, userID).
		First(&sub).Error

	switch {
	case err == gorm.ErrRecordNotFound:
		sub = model.ChannelSubscription{
			ID:                uuid.New(),
			ChannelID:         channelID,
			UserID:            userID,
			Tier:              tier,
			Status:            model.SubscriptionStatusActive,
			FirstSubscribedAt: now,
			StartedAt:         now,
		}
		if err := s.db.WithContext(ctx).Create(&sub).Error; err != nil {
			return nil, err
		}

	case err != nil:
		return nil, err

	default:
		// Already have a row. Reactivate it if it was cancelled; leave an active
		// row alone so a duplicate subscribe is a no-op rather than a rewrite
		// that would reset `StartedAt` and lie about when the current period began.
		if sub.Status != model.SubscriptionStatusActive {
			// `Updates` with an explicit map, NOT `Save`.
			//
			// `Save(&sub)` writes EVERY field it holds, and `sub` was just loaded
			// from Postgres. `first_subscribed_at` therefore came back in whatever
			// location the driver hands back, was written unchanged, and Postgres
			// re-interpreted it in the session timezone - moving the instant by
			// the UTC offset. It was caught by
			// `TestResubscribePreservesFirstSubscribedAt`: the stored value moved
			// from 09:50 UTC to 15:20 IST, i.e. five and a half hours, on a
			// re-subscribe that was supposed to change nothing about it.
			//
			// A targeted map fixes that and closes the whole class of bug: a
			// field cannot be corrupted if it is not in the list.
			if err := s.db.WithContext(ctx).
				Model(&model.ChannelSubscription{}).
				Where("id = ?", sub.ID).
				Updates(map[string]any{
					"status": model.SubscriptionStatusActive,
					"tier":   tier,
					// UTC explicitly: the same reason as above, applied at the
					// source this time.
					"started_at":   now.UTC(),
					"ends_at":      nil,
					"cancelled_at": nil,
				}).Error; err != nil {
				return nil, err
			}

			// Refresh the struct so the response matches what is now stored.
			sub.Status = model.SubscriptionStatusActive
			sub.Tier = tier
			sub.StartedAt = now.UTC()
			sub.EndsAt = nil
			sub.CancelledAt = nil
		}
	}

	s.invalidateCount(ctx, channelID)
	return &sub, nil
}

// Unsubscribe cancels a subscription. The row is KEPT, not deleted.
//
// Keeping it is what preserves `first_subscribed_at` and makes the count
// honest on re-subscribe. Deleting it would also work, but then there is no
// record that someone ever subscribed - and the count would be the only history,
// which is the thing that drifted in the first place.
func (s *ChannelSubscriptionService) Unsubscribe(ctx context.Context, channelID, userID uuid.UUID) error {
	now := time.Now().UTC()

	res := s.db.WithContext(ctx).
		Model(&model.ChannelSubscription{}).
		Where("channel_id = ? AND user_id = ? AND status = ?",
			channelID, userID, model.SubscriptionStatusActive).
		Updates(map[string]any{
			"status":       model.SubscriptionStatusCancelled,
			"cancelled_at": now,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		// Either not subscribed, or already cancelled. Both are the same thing
		// to the caller: there is no active subscription to remove.
		return ErrChannelNotSubscribed
	}

	s.invalidateCount(ctx, channelID)
	return nil
}

// SubscriberCount returns the DERIVED count for a channel.
//
// Read from the view, cached briefly. Returns 0 for a channel nobody has
// subscribed to - which is different from "unknown", and the distinction is why
// this returns a plain count rather than an error.
func (s *ChannelSubscriptionService) SubscriberCount(ctx context.Context, channelID uuid.UUID) (int64, error) {
	key := channelCountCacheKey(channelID)

	if s.cache != nil {
		if cached, err := s.cache.Get(ctx, key).Result(); err == nil {
			var n int64
			if _, scanErr := fmt.Sscanf(cached, "%d", &n); scanErr == nil {
				return n, nil
			}
			// A cache entry we cannot parse is discarded rather than guessed at.
		}
	}

	var row model.ChannelSubscriberCounts
	err := s.db.WithContext(ctx).
		Model(&model.ChannelSubscriberCounts{}).
		Where("channel_id = ?", channelID).
		Take(&row).Error

	count := row.SubscriberCount

	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	// Only successful reads are cached, so an error cannot be pinned for 60s.
	if s.cache != nil && err == nil {
		// Best-effort. If Redis is down the count is still correct, just slower.
		_ = s.cache.Set(ctx, key, count, subscriberCountCacheTTL).Err()
	}

	return count, nil
}

// SubscriberCounts returns the full derived breakdown - total, paid, free.
func (s *ChannelSubscriptionService) SubscriberCounts(ctx context.Context, channelID uuid.UUID) (model.ChannelSubscriberCounts, error) {
	var row model.ChannelSubscriberCounts
	err := s.db.WithContext(ctx).
		Model(&model.ChannelSubscriberCounts{}).
		Where("channel_id = ?", channelID).
		Take(&row).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		// No subscribers is a legitimate state, not a missing row.
		return model.ChannelSubscriberCounts{ChannelID: channelID}, nil
	}
	return row, err
}

// IsSubscribed reports whether a user currently counts as a subscriber.
func (s *ChannelSubscriptionService) IsSubscribed(ctx context.Context, channelID, userID uuid.UUID) (bool, error) {
	var sub model.ChannelSubscription
	err := s.db.WithContext(ctx).
		Select("id, ends_at, status").
		Where("channel_id = ? AND user_id = ?", channelID, userID).
		First(&sub).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// Uses the same derived check as the count, so "is X subscribed" and "does
	// the count include X" cannot disagree.
	return sub.IsActive(time.Now().UTC()), nil
}

// ListSubscribers returns active subscribers, newest first.
//
// Bounded, always. This is an unbounded table and an unpaginated list is a
// denial of service with a JSON body.
func (s *ChannelSubscriptionService) ListSubscribers(
	ctx context.Context, channelID uuid.UUID, limit, offset int,
) ([]model.ChannelSubscription, int64, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	q := s.db.WithContext(ctx).Model(&model.ChannelSubscription{}).
		Where("channel_id = ? AND status = ? AND (ends_at IS NULL OR ends_at > ?)",
			channelID, model.SubscriptionStatusActive, time.Now().UTC())

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	rows := make([]model.ChannelSubscription, 0, limit)
	err := q.Order("first_subscribed_at DESC").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, total, err
}

// IsChannelOwner reports whether a user owns a channel.
//
// Exists because "who is the owner" is asked on every subscriber list, and the
// alternative is the handler reaching into the channels table directly - which is
// the same layering leak that `handler/creator.go` documents for channel CRUD.
// Keeping it here means the ownership rule lives in one place.
//
// A missing channel answers false rather than erroring: the caller's next step is
// a 404 either way, and an ownership check is not a good place to turn a missing
// row into a 500.
func (s *ChannelSubscriptionService) IsChannelOwner(ctx context.Context, channelID, userID uuid.UUID) (bool, error) {
	var channel model.Channel
	err := s.db.WithContext(ctx).
		Select("id, user_id").
		Where("id = ?", channelID).
		First(&channel).Error

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return channel.UserID == userID, nil
}

// invalidateCount drops a channel's cached count after a write.
//
// Best-effort by design: a failed invalidation costs up to one TTL of staleness,
// which is the same bound the TTL already accepts. Failing the SUBSCRIBE because
// a cache delete failed would trade a correct write for a stale read, which is
// the wrong trade in both directions.
func (s *ChannelSubscriptionService) invalidateCount(ctx context.Context, channelID uuid.UUID) {
	if s.cache == nil {
		return
	}
	_ = s.cache.Del(ctx, channelCountCacheKey(channelID)).Err()
}
