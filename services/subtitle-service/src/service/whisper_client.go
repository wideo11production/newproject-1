package service

// ============================================================================
// WHISPER CLIENT — real speech-to-text, over HTTP
// ============================================================================
//
// ---- KYUN YE FILE HAI ----
//
// `AutoGenerate()` pehle ek `exec.Command` chalata tha jisme FFmpeg ke arguments
// hi transcription ka kaam nahi karte the (`-c:a:0 -disposition <output>` —
// ye ek audio disposition flag hai, speech-to-text ka argument nahi), aur uske
// baad DB me `Source: "whisper"` likh deta tha. Yaani ye service claim karti thi
// ki subtitles bani hain, jabki kuch bhi nahi banta tha. Client ek row dekhta
// aur subtitle ke saath ek 404 file path.
//
// Ye file asli call karti hai: audio bytes bhejo, timed segments lo.
//
// ---- KAUNSA SERVER ----
//
// `faster-whisper-server` (fedirz/faster-whisper-server). Kyun:
//
//   * Ye ek standard Docker image hai, koi custom code nahi.
//   * `/v1/audio/transcriptions` endpoint multipart audio leta hai aur JSON
//     segments deta hai — OpenAI-compatible shape.
//   * `language`, `response_format`, `task` query params support karta hai.
//   * CTranslate2 backend — CPU pe bhi kaam chalta hai, GPU optional.
//
// Ye project ka `whisper.url` config use karta hai, jo pehle se tha lekin kabhi
// use nahi hua (default `http://localhost:9000` tha, jo waqai MinIO tha — yaani
// "whisper server" naam pe MinIO ko hit karte). Ab default bhi sudhara hai.
//
// ---- ENDPOINT PATH: /v1/audio/transcriptions, NAHI /asr ----
//
// Pehle `/asr?task=transcribe&output=json` use kiya tha, aur woh path is
// image version me exist hi nahi karta. 404 aata tha, aur `ErrTranscribeFailed`
// me `whisper returned 404` ek 502 client ko jaata tha. Endpoint OpenAI
// compatibility layer ke through chalta hai, isliye ye path use kiya jaata hai.
//
// ---- TIMEOUT KYUN ZAROORI HAI ----
//
// Transcription slow hai (1 min audio = 10-60s CPU pe). Bina timeout ke ek
// stuck request handler ko hang kar deta hai, aur koi creditor nahi batata ki
// request mar chuki hai. Default 10 min — lamba hota hai, lekin FINITE.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Segment — ek caption cue, seconds me. Ye wahi shape hai jo client UI
// (`normaliseCues`) expect karta hai, isliye beech me koi mapping nahi.
type Segment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

// ErrWhisperUnavailable — server configured nahi ya reachable nahi.
//
// Ye `ErrTranscribeFailed` se ALAG hai, kyunki caller ko in dono ka different
// treatment chahiye: "not configured" par UI kehti hai "feature off hai",
// jabki "transcribe fail" kehti hai "dobara try karo".
var (
	ErrWhisperUnavailable = fmt.Errorf("whisper service is not reachable")
	ErrTranscribeFailed   = fmt.Errorf("transcription failed")
	ErrNoSpeech           = fmt.Errorf("no speech was found in the audio")
)

// WhisperConfig — jo cheezein `SubtitleConfig` se aati hain.
type WhisperConfig struct {
	// BaseURL, no trailing slash. e.g. "http://whisper:8000".
	BaseURL string
	// Timeout for ONE transcription request. 0 = 10 minutes.
	Timeout time.Duration
}

type WhisperClient struct {
	baseURL string
	http    *http.Client
}

const DefaultWhisperTimeout = 10 * time.Minute

func NewWhisperClient(cfg WhisperConfig) *WhisperClient {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = DefaultWhisperTimeout
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	// Empty base = not configured. `base == ""` pe har request whaii fail hogi,
	// aur `Ping` saaf-saaf false batayega.
	return &WhisperClient{
		baseURL: base,
		http:    &http.Client{Timeout: timeout},
	}
}

// Configured — kya base URL set hai?
func (w *WhisperClient) Configured() bool {
	return w.baseURL != ""
}

// Ping — server zinda hai? isAvailable ke liye, taaki UI pehle hi bata sake
// ki transcription chalegi ya nahi (10 min ka hang bekaar hai).
func (w *WhisperClient) Ping(ctx context.Context) error {
	if !w.Configured() {
		return ErrWhisperUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, w.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	// Chhota timeout: ye sirf ek health check hai, transcription ko nahi rokna.
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrWhisperUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: health returned %d", ErrWhisperUnavailable, resp.StatusCode)
	}
	return nil
}

// whisperResponse — faster-whisper-server ka `/asr` JSON shape.
//
// Sirf woh fields jo humein chahiye. Baaki (tokens, temperature, seek...)
// ignore — unmarshal ke waqt unknown fields chhote bade dono taraf se safe hain.
type whisperResponse struct {
	Text     string `json:"text"`
	Language string `json:"language"`
	Segments []struct {
		ID    int     `json:"id"`
		Start float64 `json:"start"`
		End   float64 `json:"end"`
		Text  string  `json:"text"`
	} `json:"segments"`
}

