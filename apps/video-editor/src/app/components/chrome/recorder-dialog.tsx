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
import { Camera, Mic, Square, Circle, Check, X, RotateCcw, Loader2, AlertTriangle, Download } from 'lucide-react';

type State = 'idle' | 'requesting' | 'ready' | 'recording' | 'review';

/**
 * How long the dialog lingers after handing a take to the library.
 *
 * Long enough to read one line of confirmation. Any shorter and the message is
 * something that happened rather than something the user saw.
 */
const AUTO_CLOSE_MS = 3000;

export function RecorderDialog({
  open,
  onClose,
  onKeep,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Hand a kept take over as BYTES, not as a URL.
   *
   * It used to pass a `blob:` URL, which put this component in charge of a URL
   * whose lifetime is really the caller's problem: the caller has to register it
   * somewhere that will revoke it on unload, and write the bytes somewhere durable
   * so the clip survives a reload. Passing the Blob means one owner — the media
   * store mints the URL, tracks it for revocation, and keeps the bytes — and this
   * component's URLs are released the moment the dialog closes.
   */
  onKeep: (items: Array<{ name: string; kind: 'video' | 'audio'; blob: Blob; duration: number }>) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [useCam, setUseCam] = useState(true);
  const [useMic, setUseMic] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ---- Auto-close after handing the take over ----
  //
  // Keeping a take closes this dialog by itself after a beat, so the user gets
  // back to the timeline without a second click. The beat is long enough to read
  // the confirmation, and it is Cancellable: a timer that fires after the user has
  // already closed the dialog is a timer firing on nothing, and the usual result
  // is a stray state update on an unmounted component.
  //
  // `requestClose` is the ONLY way out, so there is exactly one place that clears
  // the timer and no path that can leak one.
  const autoCloseRef = useRef<number | null>(null);
  const cancelAutoClose = useCallback(() => {
    if (autoCloseRef.current !== null) {
      window.clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
  }, []);

  /** Close, cancelling any pending auto-close. Safe to call twice. */
  const requestClose = useCallback(() => {
    cancelAutoClose();
    onClose();
  }, [cancelAutoClose, onClose]);

  // Belt and braces: a pending timer must not outlive the component.
  useEffect(() => cancelAutoClose, [cancelAutoClose]);

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
  // The BLOB as well as its URL. `showSaveFilePicker` writes a Blob directly, and
  // reading it back out of the blob URL would mean a pointless round trip through
  // a resource we may have just revoked.
  const blobRef = useRef<Blob | null>(null);
  // The mime type is read in `onstop`, which fires AFTER the stop call has
  // returned - so it cannot be read off `recorderRef.current`, because teardown
  // may already have nulled that by then.
  const mimeRef = useRef<string>('video/webm');
  // Bumped on every start and every discard. A `MediaRecorder` whose data lands
  // after the user has already discarded and started a new take would otherwise
  // report "Nothing was recorded" over the top of the take being made NOW.
  const sessionRef = useRef(0);
  // The rendered preview URL. STATE rather than a ref - see the note on onstop.
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);

  // The parallel audio-only recorder, for the "separate" option. See start.
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioBlobRef = useRef<Blob | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const [audioReviewUrl, setAudioReviewUrl] = useState<string | null>(null);

  // Where the last save actually landed, named by the file picker. Shown so a save
  // confirms itself instead of vanishing silently.
  const [savedTo, setSavedTo] = useState<string | null>(null);

  // What the last take was handed to. The dialog shows this for its last moments
  // before closing itself, which is the only moment the user actually sees it.
  const [keptNote, setKeptNote] = useState<string | null>(null);

  // "Keep video and audio as separate clips", chosen at review time.
  //
  // DEFAULT FALSE, because the combined clip is what almost everybody wants: one
  // file that drops onto the timeline and plays. Separating is for somebody who is
  // replacing the audio — a new voiceover over a kept camera take — and that is a
// deliberate choice, not the convenient default.
  const [keepSeparateAudio, setKeepSeparateAudio] = useState(false);

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

  // =============================================================================
  // LIVE INPUT LEVELS
  // =============================================================================
  //
  // MISSING ENTIRELY before this, and that is why recording looked broken.
  //
  // With the camera off, the preview is a `<video>` element carrying no video
  // track. It renders a black box: no picture, no motion, nothing. So a person
  // recording a voiceover had NO way to tell a working microphone from a dead
  // one — the only evidence anything was happening was the `REC 00:12` counter.
  //
  // With the camera ON it was no better in a different way: a muted or unplugged
  // microphone is invisible, because the picture looks fine.
  //
  // `AnalyserNode` measures the actual signal. `getByteTimeDomainData` returns a
  // 0..255 waveform around 128; the RMS of that is the level.
  //
  // WHY TIME-DOMAIN AND NOT AN FFT
  //
  // Because a person's VOICE is what needs showing. A frequency bar graph is
  // dominated by a quiet room's noise floor and reads as "nothing is happening"
  // while somebody is plainly talking.
  //
  // WHY A REF AND NOT `useState`
  //
  // The loop is a requestAnimationFrame chain that runs for the whole recording.
  // As state it would re-render this dialog roughly 60 times a second, which is the
  // same render storm that produced React #300 elsewhere in this editor. The
  // animation writes to one DOM node through a ref and re-renders nothing.
  const levelRef = useRef<HTMLDivElement>(null);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const meterRafRef = useRef<number | null>(null);

  /** Tear the meter down. Safe to call when nothing is running. */
  const stopMeter = useCallback(() => {
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    const ctx = meterCtxRef.current;
    meterCtxRef.current = null;
    // `close()` is async and rejects when the context is already closed, which some
    // browsers do on teardown. Swallowed deliberately: a rejected close leaves
    // nothing running and there is nothing to recover.
    void ctx?.close().catch(() => {});
  }, []);

  const startMeter = useCallback(
    (stream: MediaStream) => {
      stopMeter();

      // Only AUDIO tracks feed the meter. Including video would make a moving
      // picture register as "loud", which is not a thing.
      if (stream.getAudioTracks().length === 0) return;

      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      // No WebAudio: the recording still works, only the meter is absent. Refusing
      // to record at all would be a worse answer than a silent-but-working capture.
      if (!Ctor) return;

      const ctx = new Ctor();
      meterCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      // Power of two; 512 is the usual floor that still gives a readable RMS.
      // Smaller flickers too fast to read.
      analyser.fftSize = 512;
      // Takes jitter off without lying about peaks.
      analyser.smoothingTimeConstant = 0.6;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      // Deliberately NOT connected to `ctx.destination`. The analyser needs a
      // source but must not be audible, or recording a voiceover plays it back.

      const buf = new Uint8Array(analyser.fftSize);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);

        // RMS about the 128 midpoint, scaled to 0..1.
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);

        // Perceptual curve. Linear RMS looks dead: normal speech sits near 0.05, so
        // a linear bar is a few pixels wide while somebody is talking.
        const pct = Math.min(100, Math.round(Math.pow(rms, 0.55) * 140));

        const el = levelRef.current;
        if (el) {
          el.style.width = `${pct}%`;
          // Colour by level, so "loud" is legible without reading a number.
          el.style.backgroundColor =
            pct > 82 ? '#f87171' : pct > 45 ? '#fbbf24' : '#4ade80';
        }

        meterRafRef.current = requestAnimationFrame(tick);
      };
      meterRafRef.current = requestAnimationFrame(tick);
    },
    [stopMeter]
  );

  // ============================================================================
  // RELEASING WHAT THIS DIALOG HOLDS
  // ============================================================================
  //
  // ---- WHY THESE ARE TWO FUNCTIONS AND NOT ONE ----
  //
  // They are two because the two callers want opposite things, and one function
  // cannot do both. KEEPING a clip must revoke nothing — the blob URLs go to the
  // timeline and have to stay alive there. DISCARDING must revoke, or a thrown-away
  // take sits in memory for the life of the tab. The old single `teardown` did both
  // at once, and whichever path the user took, the other one was broken: keep left
  // the timeline holding dead URLs, and the umbrella cleanup ran at moments that
  // had nothing to do with unmounting.

  /**
   * Release the hardware. Recording is stopped; recorded blobs are left intact.
   */
  const releaseHardware = useCallback(() => {
    // Meter BEFORE the tracks: closing the AudioContext while its source tracks are
    // still live throws on some browsers.
    stopMeter();

    // Take the recorders out of their refs before stopping them. `stop()` is
    // ASYNCHRONOUS — the final data chunk lands after it returns — so a recorder
    // left in a ref is one a caller would have to re-check, and one that could fire
    // `onstop` against chunks this function is about to discard.
    const cam = recorderRef.current;
    const aud = audioRecorderRef.current;
    recorderRef.current = null;
    audioRecorderRef.current = null;
    if (cam && cam.state !== 'inactive') cam.stop();
    if (aud && aud.state !== 'inactive') aud.stop();

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [stopMeter]);

  /** Release the hardware AND revoke every blob URL this component still owns. */
  const discardClips = useCallback(() => {
    // Invalidate any recording still in flight, so a late `dataavailable` cannot
    // resurrect a clip the user has already thrown away.
    sessionRef.current += 1;
    releaseHardware();

    chunksRef.current = [];
    audioChunksRef.current = [];
    blobRef.current = null;
    audioBlobRef.current = null;

    // Clear the rendered URLs too, not just the refs.
    //
    // `reviewUrl` is state that DRIVES the `<video>`, so nulling `urlRef` alone
    // leaves a revoked blob URL bound to the element. The browser then holds a dead
    // source, and the next recording's preview can render the PREVIOUS clip's last
    // frame — which is the kind of bug that gets reported as "the preview shows the
    // wrong thing" and takes an hour to trace back to here.
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setReviewUrl(null);
    setAudioReviewUrl(null);
  }, [releaseHardware]);

  // ---- WHY THESE EFFECTS HAVE STABLE DEPENDENCIES ----
  //
  // This used to depend on `audioReviewUrl`, which made this teardown a NEW
  // function every time the separate audio track landed. A changing dependency on
  // an unmount-style cleanup means React runs that cleanup mid-life — so the moment
  // the separate track arrived, this revoked the video clip that was being reviewed
  // and "Save to device" went dead while the user was looking straight at it.
  //
  // Both dependencies below are stable, so the cleanup runs when it means to: on
  // unmount, and on close.
  useEffect(() => () => discardClips(), [discardClips]);

  useEffect(() => {
    if (!open) {
      discardClips();
      setState('idle');
      setElapsed(0);
      setError(null);
      // The choice belongs to one take. Carrying it into the next recording is how
      // a deliberately-combined second take silently arrives as two clips.
      setKeepSeparateAudio(false);
      setSavedTo(null);
      setKeptNote(null);
    }
  }, [open, discardClips]);

// ---- THE MIME WE WILL ACTUALLY RECORD WITH ----
//
// Resolved once, in one place, so the capability check and the recorder cannot
  // disagree — they used to be written out separately, and a browser that took the
  // fallback in the check could still be handed the preferred string at record time.
  const pickMime = useCallback((): string | null => {
    if (typeof MediaRecorder === 'undefined') return null;
    const wanted = useCam ? 'video/webm;codecs=vp9,opus' : 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported(wanted)) return wanted;
    const alt = useCam ? 'video/webm' : 'audio/webm';
    return MediaRecorder.isTypeSupported(alt) ? alt : null;
  }, [useCam]);

  /**
   * OPEN THE DEVICES AND SHOW WHAT THEY ARE SENDING. This does not record.
   *
   * Selecting a device and starting the recording were the same button, which
   * meant the recording began the instant a choice was picked — before the
   * preview had appeared and before anyone could tell whether the phone they
   * selected was the phone actually being captured. A phone over USB needs a
   * moment to wake its camera, and that moment was being recorded.
   *
   * So the two are separate now. This step opens the stream, starts the level
   * meters, and shows the live picture, which is the only way to answer "is this
   * the right camera?" before it matters. Recording waits for the next button.
   *
   * `camId` and `micId` are dependencies here, and were not before: the old
   * `start` read both from its closure without listing them, so it kept the ids
   * captured when the callback was created. Choosing a different camera in the
   * dropdown could therefore record through the previously selected one while the
   * preview showed the new one.
   */
  const arm = useCallback(async () => {
    setError(null);
    setSavedTo(null);
    setKeptNote(null);

    // ---- Check BEFORE asking for the stream, not after ----
    //
    // The old order was:
    //
    //     const stream = await getUserMedia(…);
    //     if (!useCam && !useMic) { setError(…); setState('idle'); return; }
    //
    // which is two bugs in three lines. The prompt appeared and the camera light
    // came on before anything decided it was not wanted — and the early `return`
    // never stopped the tracks, so the device stayed OPEN. The browser's recording
    // indicator stayed lit, and the next attempt failed with "device in use",
    // which reads as "recording is broken" and is actually "the previous attempt
    // leaked a stream".
    //
    // One guard, before the prompt. There is no way to reach the broken state.
    if (!useCam && !useMic) {
      setError('Turn on the camera, the microphone, or both.');
      setState('idle');
      return;
    }

    // Gated before the prompt rather than after, so an incapable browser is told
    // before it asks for a camera it was never going to use.
    const mime = pickMime();
    if (!mime) {
      setError('This browser cannot record WebM. Chrome, Edge and Firefox can.');
      setState('idle');
      return;
    }

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

      streamRef.current = stream;

      // ---- Live level metering, for BOTH tracks ----
      //
      // This was missing entirely, and its absence is why voice recording looked
      // dead. With the camera off, the preview element is a `<video>` with no video
      // track, so it renders a black box and shows nothing at all: no movement, no
      // waveform, no confirmation the microphone is live. A user recording a
      // voiceover had no possible way to tell a working microphone from a dead one.
      //
      // An `AnalyserNode` on the live stream fixes that for audio-only, and also
      // gives the video case a real input-level read, so a plugged-in mic that is
      // muted is visible instead of silent.
      startMeter(stream);

      if (camPreviewRef.current) {
        camPreviewRef.current.srcObject = stream;
        await camPreviewRef.current.play().catch(() => {});
      }

      // Armed, not recording. The user now verifies the picture and the levels,
      // and presses the button that actually starts the take.
      setState('ready');
    } catch (e) {
      const err = e as DOMException;
      setError(
        err.name === 'NotAllowedError'
          ? 'Permission denied. Allow camera and microphone in the browser address bar, then try again.'
          : err.name === 'NotFoundError'
            ? 'No camera or microphone found on this machine.'
            : err.message || 'Could not open the camera or microphone.'
      );
      setState('idle');
      discardClips();
    }
  }, [useCam, useMic, camId, micId, pickMime, startMeter, discardClips]);

  /**
   * Put the device pickers away and open the preview, discarding the armed stream
   * if there is one.
   */
  const changeDevices = useCallback(() => {
    cancelAutoClose();
    // Releases the camera and microphone that the preview was holding open.
    discardClips();
    setState('idle');
  }, [discardClips, cancelAutoClose]);

  /**
   * Record. Only reachable once the chosen devices are open and on screen.
   *
   * Nothing is requested here and nothing is negotiated: the stream was opened by
   * `arm` and is already live. All this does is attach recorders to it, which is
   * why the gap the user reported — choosing a device and watching it record
   * before the picture arrived — cannot happen any more.
   */
  const start = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      setError('Choose your camera and microphone first.');
      setState('idle');
      return;
    }
    const mime = pickMime();
    if (!mime) {
      setError('This browser cannot record WebM. Chrome, Edge and Firefox can.');
      changeDevices();
      return;
    }

    setError(null);
    setSavedTo(null);
    setKeptNote(null);
    // A fresh take is a fresh decision: the previous take's separate/combined
    // choice does not carry over.
    setKeepSeparateAudio(false);
    // Identifies THIS take. Any `dataavailable` that lands after the user has
    // discarded it and moved on belongs to a recording they no longer want.
    const session = sessionRef.current + 1;
    sessionRef.current = session;

    try {
      recorderRef.current = new MediaRecorder(stream, { mimeType: mime });
      mimeRef.current = recorderRef.current.mimeType || mime;

      chunksRef.current = [];
      recorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // ---- THE SECOND RECORDER: audio only, running in PARALLEL ----
      //
      // Why it exists: the user wants BOTH options — one combined clip, or the
      // video and the audio as separate clips — and a single `MediaRecorder` bound to
      // a stream carrying both tracks can only ever produce one file.
      //
      // WHY A SECOND RECORDER AND NOT SPLITTING THE FILE LATER
      //
      // Because splitting a finished WebM means re-encoding it, and there is no
      // browser API that does that without a full codec pipeline — `MediaRecorder`
      // records, it does not transcode. Recording the audio separately at the source
      // is not a workaround; it is the only version that actually works with what a
      // browser gives you.
      //
      // It costs one extra recorder writing to memory for the length of the
      // recording, and it only runs when the camera is ON — an audio-only recording
      // already IS the separate version, so a second recorder there would be
      // recording the same microphone twice.
      audioRecorderRef.current = null;
      // Always record audio separately when both camera and mic are on.
      // The checkbox at review time just decides whether to USE it.
      if (useCam && useMic) {
        try {
          // `clone()` gives an independent stream over the SAME underlying source,
          // so this does not open the microphone a second time and does not make
          // the user grant permission twice.
          const audioOnly = new MediaStream(stream.getAudioTracks());
          const altMime =
            typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
              ? 'audio/webm'
              : '';
          const rec = altMime
            ? new MediaRecorder(audioOnly, { mimeType: altMime })
            : new MediaRecorder(audioOnly);
          audioChunksRef.current = [];
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          rec.onstop = () => {
            // A late chunk from a take the user has already discarded.
            if (sessionRef.current !== session) return;
            const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            if (blob.size === 0) return; // Nothing separate to offer. Not an error.
            audioBlobRef.current = blob;
            const url = URL.createObjectURL(blob);
            audioUrlRef.current = url;
            setAudioReviewUrl(url);
          };
          rec.start(250);
          audioRecorderRef.current = rec;
        } catch {
          // A second recorder failing must NOT lose the primary one. The combined
          // clip is the default path and it still works; the user simply gets one
          // clip instead of two, with no error to explain a missing option.
          audioRecorderRef.current = null;
        }
      }

      // ---- `onstop` is where the blob must be built ----
      //
      // `MediaRecorder` fires this AFTER the final `dataavailable`, which is the
      // only moment `chunksRef.current` is complete. Building it in the click
      // handler instead — which is what this code used to do — produces a zero-byte
      // blob, because the array is still empty at that point.
      //
      // This is also why the recording looked fine and only the SAVE was broken:
      // recording writes into the buffer over time and needs nothing from this
      // handler, so it completes normally. Only the final assembly was premature.
      recorderRef.current.onstop = () => {
        // A late chunk from a take the user has already discarded or replaced.
        if (sessionRef.current !== session) return;

        // From `mimeRef`, not off the recorder: teardown may already have cleared
        // the ref by the time this asynchronous handler runs.
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });

        // A zero-length recording is a real outcome, not a hypothetical: a user who
        // presses stop immediately, or a browser that discards a too-short stream,
        // both produce this. Saying so is the difference between "the app is broken"
        // and "you recorded for no time".
        if (blob.size === 0) {
          setError('Nothing was recorded. Hold the record button long enough to capture something.');
          setState('idle');
          discardClips();
          return;
        }

        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setReviewUrl(url);
        setState('review');
      };

      recorderRef.current.start(250); // timeslice, so a crash keeps partial audio
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start recording.');
      changeDevices();
    }
  }, [useCam, useMic, pickMime, changeDevices, discardClips]);

  const stop = useCallback(() => {
    // ---- The blob is NOT built here any more ----
    //
    // It WAS, and that is why "save" produced no preview. `MediaRecorder.stop()`
    // is ASYNCHRONOUS: the final `dataavailable` fires AFTER `stop()` returns.
    // So this function read `chunksRef.current` while it was still EMPTY, built
    // `new Blob([], ...)`, and handed the review step a zero-byte blob — which
    // renders as a video element with no picture and no error.
    //
    // The recording itself was fine. The indicator was fine. Only the SAVE was
    // broken, which is exactly what was reported: "record hoti hai, save par
    // preview nahi aata."
    //
    // The blob is now assembled in `onstop`, which the recorder fires after the
    // last chunk has landed. See `onstop` below.
    //
    // ---- BOTH recorders, or the second one records forever ----
    //
    // This line was missing for the audio-only recorder, and it is the whole reason
    // the separate-clip option was unusable. A `MediaRecorder` that is never
    // stopped never fires `onstop`, so the separate audio track was never
    // assembled — no separate clip existed, the review's "keep as a separate clip"
    // checkbox was therefore disabled, and the option could not be selected at all.
    //
    // It stayed open for the rest of the tab's life, holding a reference to a
    // microphone the user believed they had released.
    recorderRef.current?.stop();
    audioRecorderRef.current?.stop();

    // Release the hardware now rather than after the review, so the camera light
    // goes off the moment recording ends. Unchanged and still correct.
    //
    // The recorders are NOT nulled here: their `onstop` handlers have not run yet
    // and still need their chunk arrays. Only the tracks are released.
    //
    // Meter BEFORE the tracks: closing the AudioContext while its source tracks are
    // still live throws on some browsers.
    stopMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    setState('review');
  }, [stopMeter]);

  const keep = useCallback(() => {
    if (!urlRef.current) return;
    const secs = (Math.max(0, Date.now() - startedAtRef.current)) / 1000;
    const stamp = new Date().toLocaleTimeString();

    // ---- ONE clip or TWO, per the user's choice at review ----
    //
    // The combined path is one file carrying both tracks, and the separate path is
    // the video-only stream plus the audio-only stream the parallel recorder
    // captured from the same source.
    //
    // NOTHING IS REVOKED ON THIS PATH, and that is a deliberate change. Ownership
    // of these blob URLs passes to the caller along with the clips: revoking them
    // here left the timeline holding URLs that were already dead, so a kept
    // recording showed a thumbnail and then played nothing.
    //
    // What is handed over is the BLOB. The media store mints its own URL from it,
    // registers that URL for revocation, and keeps the bytes so the clip can be
    // written to IndexedDB and reopened later. Nothing here needs to outlive the
    // dialog.
    const items: Array<{ name: string; kind: 'video' | 'audio'; blob: Blob; duration: number }> = [];

    if (keepSeparateAudio && audioReviewUrl && audioBlobRef.current && blobRef.current) {
      // Separate mode: hand over the VIDEO-ONLY file too, so dropping the audio
      // clip on the timeline does not double the voice that is already in it.
      //
      // The primary recorder's stream carried both tracks, so `blobRef` is NOT
      // video-only. Passing it as `kind: 'video'` would put the original
      // microphone back on the timeline, which is precisely the problem separate
      // mode exists to solve.
      //
      // When the user asked for separate and we only have the combined file (the
      // second recorder failed, or the browser refused), we fall through to the
      // combined clip rather than handing over a video that is not video-only.
      items.push({
        name: `Camera ${stamp}`,
        kind: 'video',
        blob: blobRef.current,
        duration: secs,
      });
      items.push({
        name: `Voiceover ${stamp}`,
        kind: 'audio',
        blob: audioBlobRef.current,
        duration: secs,
      });
    } else {
      items.push({
        name: `Recording ${stamp}`,
        kind: useCam ? 'video' : 'audio',
        // Non-null: `keep()` is unreachable until `urlRef` is set, and this is the
        // blob that URL was made from. Asserted rather than guarded so a future
        // change cannot quietly hand over `undefined`.
        blob: blobRef.current as Blob,
        duration: secs,
      });
    }

    onKeep(items);

    // Hardware only. The blobs themselves are NOT revoked — they were just handed
    // over, and the caller holds them.
    //
    // The URLs made from them are released here rather than left to the close
    // handler, because the caller's URL is now a different one: revoking them here
    // makes it obvious that this component kept nothing.
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    blobRef.current = null;
    audioBlobRef.current = null;
    setReviewUrl(null);
    setAudioReviewUrl(null);
    setKeptNote(
      items.length === 1
        ? `“${items[0].name.replace(/^\\S+\\s/, '')}” added to your library`
        : `${items.length} clips added to your library`
    );
    setSavedTo(null);
    releaseHardware();
    setState('idle');

    // ---- CLOSE OURSELVES IN A BEAT, RATHER THAN SNAPPING SHUT ----
    //
    // This used to call `onClose()` immediately, which meant the confirmation the
    // user had just triggered was never seen: the dialog vanished in the same
    // tick that produced it. A short, visible delay gives the hand-off something
    // to confirm, and hands the user straight back to the editor.
    cancelAutoClose();
    autoCloseRef.current = window.setTimeout(() => {
      autoCloseRef.current = null;
      onClose();
    }, AUTO_CLOSE_MS);
  }, [onKeep, useCam, releaseHardware, cancelAutoClose, keepSeparateAudio, audioReviewUrl]);

  const discard = useCallback(() => {
    discardClips();
    setElapsed(0);
    setState('idle');
  }, [discardClips]);

  /**
   * Put the clip on the user's disk, asking WHERE first.
   *
   * A plain `<a download>` cannot do that. It downloads straight into the browser's
   * default folder with no dialog at all, so the user is told the clip was saved and
   * has no idea where it went — and with several takes recorded, no way to find the
   * one they wanted.
   *
   * `showSaveFilePicker` is the browser's own "Save as" dialog: it lets the user
   * choose the folder, the filename and the format, and it reports back the real
   * destination so the confirmation can name it. Firefox and Safari do not have it,
   * so the anchor download stays as the fallback there — same behaviour they had
   * before, rather than a button that does nothing.
   */
  const saveToDevice = useCallback(async (target: 'clip' | 'voiceover' = 'clip') => {
    // ---- WHICH FILE, AND WHY THE COMPLETE ONE IS THE DEFAULT ----
    //
    // `clip` is the primary recorder's blob, which carries BOTH tracks: the camera
    // and the microphone, in one file. That is the recording, and it is what
    // "save this clip" has to mean.
    //
    // The separate voiceover is a SECOND file and is offered as such. Treating it
    // as the default was the wrong answer to a real question: someone who asks to
    // save a take they just watched play, with its sound, does not expect to be
    // handed the bare soundtrack instead.
    const blob = target === 'voiceover' ? audioBlobRef.current : blobRef.current;
    if (!blob) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const label = target === 'voiceover' ? 'voiceover' : 'recording';

    // ---- WHY THE MIME TYPE IS NORMALISED ----
    //
    // `blob.type` here is whatever `MediaRecorder` reported, and that is a FULL
    // type string with codec parameters: `video/webm;codecs=vp9,opus`.
    //
    // The File System Access API validates the keys of `accept` and rejects
    // anything that is not a bare `type/subtype`, so passing the recorded type
    // straight through makes the picker throw a `TypeError` before the dialog is
    // ever shown — and the catch below then quietly falls back to a plain
    // download, which is the exact behaviour this button exists to replace.
    //
    // The parameters are dropped, and the extension is derived from what is left,
    // so an `x-matroska` recording is not saved wearing a `.webm` name.
    const mime = (blob.type || 'video/webm').split(';')[0].trim().toLowerCase() || 'video/webm';
    const subtype = mime.split('/')[1] || 'webm';
    const ext = subtype === 'x-matroska' ? 'mkv' : subtype;
    const filename = `wideo11-${label}-${stamp}.${ext}`;

    const picker = (window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName?: string;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{
        name: string;
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }).showSaveFilePicker;

    if (typeof picker === 'function') {
      try {
        // Called FIRST, with no `await` in front of it. The picker requires a live
        // user gesture; awaiting anything first spends it, and the browser rejects
        // the call with "not allowed" before the dialog ever appears.
        const handle = await picker({
          suggestedName: filename,
          types: [
            {
              description: mime.startsWith('audio/') ? `Audio (${subtype.toUpperCase()})` : `Video (${subtype.toUpperCase()})`,
              accept: { [mime]: [`.${ext}`] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setSavedTo(handle.name || filename);
        return;
      } catch (e) {
        // The user closed the dialog. That is an answer, not a failure.
        if ((e as DOMException)?.name === 'AbortError') return;
        // Anything else (a denied permission, a locked file) falls back to the
        // plain download, which needs no permission the user can withhold.
      }
    }

    const a = document.createElement('a');
    // The blob's own URL for the voiceover, the reviewed clip's for the clip —
    // whichever was asked for. A live URL is reused rather than minted a second
    // time for one file.
    a.href = (target === 'voiceover' ? audioUrlRef.current : urlRef.current) ?? URL.createObjectURL(blob);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSavedTo('your downloads folder');
  }, []);

  if (!open) return null;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');

  const card = 'rounded border border-edge bg-surface-raised p-4';

  return (
    // ---- WHY THE OVERLAY SCROLLS ----
    //
    // It used to be `flex items-center` on a `fixed inset-0` overlay with no
    // overflow, which centres the panel and then CLIPS whatever does not fit: on a
    // laptop viewport the top of the preview and the entire button row sit below the
    // fold, off-screen and unscrollable, because the overlay itself is the scroll
    // container and it was told not to scroll.
    //
    // That is why "Save to device" and "Keep to timeline" read as missing and the
    // checkbox could not be clicked: they were not disabled, they were off the
    // bottom of the window. Scrolling the overlay, and centring the panel inside a
    // full-height flex box, keeps it centred when it fits and reachable when it
    // does not.
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-surface/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record camera or microphone"
    >
      <div className="flex min-h-full items-center justify-center">
        <div className="w-full max-w-lg space-y-3 rounded-lg border border-edge-strong bg-surface-raised p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold text-white">Record</h2>
          <button
            type="button"
// `requestClose`, not `onClose`: closing by hand has to cancel the pending
              // auto-close too, or a timer fires afterwards at a dialog that is no
              // longer there.
              onClick={() => (state === 'recording' ? stop() : requestClose())}
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

        {/* ---- Live preview: while arming, while armed, and while recording ----
            All three, because this panel is the only place the user can confirm
            the device they picked is the device being captured. */}
        {(state === 'requesting' || state === 'ready' || state === 'recording') && (
          <div className="space-y-2">
            {/* ---- The camera panel, ONLY when there is a camera ----
                With the camera off this was a `<video>` with no video track, so it
                rendered a black box about 16:9 tall and told the user nothing. For a
                voice-only recording that IS the whole preview, which is why
                "recording shows no preview" was reported against what is otherwise
                a working feature. */}
            {useCam ? (
              <video
                ref={camPreviewRef}
                muted
                playsInline
                className="aspect-video w-full rounded bg-black object-contain"
              />
            ) : (
              /* Audio-only: a large live level bar instead of a black rectangle.
                 This is the feedback that was missing entirely. */
              <div className="flex h-24 flex-col items-center justify-center gap-3 rounded bg-black">
                <Mic className="h-6 w-6 text-gray-600" aria-hidden="true" />
                <span className="text-[10px] uppercase tracking-widest text-gray-500">
                  Microphone only
                </span>
              </div>
            )}

            {/* ---- The level meter. Always rendered when the mic is on, camera or
                not, because it answers the question the picture cannot: is anything
                actually coming in? */}
            {useMic && (
              <div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
                  <div
                    ref={levelRef}
                    className="h-full rounded-full transition-[width] duration-75 ease-out"
                    style={{ width: '0%', backgroundColor: '#4ade80' }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-gray-600">
                  <span>Input level</span>
                  <span>Speak to confirm the microphone works</span>
                </div>
              </div>
            )}

            {/* ---- ARMED: the take has not started yet ----
                This is the button the whole split exists for. The picture above is
                live, the meter above is live, and nothing has been recorded — so
                "start" is a decision made after the fact rather than a side effect
                of picking a device. */}
            {state === 'ready' && (
              <div className="space-y-2 rounded border border-edge-strong bg-surface-overlay/40 p-2.5">
                {/* ---- NAME WHAT IS ACTUALLY OPEN ----
                    A picture alone does not identify a device: two phones produce
                    two pictures, and a preview that looks fine is not evidence that
                    it is the *right* one. The browser's own device names are already
                    in hand from the enumeration pass, so the armed step says what it
                    opened rather than asking the user to infer it. */}
                <div className="space-y-0.5 text-[8px] leading-snug">
                  <p className="font-medium text-fg">Now open, ready to record</p>
                  <ul className="space-y-0.5 text-fg-secondary">
                    {useCam && (
                      <li>
                        Camera: {cams.find((c) => c.deviceId === camId)?.label || 'the default camera'}
                      </li>
                    )}
                    {useMic && (
                      <li>
                        Microphone: {mics.find((m) => m.deviceId === micId)?.label || 'the default microphone'}
                      </li>
                    )}
                  </ul>
                </div>
                <p className="text-[8px] leading-snug text-fg-secondary">
                  Check the picture and the input level above are what you want — nothing has
                  been recorded yet.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={start}
                    className="flex flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-3 py-2 text-[8px] font-medium text-white hover:bg-red-500"
                  >
                    <Circle className="h-2 w-2 fill-current" /> Start recording
                  </button>
                  <button
                    type="button"
                    onClick={changeDevices}
                    className="flex items-center justify-center gap-2 rounded-md border border-edge-strong px-3 py-2 text-[8px] text-fg-muted hover:bg-surface-overlay hover:text-fg"
                  >
                    <RotateCcw className="h-2 w-2" /> Change devices
                  </button>
                </div>
              </div>
            )}

            {state === 'recording' && (
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
            )}
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
              // `src` from STATE, set in `onstop`. This is the fix for "save par
              // preview nahi aata": the old code assigned `reviewRef.current.src`
              // synchronously after `setState('review')`, at which point React had
              // not re-rendered and the ref was still null — so the video rendered
              // with no source and no error.
              src={reviewUrl ?? undefined}
              controls
              playsInline
              // A recorded clip is usually audio-only or video-only, so a fixed
              // 16:9 box letterboxes a portrait phone recording into a thin strip.
              // `object-contain` keeps it whole rather than cropping it.
              className="max-h-64 w-full rounded bg-black object-contain"
            />
            {/*
              THE COMBINED / SEPARATE CHOICE.

              Default is COMBINED, and the default is the point: one file that drops
              onto the timeline and plays is what almost everybody wants, so the
              option they have to reach for is the one that costs them an edit.

              ---- WHY IT IS SHOWN ON `useCam && useMic` AND NOT ON `audioReviewUrl` ----

              The first version gated it on the separate audio having ARRIVED. That
              is a race: the audio recorder's `onstop` is asynchronous, so for a
              moment after pressing stop the review screen rendered with no checkbox
              at all, and the option appeared a beat later — or not at all, if the
              audio blob came back empty.

              An option that blinks in and out is worse than one that is always
              there, because the user has already decided by the time it vanishes.

              So the TOGGLE is always present when there is something to separate,
              and the RECORD is what may be unavailable.

              ---- AND WHY IT IS NEVER `disabled` ----

              It WAS `disabled={!audioReviewUrl}`, which reads as the sane choice
              and was the exact reason this option could never be used: the
              separate track is assembled asynchronously, so for the first moments
              of the review the checkbox was on screen and refused to take a click.
              A control the user can see and cannot operate is worse than one that
              admits it is not ready, because there is no way to tell which of the
              two they are looking at.

              It is always selectable. `keep()` falls back to the combined clip if
              the separate audio turns out not to exist, so ticking the box cannot
              produce a broken result - the tick is a request, not a promise, and
              the label beside it says which of the two is currently in play.
            */}
            {useCam && useMic ? (
              <label
                className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-[9px] ${
                  audioReviewUrl
                    ? 'cursor-pointer border-edge bg-surface-overlay/40 text-fg-secondary'
                    : 'cursor-pointer border-dashed border-edge/60 bg-surface-overlay/20 text-fg-muted'
                }`}
              >
                <input
                  type="checkbox"
                  checked={keepSeparateAudio}
                  onChange={(e) => setKeepSeparateAudio(e.target.checked)}
                  className="h-3 w-3 accent-sky-500"
                />
                Keep the voiceover as a{' '}
                <strong className="mx-0.5 text-fg">separate clip</strong>
                {audioReviewUrl ? (
                  <span className="text-fg-muted">
                    — for replacing the audio on a camera take you keep
                  </span>
                ) : (
                  <span className="text-fg-muted">
                    — separate audio track being prepared…
                  </span>
                )}
              </label>
            ) : null}

            <div className="flex gap-2">
              {/*
                SAVE TO DEVICE.

                The recording lives in memory as a blob URL, which dies with the tab.
                A user who records a voiceover, closes the dialog and reloads has lost
                it — and "did you want to keep it?" is a worse experience than a
                download button they never needed.

                `download` rather than a server upload: this is a LOCAL capture with
                no account, no per-minute cost and no storage quota, and routing it
                through the platform would make a 40-second voice note wait on a
                network round trip. Same reasoning as the header comment above.

                ---- WHY THIS IS A `<button>` AND NOT AN `<a download>` ----

                The anchor downloaded silently into the browser's default folder,
                with no dialog and no way to choose where the clip went. That is the
                behaviour people mean by "save to device button kaam nahi karta": the
                file does arrive, somewhere they did not pick, and after a few takes
                there is no telling which is which. `saveToDevice` opens the
                browser's own Save As dialog instead, and falls back to the download
                only where that dialog does not exist.

                ---- WHY `text-fg`, NOT `text-fg-primary` ----

                `fg-primary` is not a token this app defines — the palette is `fg`,
                `fg-secondary`, `fg-muted`. Tailwind therefore emitted no colour
                class at all, the label inherited the page's default black, and on a
                dark panel the button read as broken rather than as clickable. The
                measurement is in the commit that introduced this: computed colour
                `rgb(0, 0, 0)` on a `#0b1220`-ish surface.

                Only enabled when the blob is actually in hand. Gated on `reviewUrl`,
                // which is STATE, rather than on the ref that holds the blob: a ref
                // changing does not re-render, so a button disabled from a ref can
                // disagree with the screen it is drawn on — which is exactly how a
                // control ends up looking dead while still working.
              */}
              <button
                type="button"
                onClick={() => void saveToDevice('clip')}
                disabled={!reviewUrl}
                title={
                  reviewUrl
                    ? 'Save the complete clip — picture and sound together'
                    : 'Recording not ready yet'
                }
                className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded border text-[10px] font-medium transition-colors ${
                  reviewUrl
                    ? 'border-edge bg-surface-overlay text-fg hover:bg-surface-raised'
                    : 'cursor-not-allowed border-edge/50 bg-surface-overlay/40 text-fg-muted opacity-50'
                }`}
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                Save to device
              </button>
              {/* The second file, offered as a second file rather than as the default. */}
              {audioReviewUrl && (
                <button
                  type="button"
                  onClick={() => void saveToDevice('voiceover')}
                  title="Save the separate voiceover track on its own (audio only)"
                  className="flex h-8 items-center justify-center gap-1 rounded border border-edge/50 px-2 text-[9px] text-fg-secondary transition-colors hover:bg-surface-overlay hover:text-fg"
                >
                  <Download className="h-2.5 w-2.5" aria-hidden="true" />
                  Voiceover only
                </button>
              )}
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
                title="File this take in the media library. Click its tile to drop it on the timeline."
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-[8px] font-medium text-white hover:bg-sky-500"
              >
                <Check className="h-2 w-2" /> Add to library
              </button>
            </div>

            {savedTo && (
              <p role="status" className="flex items-center gap-1.5 text-[8px] text-emerald-400">
                <Check className="h-2 w-2 shrink-0" aria-hidden="true" />
                Saved to {savedTo}
              </p>
            )}
          </div>
        )}

        {state === 'idle' && (
          <>
            {/* The hand-off confirmation. The dialog closes itself a moment after
                this appears, so it is also the last thing the user reads. */}
            {keptNote && (
              <p role="status" className="flex items-center justify-center gap-1.5 text-[9px] text-emerald-400">
                <Check className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                {keptNote}
              </p>
            )}
            {/* NOT "Start recording".
                This opens the camera and microphone and shows what they are
                sending — nothing more. It used to start the take as well, which
                meant choosing a device was the same act as recording: the preview
                had not appeared yet, a phone's camera had not woken up, and the
                first moments of a take were spent waiting for hardware rather than
                on the thing being filmed.
                Recording is the next button, once the preview can be believed. */}
            <button
              type="button"
              onClick={() => void arm()}
              title="Open the selected camera and microphone so you can check them before recording"
              className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-3 py-2.5 text-[8px] font-medium text-white hover:bg-sky-500"
            >
              <Camera className="h-2 w-2" /> Use these devices
            </button>
          </>
        )}

        <p className="border-t border-edge pt-2 text-[8px] leading-snug text-fg-muted">
          Everything here runs in your browser. Nothing is uploaded, so there is no
          service, no account and nothing to pay for.
        </p>
        </div>
      </div>
    </div>
  );
}
