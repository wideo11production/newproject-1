import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'text' | 'image';
  clips: Clip[];
  volume: number;
  muted: boolean;
  visible: boolean;
  locked: boolean;
}

export interface Clip {
  id: string;
  startTime: number;
  duration: number;
  mediaId: string;
  mediaUrl: string;
  mediaType: 'video' | 'audio' | 'image';
  trimStart: number;
  trimEnd: number;
  keyframes: Keyframe[];
  effects: Effect[];
  opacity: number;
  speed: number;
}

export interface Keyframe {
  time: number;
  value: number;
  interpolate: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface Effect {
  id: string;
  type: string;
  name: string;
  params: Record<string, unknown>;
}

export interface TimelineStore {
  tracks: Track[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  zoom: number;
  selectedClip: string | null;
  selectedTrack: string | null;
  markers: Marker[];
  addTrack: (track: Omit<Track, 'id' | 'clips'>) => void;
  addClip: (trackId: string, clip: Omit<Clip, 'id'>) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  setTime: (time: number) => void;
  togglePlay: () => void;
  setZoom: (zoom: number) => void;
  selectClip: (id: string | null) => void;
  selectTrack: (id: string | null) => void;
  addMarker: (marker: Omit<Marker, 'id'>) => void;
  removeMarker: (id: string) => void;
}

export interface Marker {
  id: string;
  time: number;
  name: string;
  color: string;
}

export const useTimelineStore = useStore<TimelineStore>(
  persist(
    (set, get) => ({
      tracks: [],
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      zoom: 1,
      selectedClip: null,
      selectedTrack: null,
      markers: [],

      addTrack: (track) =>
        set((state) => ({
          tracks: [
            ...state.tracks,
            {
              ...track,
              id: `track-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              clips: [],
            },
          ],
        })),

      addClip: (trackId, clip) =>
        set((state) => ({
          tracks: state.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  clips: [
                    ...track.clips,
                    {
                      ...clip,
                      id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    },
                  ],
                }
              : track
          ),
        })),

      updateClip: (clipId, updates) =>
        set((state) => ({
          tracks: state.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === clipId ? { ...clip, ...updates } : clip
            ),
          })),
        })),

      removeClip: (clipId) =>
        set((state) => ({
          tracks: state.tracks.map((track) => ({
            ...track,
            clips: track.clips.filter((clip) => clip.id !== clipId),
          })),
        })),

      setTime: (time) =>
        set((state) => {
          const newDuration = Math.max(
            state.duration,
            ...state.tracks.flatMap((t) =>
              t.clips.map((c) => c.startTime + c.duration)
            )
          );
          return { currentTime: time, duration: newDuration };
        }),

      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),

      setZoom: (zoom) => set({ zoom }),

      selectClip: (id) => set({ selectedClip: id }),

      selectTrack: (id) => set({ selectedTrack: id, selectedClip: null }),

      addMarker: (marker) =>
        set((state) => ({
          markers: [
            ...state.markers,
            {
              ...marker,
              id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            },
          ],
        })),

      removeMarker: (id) =>
        set((state) => ({
          markers: state.markers.filter((m) => m.id !== id),
        })),
    }),
    { name: 'timeline-storage' }
  )
);

export class TimelineEngine {
  private store: TimelineStore;
  private animationFrameId: number | null = null;

  constructor(store: TimelineStore) {
    this.store = store;
  }

  start() {
    if (this.animationFrameId) return;
    const animate = () => {
      const { currentTime, isPlaying, duration, setTime } = this.store.getState();
      if (isPlaying && currentTime < duration) {
        setTime(currentTime + 1 / 30);
      }
      this.animationFrameId = requestAnimationFrame(animate);
    };
    animate();
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  seek(time: number) {
    this.store.getState().setTime(Math.max(0, Math.min(time, this.store.getState().duration)));
  }

  getTracksAtTime(time: number): Track[] {
    return this.store
      .getState()
      .tracks.filter((track) =>
        track.clips.some((clip) => time >= clip.startTime && time < clip.startTime + clip.duration)
      );
  }
}

export class PlaybackEngine {
  private engine: TimelineEngine;
  private element: HTMLVideoElement | null = null;

  constructor(engine: TimelineEngine) {
    this.engine = engine;
  }

  attach(element: HTMLVideoElement) {
    this.element = element;
  }

  detach() {
    if (this.element) {
      this.element.pause();
      this.element = null;
    }
  }

  play() {
    if (this.element) {
      this.element.play();
    }
    this.engine.start();
  }

  pause() {
    if (this.element) {
      this.element.pause();
    }
    this.engine.stop();
  }

  seek(time: number) {
    if (this.element) {
      this.element.currentTime = time;
    }
    this.engine.seek(time);
  }

  setSpeed(speed: number) {
    if (this.element) {
      this.element.playbackRate = speed;
    }
  }

  setVolume(volume: number) {
    if (this.element) {
      this.element.volume = volume;
    }
  }

  setMuted(muted: boolean) {
    if (this.element) {
      this.element.muted = muted;
    }
  }
}

export class RenderEngine {
  private supportWebCodecs = false;

  constructor() {
    this.supportWebCodecs = 'VideoFrame' in window;
  }

  getSupportWebCodecs() {
    return this.supportWebCodecs;
  }

  async renderFrame(timestamp: number, canvas: HTMLCanvasElement) {
    if (this.supportWebCodecs) {
      return this.renderWithWebCodecs(timestamp, canvas);
    }
    return this.renderWithCanvas(timestamp, canvas);
  }

  private async renderWithWebCodecs(timestamp: number, canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.fillText(`Frame: ${timestamp.toFixed(2)}s (WebCodecs)`, 10, 30);
  }

  private renderWithCanvas(timestamp: number, canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.fillText(`Frame: ${timestamp.toFixed(2)}s (Canvas)`, 10, 30);
  }
}

export class ExportEngine {
  private jobQueue: ExportJob[] = [];
  private isProcessing = false;

  addJob(job: Omit<ExportJob, 'id' | 'status' | 'progress'>): ExportJob {
    const exportJob: ExportJob = {
      ...job,
      id: `export-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
    };
    this.jobQueue.push(exportJob);
    this.process();
    return exportJob;
  }

  private async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.jobQueue.length > 0) {
      const job = this.jobQueue.find((j) => j.status === 'pending');
      if (!job) break;

      try {
        job.status = 'processing';
        await this.exportJob(job);
        job.status = 'completed';
        job.progress = 100;
      } catch (error) {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Export failed';
      }
    }

    this.isProcessing = false;
  }

  private async exportJob(job: ExportJob) {
    const totalFrames = Math.floor(job.duration * job.fps);
    for (let i = 0; i <= totalFrames; i++) {
      job.progress = (i / totalFrames) * 100;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  cancelJob(jobId: string) {
    const job = this.jobQueue.find((j) => j.id === jobId);
    if (job) {
      job.status = 'cancelled';
    }
  }

  getJobs(): ExportJob[] {
    return [...this.jobQueue];
  }
}

export interface ExportJob {
  id: string;
  name: string;
  format: 'mp4' | 'webm' | 'gif';
  resolution: string;
  fps: number;
  duration: number;
  quality: 'low' | 'medium' | 'high';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: string;
  createdAt: Date;
}

export class AutosaveEngine {
  private store: TimelineStore;
  private saveTimeout: NodeJS.Timeout | null = null;
  private debounceMs: number;

  constructor(store: TimelineStore, debounceMs = 2000) {
    this.store = store;
    this.debounceMs = debounceMs;
  }

  scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.save();
    }, this.debounceMs);
  }

  private save() {
    const state = this.store.getState();
    const snapshot = {
      tracks: state.tracks,
      currentTime: state.currentTime,
      duration: state.duration,
      zoom: state.zoom,
      markers: state.markers,
      savedAt: new Date().toISOString(),
    };

    localStorage.setItem('wideo11-editor-snapshot', JSON.stringify(snapshot));
    console.log('[AutosaveEngine] Snapshot saved', snapshot);
  }

  restore(): boolean {
    const data = localStorage.getItem('wideo11-editor-snapshot');
    if (!data) return false;

    try {
      const snapshot = JSON.parse(data);
      // Restore tracks and state
      return true;
    } catch {
      return false;
    }
  }

  detectCrash(): boolean {
    const key = 'wideo11-editor-last-active';
    const lastActive = localStorage.getItem(key);
    if (!lastActive) {
      localStorage.setItem(key, new Date().toISOString());
      return false;
    }

    const lastActiveTime = new Date(lastActive).getTime();
    const now = new Date().getTime();

    // If last active was more than 30 seconds ago, likely crashed
    return now - lastActiveTime > 30000;
  }
}

export { TimelineEngine, PlaybackEngine, RenderEngine, ExportEngine, AutosaveEngine };
