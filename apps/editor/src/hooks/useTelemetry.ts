import { useEffect, useRef, useState } from 'react';

type TelemetryEvent = {
  type: 'mousemove' | 'visibilitychange' | 'watchduration';
  x?: number;
  y?: number;
  timestamp: number;
  visibilityState?: VisibilityState;
  duration?: number; // seconds of engagement
};

type UseTelemetryReturn = {
  start: () => void;
  stop: () => void;
};

export const useTelemetry = (userId: number): UseTelemetryReturn => {
  const [isTracking, setIsTracking] = useState(false);
  const eventsRef = useRef<TelemetryEvent[]>([]);
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastWatchStartRef = useRef<number | null>(null); // timestamp when user started watching
  const visibilityStateRef = useRef<VisibilityState>(document.visibilityState);

  // Send events to backend
  const sendEvents = useCallback(async () => {
    if (eventsRef.current.length === 0) return;
    const eventsToSend = [...eventsRef.current];
    eventsRef.current = []; // Clear buffer

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/api/telemetry`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId,
            events: eventsToSend,
          }),
        }
      );

      if (!response.ok) {
        console.warn('Failed to send telemetry events:', response.status);
        // Re-buffer the events to retry later? For simplicity, we drop them.
        // In production, you might want to implement retry with backoff.
      }
    } catch (error) {
      console.error('Error sending telemetry events:', error);
      // Re-buffer events
      eventsRef.current = [...eventsToSend, ...eventsRef.current];
    }
  }, [userId]);

  // Start periodic sending
  const startSending = useCallback(() => {
    if (sendIntervalRef.current) return;
    sendIntervalRef.current = setInterval(() => {
      sendEvents();
    }, 5000); // Send every 5 seconds
  }, [sendEvents]);

  // Stop periodic sending
  const stopSending = useCallback(() => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
    // Send any remaining events
    sendEvents();
  }, [sendEvents]);

  // Handle mousemove
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isTracking) return;
    eventsRef.current.push({
      type: 'mousemove',
      x: e.clientX,
      y: e.clientY,
      timestamp: Date.now(),
    });
    // If buffer gets too large, send early to avoid memory issues
    if (eventsRef.current.length > 100) {
      sendEvents();
    }
  }, [isTracking, sendEvents]);

  // Handle visibility change
  const handleVisibilityChange = useCallback(() => {
    if (!isTracking) return;
    const now = Date.now();
    const newState = document.visibilityState;
    eventsRef.current.push({
      type: 'visibilitychange',
      visibilityState: newState,
      timestamp: now,
    });

    // If page becomes hidden, we consider a watch session ended
    if (newState === 'hidden' && visibilityStateRef.current === 'visible') {
      if (lastWatchStartRef.current !== null) {
        const durationSeconds = (now - lastWatchStartRef.current) / 1000;
        eventsRef.current.push({
          type: 'watchduration',
          timestamp: now,
          duration: durationSeconds,
        });
        lastWatchStartRef.current = null;
      }
    }
    // If page becomes visible, start a new watch session
    if (newState === 'visible' && visibilityStateRef.current === 'hidden') {
      lastWatchStartRef.current = now;
    }

    visibilityStateRef.current = newState;
  }, [isTracking]);

  // Start tracking
  const start = useCallback(() => {
    if (isTracking) return;
    setIsTracking(true);
    // Reset last watch start when becoming visible
    if (document.visibilityState === 'visible') {
      lastWatchStartRef.current = Date.now();
    } else {
      lastWatchStartRef.current = null;
    }
    visibilityStateRef.current = document.visibilityState;

    // Add event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Start sending interval
    startSending();
  }, [isTracking, handleMouseMove, handleVisibilityChange, startSending]);

  // Stop tracking
  const stop = useCallback(() => {
    if (!isTracking) return;
    setIsTracking(false);
    // Remove event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    // Stop sending interval and flush events
    stopSending();
  }, [isTracking, handleMouseMove, handleVisibilityChange, stopSending]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { start, stop };
};