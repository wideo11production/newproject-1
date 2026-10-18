package service

// ============================================================================
// CONTENT COMPLIANCE HOOK - Phase 1 Student Verification Engine
// ============================================================================
//
// WHAT THIS DOES
// --------------
// Jab ek channel student_tier = true ho, to uske uploads sirf educational
// content_category ke allowed hain. Non-educational upload (kisi bhi other
// category) ko block kar diya jaata hai, aur compliance violation record
// hota hai billing-service enforcement loop ke liye.
//
// TWO LAYERS:
//   1. CheckStudentContentCompliance - pure decision (channel category +
//      student tier check). Testable bina DB ke.
//   2. RequireStudentContentCompliance - gate helper that reads channel
//      from DB and calls the pure decision. Fail-closed on infra error.
//
// EDUCATIONAL CONTENT CATEGORIES (hardcoded whitelist):
//   - tutorial, lecture, course, lesson, study_guide, exam_prep,
//     academic_project, research, thesis, educational_documentary
//
// NON-EDUCATIONAL (blocked for student tier):
//   - entertainment, music, gaming, vlog, comedy, sports, news,
//     lifestyle, fashion, travel, food, other
//
// Hinglish: student verification tier ka matlab hai "sirf educational
// content upload karo". Agar koi student tier channel non-educational
// upload karne ki koshish kare, to upload presigned URL issue nahi hota
// aur compliance violation flag billing-service ko jaata hai (penalty
// + suspension pipeline ke liye).
// ============================================================================

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// StudentContentCategory - channel ka content category (educational ya general).
type StudentContentCategory string

const (
	ContentCategoryEducational StudentContentCategory = "educational"
	ContentCategoryGeneral     StudentContentCategory = "general"
)

// EducationalContentWhitelist - hardcoded set of allowed educational
// content categories for student tier channels.
//
// Koi bhi category jo is set mein nahi hai, wo student tier channel ke
// liye BLOCKED hai. Is set ko change karna = breaking policy change,
// isliye explicit aur closed rakha hai.
var EducationalContentWhitelist = map[string]bool{
	"tutorial":            true,
	"lecture":             true,
	"course":              true,
	"lesson":              true,
	"study_guide":         true,
	"exam_prep":           true,
	"academic_project":    true,
	"research":            true,
	"thesis":              true,
	"educational_documentary": true,
}

// ComplianceDecision - content compliance ka nateeja.
type ComplianceDecision struct {
	Allowed     bool
	Reason      string
	Message     string
	ChannelID   uuid.UUID
	IsStudent   bool
	Category    string
}

// IsEducationalCategory - check karta hai ki given category educational whitelist
// mein hai ya nahi.
func IsEducationalCategory(category string) bool {
	return EducationalContentWhitelist[category]
}

// decideStudentContentCompliance - PURE decision function.
//
// Inputs: channel is student tier?, requested category educational?
// Output: Allowed + Reason.
//
// Decision table:
//   - student=true, category=educational -> ALLOWED
//   - student=true, category=general/other -> BLOCKED (non-educational for student tier)
//   - student=false, category=any -> ALLOWED (general channel, no restriction)
//
// Hinglish: sirf student_tier=true channels ko restriction milti hai.
// General channels kisi bhi category ka upload kar sakte hain.
func decideStudentContentCompliance(isStudent bool, category string) ComplianceDecision {
	if !isStudent {
		return ComplianceDecision{
			Allowed:  true,
			Reason:   "general_channel_no_restriction",
			Message:  "ok",
			Category: category,
		}
	}

	if IsEducationalCategory(category) {
		return ComplianceDecision{
			Allowed:  true,
			Reason:   "educational_content_allowed",
			Message:  "ok",
			IsStudent: true,
			Category: category,
		}
	}

	return ComplianceDecision{
		Allowed:  false,
		Reason:   "non_educational_content_blocked_for_student_tier",
		Message:  "Student tier channels can only upload educational content. Requested category '" + category + "' is not educational.",
		IsStudent: true,
		Category: category,
	}
}

// RequireStudentContentCompliance - gate helper for upload handlers.
//
// Reads the channel from DB by channelID, checks student_tier flag and
// requested content category against the educational whitelist. Returns
// false (and writes JSON response) when blocked.
//
// Fail-closed: any DB/infra error blocks the upload with a generic
// message (never leak infrastructure details).
func (s *AuthService) RequireStudentContentCompliance(
	ctx context.Context,
	channelID uuid.UUID,
	contentCategory string,
) (*ComplianceDecision, error) {
	var channel struct {
		ID             uuid.UUID
		StudentTier    bool
		ContentCategory string
	}
	err := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Select("id", "student_tier", "content_category").
		Where("id = ?", channelID).
		First(&channel).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &ComplianceDecision{
				Allowed: false,
				Reason:  "channel_not_found",
				Message: "Channel not found.",
			}, nil
		}
		// Infra failure -> fail CLOSED
		return &ComplianceDecision{
			Allowed: false,
			Reason:  "compliance_check_unavailable",
			Message: "Could not verify content compliance. Please try again.",
		}, err
	}

	decision := decideStudentContentCompliance(channel.StudentTier, contentCategory)
	decision.ChannelID = channel.ID
	decision.IsStudent = channel.StudentTier
	decision.Category = channel.ContentCategory
	return &decision, nil
}

// ErrStudentContentCompliance - compliance gate ne upload block kiya.
var ErrStudentContentCompliance = errors.New("student content compliance violation")
