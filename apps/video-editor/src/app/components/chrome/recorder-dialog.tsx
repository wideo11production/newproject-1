'use client';

// ============================================================================
// Camera + microphone recorder
// ============================================================================
//
// ---- WHY PREVIEW BEFORE SAVE IS NON-NEGOTIABLE ----
//
// A take is not free to redo. If "save" is one click from "record", a misfire
// - wrong framing, the cat walks in, you cough - is gone. So the flow is
// deliberately three states, and you cannot reach the bin from the middle one:
//
//     idle -> recording -> REVIEW -> (keep | discard) -> idle
//
// REVIEW is a separate state with the clip loaded, playing, and a visible
// "keep or discard" choice. There is no path from recording to the bin that
// skips it.
//
// ---- LOCAL, NOT A SERVICE ----
//
// `getUserMedia` + `MediaRecorder` are browser APIs. No upload, no account, no
// per-minute cost. The blob lives in memory for the session, exactly like the
// media bin's object URLs, and is revoked when discarded or the component
// unmounts.
//
// ---- THE TWO TRACKS ARE SEPARATE ----
//
// Camera video and microphone audio are separate MediaStreams. A user
// recording a voiceover while screen-sharing should get an audio-only clip,
// and a user framing a shot should not get a stray mic track. So the two
// sources are toggled independently and each is recorded on its own, with the
// camera track including audio only when "also record audio" is on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Mic, Square, Circle, Check, X, RotateCcw, Loader2, AlertTriangle } from 'lucide-react';

type State = 'idle' | 'requesting' | 'recording' | 'review';

