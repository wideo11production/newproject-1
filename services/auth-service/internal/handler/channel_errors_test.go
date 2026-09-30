package handler

// Regression tests for the channel error -> HTTP status mapping.
//
// WHY THIS FILE EXISTS
//
// `CreateChannel` had its own inline error switch that was a strict subset of
// `writeChannelError`. It did not handle `ErrDisplayNameInvalid`, so an empty
// or over-80-character display name - a plain client-side validation mistake -
// came back as HTTP 500. That tells the caller "the server is broken" and
// invites a pointless retry loop.
//
// The switch has since been removed in favour of the shared mapper. These
// tests pin the mapping so the two cannot drift apart again, and so a new
// sentinel error added to the service has to make an explicit choice about
// its status code rather than silently falling through to 500.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/model"
)

func init() { gin.SetMode(gin.TestMode) }

// capture runs f against a throwaway gin context and returns the recorded
// status plus the decoded JSON body.
func capture(t *testing.T, f func(c *gin.Context)) (int, map[string]any) {
	t.Helper()

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)

	f(c)

	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body) // these mappers always write valid JSON
	return rec.Code, body
}

func TestWriteChannelErrorStatusMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantError  string
	}{
		{
			name:       "not found",
			err:        model.ErrChannelNotFound,
			wantStatus: http.StatusNotFound,
			wantError:  "channel_not_found",
		},
		{
			name:       "invalid handle",
			err:        model.ErrHandleInvalid,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_handle",
		},
		{
			name:       "handle taken",
			err:        model.ErrHandleTaken,
			wantStatus: http.StatusConflict,
			wantError:  "handle_taken",
		},
		{
			// The regression: this used to reach the 500 default.
			name:       "invalid display name is a client error, not a server error",
			err:        model.ErrDisplayNameInvalid,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_display_name",
		},
		{
			name:       "description too long",
			err:        model.ErrDescriptionTooLong,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_description",
		},
		{
			name:       "url too long",
			err:        model.ErrURLTooLong,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_url",
		},
		{
			name:       "url scheme not allowed",
			err:        model.ErrURLSchemeNotAllowed,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_url",
		},
		{
			name:       "wrapped errors still map",
			err:        wrapped(model.ErrHandleTaken),
			wantStatus: http.StatusConflict,
			wantError:  "handle_taken",
		},
		{
			name:       "unknown error fails closed as 500",
			err:        errors.New("connection reset by peer"),
			wantStatus: http.StatusInternalServerError,
			wantError:  "channel operation failed",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, body := capture(t, func(c *gin.Context) { writeChannelError(c, tc.err) })

			if status != tc.wantStatus {
				t.Errorf("status = %d, want %d", status, tc.wantStatus)
			}
			if got, _ := body["error"].(string); got != tc.wantError {
				t.Errorf(`body["error"] = %q, want %q`, got, tc.wantError)
			}
		})
	}
}

// TestWriteChannelErrorNeverLeaksInternalDetail checks that a database error
// reaching the client is generic. A raw pgx error carries table and column
// names, which hands an attacker a free map of the schema.
func TestWriteChannelErrorNeverLeaksInternalDetail(t *testing.T) {
	_, body := capture(t, func(c *gin.Context) {
		writeChannelError(c, errors.New(
			`ERROR: duplicate key value violates unique constraint "idx_channels_user_handle" (SQLSTATE 23505)`,
		))
	})

	if msg, _ := body["message"].(string); msg != "" {
		t.Errorf("unexpected error response carries a message field: %q", msg)
	}
}

// The service-side half of this bug (CreateChannel returning
// ErrChannelNotFound for a bad display name) is deliberately NOT re-tested
// here. Asserting it would mean either a live database, or copying the
// validation rule into the test - and a copy that drifts from the original is
// worse than no test, because it stays green while the bug returns.
//
// It is covered end to end instead: register -> verify -> security gate ->
// create a channel with an empty display_name, and assert 400.

func wrapped(err error) error { return fmt.Errorf("context: %w", err) }