// Transcribe — audio bytes do, timed segments lo.
//
// `language` empty ya "auto" = server khud detect kare. Fixed language se
// accuracy better hoti hai aur ek step bachta hai.
//
// `filename` wav/mp3 jo bhi ho — server khud decode karta hai. Browser se hum
// WAV bhejte hain taaki server pe FFmpeg dependency na ho.
func (w *WhisperClient) Transcribe(
	ctx context.Context,
	audio []byte,
	filename string,
	language string,
) ([]Segment, string, error) {
	if !w.Configured() {
		return nil, "", ErrWhisperUnavailable
	}
	if len(audio) == 0 {
		return nil, "", fmt.Errorf("%w: empty audio", ErrTranscribeFailed)
	}

	// ---- multipart body ----
	//
	// Built by hand rather than via multipart.Writer, which has no
	// CreateField/WriteField in this Go version — and the OpenAI-compatible
	// endpoint needs `response_format` as a query param, not a form field.
	const boundary = "----Wideo11SubtitleBoundary"
	var body bytes.Buffer
	body.WriteString("--" + boundary + "\r\n")
	body.WriteString("Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\n")
	body.WriteString("Content-Type: audio/wav\r\n\r\n")
	body.Write(audio)
	body.WriteString("\r\n--" + boundary + "--\r\n")

	// ---- query params ----
	// OpenAI-compatible path. NOT `/asr` — that path does not exist in this
	// image version and returns 404, which surfaced as a 502 to the client.
	u := w.baseURL + "/v1/audio/transcriptions?response_format=json"
	lang := strings.TrimSpace(language)
	if lang != "" && lang != "auto" {
		u += "&language=" + lang
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, &body)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)

	resp, err := w.http.Do(req)
	if err != nil {
		// Network error = server zinda nahi. Ye "transcribe fail" nahi hai.
		return nil, "", fmt.Errorf("%w: %v", ErrWhisperUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("%w: reading response: %v", ErrTranscribeFailed, err)
	}

	if resp.StatusCode != http.StatusOK {
		// 5xx par server zameen se gaya hoga (OOM, model load fail).
		return nil, "", fmt.Errorf("%w: whisper returned %d: %s",
			ErrTranscribeFailed, resp.StatusCode, truncate(string(raw), 200))
	}

	var out whisperResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, "", fmt.Errorf("%w: bad JSON from whisper: %v", ErrTranscribeFailed, err)
	}

	// ---- segments normalise ----
	//
	// Model kabhi kabhi empty text, ya end <= start deta hai. Client side
	// `normaliseCues` bhi ye karta hai, lekin server se pehle hi saaf bhejna
	// behtar hai — kam data, aur client ke liye kam kaam.
	segments := make([]Segment, 0, len(out.Segments))
	for _, s := range out.Segments {
		text := strings.TrimSpace(s.Text)
		if text == "" {
			continue
		}
		start, end := s.Start, s.End
		// Whisper kabhi kabhi last segment me end ko null (-1) deta hai
		// jab audio achanak khatam ho jaye.
		if end <= start {
			continue
		}
		segments = append(segments, Segment{Start: start, End: end, Text: text})
	}

	if len(segments) == 0 {
		return nil, out.Language, ErrNoSpeech
	}

	return segments, out.Language, nil
}

// VTT — segments se WEBVTT banao.
//
// Local helper, kyunki `GenerateVTTFromSRT` SRT leta hai, aur humare paas SRT
// nahi — seedha segments hain. Ek hi conversion function hona chahiye, isliye ye
// yahan hai aur `GenerateSTLSRT`/`convertSRTTimecode` wale helpers reuse nahi
// karte (wo SRT-format pe kaam karte hain).
func VTT(segments []Segment) string {
	var sb strings.Builder
	sb.WriteString("WEBVTT\n\n")
	for i, s := range segments {
		// Index shuru se, taaki seek predictable ho.
		fmt.Fprintf(&sb, "%d\n", i+1)
		fmt.Fprintf(&sb, "%s --> %s\n", vttTime(s.Start), vttTime(s.End))
		sb.WriteString(strings.TrimSpace(s.Text))
		sb.WriteString("\n\n")
	}
	return sb.String()
}

// vttTime — seconds -> "HH:MM:SS.mmm". VTT format.
func vttTime(seconds float64) string {
	if seconds < 0 {
		seconds = 0
	}
	total := time.Duration(seconds * float64(time.Second))
	h := int(total.Hours())
	m := int(total.Minutes()) % 60
	sec := int(total.Seconds()) % 60
	ms := int(total.Milliseconds()) % 1000
	return fmt.Sprintf("%02d:%02d:%02d.%03d", h, m, sec, ms)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