export function RecorderDialog({
  open,
  onClose,
  onKeep,
}: {
  open: boolean;
  onClose: () => void;
  onKeep: (items: Array<{ name: string; kind: 'video' | 'audio'; url: string; duration: number }>) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [useCam, setUseCam] = useState(true);
  const [useMic, setUseMic] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ---- Device selection ---------------------------------------------------
  //
  // A laptop has a built-in camera AND a microphone. Plug in a phone over USB
  // (or attach a USB webcam) and the machine suddenly has two of each - and
  // `getUserMedia` with no `deviceId` silently picks the built-in one, every
  // time. The user has no way to say "not that one", which is why recording
  // with an attached phone was not possible at all.
  //
  // The chosen id is passed as `{ exact: id }` so the browser does NOT
  // substitute something else if the chosen device vanishes - a silent
  // substitution is worse than an error, because the user then records the
  // wrong camera and only finds out in the edit.
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState<string>('');
  const [micId, setMicId] = useState<string>('');

  // Enumerate devices. The `devicechange` event fires when a device is plugged
  // in or pulled out, so the list does not go stale the moment someone reaches
  // for their phone.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const list = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
      try {
        // Labels are empty until permission is granted. Enumerating FIRST and
        // letting the browser hide the names until then is why the UI has to
        // survive a second enumeration after the stream starts.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCams(all.filter((d) => d.kind === 'videoinput'));
        setMics(all.filter((d) => d.kind === 'audioinput'));
      } catch {
        /* device list unavailable - the default camera still works */
      }
    };

    void list();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', list);
    return () => {
      cancelled = true;
      md?.removeEventListener?.('devicechange', list);
    };
  }, [open, state]);

  // Re-enumerate once a stream exists: that is when the browser reveals the
  // human-readable names ("HD Webcam", "Pixel 8"), so the dropdowns become
  // meaningful instead of a list of "Camera 1".
  useEffect(() => {
    if (!open) return;
    if (state !== 'review' && state !== 'recording') return;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices.enumerateDevices().then((all) => {
      setCams(all.filter((d) => d.kind === 'videoinput'));
      setMics(all.filter((d) => d.kind === 'audioinput'));
    });
  }, [open, state]);

  const camPreviewRef = useRef<HTMLVideoElement>(null);
  const reviewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const urlRef = useRef<string | null>(null);

  /** Stop every track. A camera LED that stays on after closing is a bug. */
  const teardown = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  useEffect(() => {
    if (!open) {
      teardown();
      setState('idle');
      setElapsed(0);
      setError(null);
    }
  }, [open, teardown]);

  // Elapsed ticker. Driven off wall-clock at start, not by counting ticks, so
  // a throttled background tab cannot under-report the length of a take.
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(
      () => setElapsed((Date.now() - startedAtRef.current) / 1000),
      100
    );
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback(async () => {
    setError(null);
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: useCam
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              // `exact` on a chosen deviceId, `ideal` on the width/height.
              //
              // Why not `facingMode` alone: browsers pick the FRONT camera by
              // default, so on a laptop with a phone plugged in (or a USB
              // webcam) you get the laptop's built-in lens and there is no way
              // to change it from the UI. Passing an explicit `deviceId` is the
              // only thing that actually honours the user's choice, and it is
              // exactly the case the user hit.
              ...(camId ? { deviceId: { exact: camId } } : {}),
            }
          : false,
        audio: useMic
          ? {
              echoCancellation: true,
              noiseSuppression: true,
              ...(micId ? { deviceId: { exact: micId } } : {}),
            }
          : false,
      });

      if (!useCam && !useMic) {
        setError('Turn on the camera, the microphone, or both.');
        setState('idle');
        return;
      }

      streamRef.current = stream;
      if (camPreviewRef.current) {
        camPreviewRef.current.srcObject = stream;
        await camPreviewRef.current.play().catch(() => {});
      }

      const mime = useCam
        ? 'video/webm;codecs=vp9,opus'
        : 'audio/webm;codecs=opus';
      // Safari has no MediaRecorder for webm. It is not a crash, it is a
      // capability gap, and saying so beats failing at record time with an
      // opaque error.
      if (typeof MediaRecorder === 'undefined') {
        setError('This browser cannot record. Chrome, Edge and Firefox can.');
        setState('idle');
        teardown();
        return;
      }
      if (!MediaRecorder.isTypeSupported(mime)) {
        const alt = useCam ? 'video/webm' : 'audio/webm';
        if (!MediaRecorder.isTypeSupported(alt)) {
          setError('This browser cannot record WebM. Chrome, Edge and Firefox can.');
          setState('idle');
          teardown();
          return;
        }
        recorderRef.current = new MediaRecorder(stream, { mimeType: alt });
      } else {
        recorderRef.current = new MediaRecorder(stream, { mimeType: mime });
      }

      chunksRef.current = [];
      recorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current.start(250); // timeslice, so a crash keeps partial audio
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState('recording');
    } catch (e) {
      const err = e as DOMException;
      setError(
        err.name === 'NotAllowedError'
          ? 'Permission denied. Allow camera and microphone in the browser address bar, then try again.'
          : err.name === 'NotFoundError'
            ? 'No camera or microphone found on this machine.'
            : err.message || 'Could not start recording.'
      );
      setState('idle');
      teardown();
    }
  }, [useCam, useMic, teardown]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    // Release the hardware now rather than after the review, so the camera
    // light goes off the moment recording ends.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('review');

    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType ?? 'video/webm' });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    if (reviewRef.current) reviewRef.current.src = url;
  }, []);

  const keep = useCallback(() => {
    if (!urlRef.current) return;
    const secs = (Date.now() - startedAtRef.current) / 1000;
    onKeep([
      {
        name: `Recording ${new Date().toLocaleTimeString()}`,
        kind: useCam ? 'video' : 'audio',
        url: urlRef.current,
        duration: secs,
      },
    ]);
    teardown();
    setState('idle');
    onClose();
  }, [onKeep, onClose, useCam, teardown]);

  const discard = useCallback(() => {
    teardown();
    setElapsed(0);
    setState('idle');
  }, [teardown]);

  if (!open) return null;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');

  const card = 'rounded border border-edge bg-surface-raised p-4';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-surface/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record camera or microphone"
    >
      <div className="w-full max-w-lg space-y-3 rounded-lg border border-edge-strong bg-surface-raised p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold text-white">Record</h2>
          <button
            type="button"
            onClick={() => (state === 'recording' ? stop() : onClose())}
            aria-label="Close"
            className="rounded p-1 text-fg-muted hover:bg-surface-overlay hover:text-white"
          >
            <X className="h-2 w-2" />
          </button>
        </div>

        {/* ---- Source toggles ---- */}
        {(state === 'idle' || state === 'requesting') && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setUseCam((v) => !v)}
              aria-pressed={useCam}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-[8px] transition-colors ${
                useCam ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-edge-strong text-fg-muted'
              }`}
            >
              <Camera className="h-2 w-2" /> Camera {useCam ? 'on' : 'off'}
            </button>

            {/*
              ---- WHICH camera and WHICH microphone ----

              Shown only when there IS a choice. A machine with one camera gets
              a single option, and a dropdown offering exactly one entry is pure
              clutter - it says "you have a choice" when you do not.

              The label is the device's own name, and before permission is
              granted the browser reports empty labels, so this falls back to
              "Camera 1 / 2" rather than showing a blank row.
            */}
            {(state === 'idle' || state === 'requesting') && (useCam ? cams.length > 1 : false) && (
              <select
                value={camId}
                onChange={(e) => setCamId(e.target.value)}
                aria-label="Camera to record from"
                className="w-full rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-[8px] text-fg focus:border-sky-500 focus:outline-none"
              >
                <option value="">System default camera</option>
                {cams.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            {(state === 'idle' || state === 'requesting') && (useMic ? mics.length > 1 : false) && (
              <select
                value={micId}
                onChange={(e) => setMicId(e.target.value)}
                aria-label="Microphone to record from"
                className="w-full rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-[8px] text-fg focus:border-sky-500 focus:outline-none"
              >
                <option value="">System default microphone</option>
                {mics.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => setUseMic((v) => !v)}
              aria-pressed={useMic}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-[8px] transition-colors ${
                useMic ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-edge-strong text-fg-muted'
              }`}
            >
              <Mic className="h-2 w-2" /> Microphone {useMic ? 'on' : 'off'}
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded border border-amber-800 bg-amber-950/40 p-2.5 text-[8px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-2 w-2 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---- Live preview while recording ---- */}
        {(state === 'requesting' || state === 'recording') && (
          <div className="space-y-2">
            <video
              ref={camPreviewRef}
              muted
              playsInline
              className="aspect-video w-full rounded bg-black object-contain"
            />
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[8px] text-red-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                REC {mm}:{ss}
              </span>
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-[8px] font-medium text-white hover:bg-red-500"
              >
                <Square className="h-2 w-2 fill-current" /> Stop
              </button>
            </div>
          </div>
        )}

        {state === 'requesting' && (
          <p className="flex items-center justify-center gap-2 py-4 text-[8px] text-fg-secondary">
            <Loader2 className="h-2 w-2 animate-spin" /> Waiting for permission…
          </p>
        )}

        {/* ---- REVIEW: you must choose before it can reach the bin ---- */}
        {state === 'review' && (
          <div className="space-y-3">
            <p className="text-[8px] text-fg-secondary">
              Watch it back before keeping it. Nothing reaches the timeline until you keep it.
            </p>
            <video
              ref={reviewRef}
              controls
              playsInline
              className="aspect-video w-full rounded bg-black"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={discard}
                className="flex flex-1 items-center justify-center gap-2 rounded-md border border-edge-strong px-3 py-2 text-[8px] text-fg hover:bg-surface-overlay"
              >
                <RotateCcw className="h-2 w-2" /> Discard and retake
              </button>
              <button
                type="button"
                onClick={keep}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-[8px] font-medium text-white hover:bg-sky-500"
              >
                <Check className="h-2 w-2" /> Keep to timeline
              </button>
            </div>
          </div>
        )}

        {state === 'idle' && (
          <button
            type="button"
            onClick={start}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-3 py-2.5 text-[8px] font-medium text-white hover:bg-red-500"
          >
            <Circle className="h-2 w-2 fill-current" /> Start recording
          </button>
        )}

        <p className="border-t border-edge pt-2 text-[8px] leading-snug text-fg-muted">
          Everything here runs in your browser. Nothing is uploaded, so there is no
          service, no account and nothing to pay for.
        </p>
      </div>
    </div>
  );
}
