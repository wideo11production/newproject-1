// Access to the UI click ledger.
//
// Two queries, and that is intentional. The dashboard's "what do people click"
// question is served by an aggregate; "show me the click at 14:03" is a point
// lookup. Neither needs arbitrary SQL, so neither gets it.

package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"newproject/services/analytics-service/src/model"
)

// UIClickRepository reads and writes the ledger.
type UIClickRepository struct {
	db *gorm.DB
}

func NewUIClickRepository(db *gorm.DB) *UIClickRepository {
	return &UIClickRepository{db: db}
}

// UIClickPageFilter narrows a ledger read.
//
// Only fields the dashboard actually filters by are exposed. There is no
// free-form `where` map, because a `map[string]any` filter on a table holding
// every click in the system is an invitation to a full scan by accident.
type UIClickPageFilter struct {
	Surface string
	Page    string
	Since   time.Time
	// Days is the window. Kept alongside Since because the UI speaks in days
	// ("last 7 days") and `Since` is a timestamp; converting in the handler
	// would mean the two can drift.
	Days   int
	Limit  int
	Offset int
}

// CreateBatch appends a batch of ledger rows inside one transaction.
//
// One transaction for the batch is deliberate. A batch is a flush of queued
// clicks, so a partial write means the ledger silently under-reports - and a
// ledger that under-reports looks exactly like a product nobody uses. Better to
// fail the batch and lose 10 clicks than to record 6 of 10 with no error
// anywhere.
//
// `size` is the per-statement row cap, which keeps the generated INSERT under
// Postgres's 65535 bind-parameter ceiling. At 20 columns per row, 100 rows is
// 2000 parameters - comfortable. It also needs a value rather than a constant
// because the caller already has a sensible batch size in hand.
func (r *UIClickRepository) CreateBatch(ctx context.Context, rows []model.UIClickEvent, size int) error {
	if len(rows) == 0 {
		return nil
	}
	if size <= 0 {
		size = 100
	}
	return r.db.WithContext(ctx).CreateInBatches(rows, size).Error
}

// List returns ledger rows newest first.
func (r *UIClickRepository) List(ctx context.Context, f UIClickPageFilter) ([]model.UIClickEvent, int64, error) {
	q := r.db.WithContext(ctx).Model(&model.UIClickEvent{})

	if f.Surface != "" {
		q = q.Where("surface = ?", f.Surface)
	}
	if f.Page != "" {
		q = q.Where("page = ?", f.Page)
	}
	if !f.Since.IsZero() {
		q = q.Where("occurred_at >= ?", f.Since)
	}
	if f.Days > 0 {
		q = q.Where("occurred_at >= ?", time.Now().UTC().AddDate(0, 0, -f.Days))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	limit := f.Limit
	if limit <= 0 || limit > 200 {
		// Same cap as ingest, and for the same reason: this is a table that
		// grows without bound, so an unbounded read is a denial of service
		// dressed up as a convenience.
		limit = 100
	}

	rows := make([]model.UIClickEvent, 0, limit)
	err := q.Order("occurred_at DESC").Limit(limit).Offset(f.Offset).Find(&rows).Error
	return rows, total, err
}

// TopTargets is the dashboard's headline: what gets clicked, most clicked first.
//
// This is the aggregate that Prometheus deliberately is NOT. Prometheus can only
// answer "did the click rate go up"; it cannot answer "which button", because
// the answer is an unbounded set of strings and putting that in a label is how
// you take Prometheus down.
type TargetCount struct {
	Target string `json:"target"`
	Count  int64  `json:"count"`
}

func (r *UIClickRepository) TopTargets(ctx context.Context, surface string, since time.Time, limit int) ([]TargetCount, error) {
	q := r.db.WithContext(ctx).Model(&model.UIClickEvent{}).
		Select("target, count(*) as count").
		Group("target")

	if surface != "" {
		q = q.Where("surface = ?", surface)
	}
	if !since.IsZero() {
		q = q.Where("occurred_at >= ?", since)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	rows := make([]TargetCount, 0, limit)
	err := q.Order("count DESC").Limit(limit).Scan(&rows).Error
	return rows, err
}

// PurgeOlderThan deletes rows written before the cutoff and returns the count.
//
// Keyed on `created_at`, NOT `occurred_at`. That distinction is the whole point:
// `occurred_at` comes from the client, so a caller could send a timestamp from
// last year and have their own rows aged out on the next run - or, inverted,
// send a timestamp from next week and make rows immortal.
//
// `created_at` is set by the database, so the retention window cannot be
// influenced by the thing being retained.
func (r *UIClickRepository) PurgeOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	res := r.db.WithContext(ctx).
		Unscoped().
		Where("created_at < ?", cutoff).
		Delete(&model.UIClickEvent{})
	return res.RowsAffected, res.Error
}

// CountSince reports rows written since a cutoff, for the retention log.
func (r *UIClickRepository) CountSince(ctx context.Context, since time.Time) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&model.UIClickEvent{}).
		Where("created_at >= ?", since).
		Count(&n).Error
	return n, err
}

