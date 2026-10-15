package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ============================================================================
// Whisper client tests
// ============================================================================
//
// Hinglish: inmein koi asli whisper server nahi chalta. Ek `httptest.Server`
// se hum wahi response bhejte hain jo faster-whisper-server bhejta hai, aur
// check karte hain ki client sahi parse karta hai. Isse network, model, ya
// GPU ke bina pura request/parse path test ho jata hai.

func newTestClient(t *testing.T, h http.HandlerFunc) (*WhisperClient, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return NewWhisperClient(WhisperConfig{BaseURL: srv.URL}), srv
}

// --- Not configured ---------------------------------------------------------

func TestWhisper_NotConfigured(t *testing.T) {
	// Empty base URL. Ye poora project ki pehle wali default thi, aur iska
	// matlab tha: request MinIO ko jaati aur S3 XML parse karne ki koshish hoti.
	c := NewWhisperClient(WhisperConfig{BaseURL: ""})
	if c.Configured() {
		t.Fatal("an empty base URL must report as not configured")
	}
	err := c.Ping(context.Background())
	if !errors.Is(err, ErrWhisperUnavailable) {
		t.Fatalf("Ping = %v, want ErrWhisperUnavailable", err)
	}
	_, _, terr := c.Transcribe(context.Background(), []byte("x"), "a.mp3", "en")
	if !errors.Is(terr, ErrWhisperUnavailable) {
		t.Fatalf("Transcribe = %v, want ErrWhisperUnavailable", terr)
	}
}

// --- Happy path -------------------------------------------------------------

func TestWhisper_TranscribeSegments(t *testing.T) {
	client, srv := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/asr" {
			t.Errorf("path = %q, want /asr", r.URL.Path)
		}
		// Language query param forward hona chahiye.
		if got := r.URL.Query().Get("language"); got != "hi" {
			t.Errorf("language = %q, want hi", got)
		}
		if r.URL.Query().Get("task") != "transcribe" {
			t.Errorf("task param missing")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(whisperResponse{
			Text:     "namaste duniya",
			Language: "hi",
			Segments: []struct {
				ID    int     `json:"id"`
				Start float64 `json:"start"`
				End   float64 `json:"end"`
				Text  string  `json:"text"`
			}{
				{ID: 0, Start: 0.5, End: 2.25, Text: " Namaste"},
				{ID: 1, Start: 2.25, End: 4.0, Text: " duniya"},
			},
		})
	})
	_ = srv

	segs, lang, err := client.Transcribe(context.Background(), []byte("audio"), "a.wav", "hi")
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if lang != "hi" {
		t.Errorf("language = %q, want hi", lang)
	}
	if len(segs) != 2 {
		t.Fatalf("got %d segments, want 2", len(segs))
	}
	// Text trim hona chahiye — model leading space deta hai.
	if segs[0].Text != "Namaste" {
		t.Errorf("segment 0 text = %q, want %q", segs[0].Text, "Namaste")
	}
	if segs[1].Start != 2.25 || segs[1].End != 4.0 {
		t.Errorf("segment 1 times = %v-%v, want 2.25-4", segs[1].Start, segs[1].End)
	}
}

// --- Filtering --------------------------------------------------------------

func TestWhisper_DropsEmptyAndInvalidSegments(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(whisperResponse{
			Language: "en",
			Segments: []struct {
				ID    int     `json:"id"`
				Start float64 `json:"start"`
				End   float64 `json:"end"`
				Text  string  `json:"text"`
			}{
				{ID: 0, Start: 0, End: 1, Text: "  "},        // empty text -> drop
				{ID: 1, Start: 2, End: 2, Text: "same time"}, // end <= start -> drop
				{ID: 2, Start: 5, End: 3, Text: "backwards"}, // drop
				{ID: 3, Start: 3, End: 3.5, Text: "keep me"}, // keep
			},
		})
	})

	segs, _, err := client.Transcribe(context.Background(), []byte("a"), "a.wav", "en")
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if len(segs) != 1 {
		t.Fatalf("got %d segments, want 1", len(segs))
	}
	if segs[0].Text != "keep me" {
		t.Errorf("kept %q, want %q", segs[0].Text, "keep me")
	}
}

func TestWhisper_NoSpeechIsAnError(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(whisperResponse{Language: "en"})
	})
	_, _, err := client.Transcribe(context.Background(), []byte("a"), "a.wav", "en")
	if !errors.Is(err, ErrNoSpeech) {
		t.Fatalf("err = %v, want ErrNoSpeech", err)
	}
}

// --- HTTP failure modes -----------------------------------------------------

func TestWhisper_ServerErrorIsTranscribeFailed(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("CUDA out of memory"))
	})
	_, _, err := client.Transcribe(context.Background(), []byte("a"), "a.wav", "en")
	if err == nil {
		t.Fatal("expected an error")
	}
	// 5xx par server zameen se gaya — ye "unavailable" hai kyunki request pohonch
	// gayi, isliye ALLOW_TIMEOUT/Failed-transcribe wala classification zaroori hai.
	if err == ErrWhisperUnavailable {
		t.Fatal("a 500 must not be reported as unavailable")
	}
}

func TestWhisper_PingUnreachableServer(t *testing.T) {
	// Koi bhi port jo sun hi nahi raha.
	c := NewWhisperClient(WhisperConfig{BaseURL: "http://127.0.0.1:1"})
	if err := c.Ping(context.Background()); !errors.Is(err, ErrWhisperUnavailable) {
		t.Fatalf("Ping = %v, want ErrWhisperUnavailable", err)
	}
}

// --- VTT -------------------------------------------------------------------

func TestVTTFormat(t *testing.T) {
	got := VTT([]Segment{
		{Start: 0, End: 2.5, Text: "Hello"},
		{Start: 3661.5, End: 3665, Text: "World"},
	})
	want := "WEBVTT\n\n" +
		"1\n00:00:00.000 --> 00:00:02.500\nHello\n\n" +
		"2\n01:01:01.500 --> 01:01:05.000\nWorld\n\n"
	if got != want {
		t.Errorf("VTT() =\n%q\nwant\n%q", got, want)
	}
}

func TestVTT_NegativeTimeClampsToZero(t *testing.T) {
	got := VTT([]Segment{{Start: -5, End: -1, Text: "x"}})
	if want := "WEBVTT\n\n1\n00:00:00.000 --> 00:00:00.000\nx\n\n"; got != want {
		t.Errorf("VTT() = %q, want %q", got, want)
	}
}