// CountOlderThan reports rows written before a cutoff - the purge backlog.
//
// Keyed on `created_at` for the same reason `PurgeOlderThan` is: `occurred_at`
// comes from the client, so a backlog counted on it would be a number a caller
// could influence.
func (r *UIClickRepository) CountOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&model.UIClickEvent{}).
		Where("created_at < ?", cutoff).
		Count(&n).Error
	return n, err
}

// -----------------------------------------------------------------------------
// Stats
// -----------------------------------------------------------------------------

// ClickStats is the Awareness grid's summary.
//
// Field names are the grid's `ClickStats` interface verbatim. This is a wire
// contract with a TypeScript file, so renaming a field here shows up as
// `undefined` in the dashboard rather than as a build error.
//
// `RetentionDays` and `EstimatedRowsPendingPurge` are not decoration. A dashboard
// that silently under-reports is worse than one that says "90 days, 12,000 rows
// past the window", because only the second one tells you retention is broken.
type ClickStats struct {
	TotalClicks               int64            `json:"total_clicks"`
	ClicksToday               int64            `json:"clicks_today"`
	Clicks24h                 int64            `json:"clicks_24h"`
	UniqueUsers               int64            `json:"unique_users"`
	TopPages                  []TopTargetCount `json:"top_pages"`
	OldestEvent               *time.Time       `json:"oldest_event"`
	NewestEvent               *time.Time       `json:"newest_event"`
	RetentionDays             int              `json:"retention_days"`
	EstimatedRowsPendingPurge int64            `json:"estimated_rows_pending_purge"`
}

// TopTargetCount is one row of the "top pages" list.
//
// Named for what it is at the HTTP boundary - it counts `surface` + `page`
// pairs, not bare page names. `page` alone is ambiguous: the editor and the web
// landing page are both "/". Aggregating on the bare name would merge them and
// report a number that is true of neither.
type TopTargetCount struct {
	Surface string `json:"surface"`
	Page    string `json:"page"`
	Clicks  int64  `json:"clicks"`
}

// Stats computes the grid summary over the retention window.
func (r *UIClickRepository) Stats(ctx context.Context, days, retentionDays int) (ClickStats, error) {
	out := ClickStats{RetentionDays: retentionDays, TopPages: []TopTargetCount{}}

	if days <= 0 {
		days = 30
	}
	now := time.Now().UTC()
	startOfWindow := now.AddDate(0, 0, -days)

	q := func() *gorm.DB { return r.db.WithContext(ctx).Model(&model.UIClickEvent{}) }

	// Three DIFFERENT windows, so three separate statements rather than a loop:
	// today, the last 24 hours, and the whole range. A loop would hide the very
	// thing that matters - which window is which - and a wrong window in a
	// dashboard is a number nobody can check.
	//
	// `Count(&n)` in this GORM version returns `*gorm.DB` (chainable), not a
	// count, so the result comes back out of `n` and the error off the statement.
	var n int64

	q().Where("occurred_at >= ?", startOfWindow).Count(&n)
	out.TotalClicks = n

	n = 0
	q().Where("occurred_at >= ?", now.Truncate(24*time.Hour)).Count(&n)
	out.ClicksToday = n

	n = 0
	q().Where("occurred_at >= ?", now.AddDate(0, 0, -1)).Count(&n)
	out.Clicks24h = n

	// A failed aggregate would otherwise be reported as "zero clicks", which is
	// indistinguishable from a quiet day - so it is checked explicitly rather
	// than assumed away.
	if err := q().Error; err != nil {
		return out, err
	}

	// Distinct USERS, not distinct rows. A click without a user id (a signed-out
	// visitor on a public page) still counts toward TotalClicks - that traffic is
	// exactly what a funnel needs - but it must not be counted as a user.
	var err error
	if err = q().Where("occurred_at >= ?", startOfWindow).
		Where("user_id IS NOT NULL").
		Distinct("user_id").Count(&out.UniqueUsers).Error; err != nil {
		return out, err
	}

	rows := make([]TopTargetCount, 0, 10)
	if err = q().
		Select("surface, page, count(*) as clicks").
		Where("occurred_at >= ?", startOfWindow).
		Group("surface, page").
		Order("clicks DESC").
		Limit(10).
		Scan(&rows).Error; err != nil {
		return out, err
	}
	out.TopPages = rows

	// Oldest/newest over the whole table, not the window: they answer "how much
	// history exists", which is a different question from "how much is in range".
	var bounds struct {
		Oldest *time.Time
		Newest *time.Time
	}
	if err = q().Select("min(occurred_at) as oldest, max(occurred_at) as newest").Scan(&bounds).Error; err != nil {
		return out, err
	}
	out.OldestEvent, out.NewestEvent = bounds.Oldest, bounds.Newest

	// Rows already past the window and waiting for the next sweep. Non-zero here
	// between sweeps is normal; persistently non-zero means the retention job is
	// not running, which is exactly what this number is for.
	if retentionDays > 0 {
		purgeCutoff := now.AddDate(0, 0, -retentionDays)
		if err = q().Where("created_at < ?", purgeCutoff).Count(&out.EstimatedRowsPendingPurge).Error; err != nil {
			return out, err
		}
	}

	return out, nil
}
