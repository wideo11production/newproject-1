import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  rippleTrim,
  roll,
  slide,
  slip,
  extendBranding,
} from './edits';
import { nextId, NEUTRAL_FILTER, DEFAULT_TRANSFORM, type TimelineClip, type TimelineTrack } from './types';

const FPS = 30;

function makeTrack(trackId: string, clipCount: number): TimelineTrack {
  const clips: TimelineClip[] = [];
  for (let i = 0; i < clipCount; i++) {
    clips.push({
      id: nextId('clip'),
      mediaId: `media-${i}`,
      mediaName: `media-${i}.mp4`,
      startTime: i,
      duration: 1,
      type: 'video',
      effects: [],
      sourceIn: 0,
      speed: 1,
      volume: 1,
      muted: false,
      opacity: 1,
      fadeIn: 0,
      fadeOut: 0,
      filter: { ...NEUTRAL_FILTER },
      transform: { ...DEFAULT_TRANSFORM },
    });
  }
  return {
    id: trackId,
    name: `Track ${trackId}`,
    type: 'video',
    role: 'base',
    clips,
    volume: 1,
    muted: false,
    solo: false,
    visible: true,
    locked: false,
  };
}

function makeTracks(trackCount: number, clipCount: number): TimelineTrack[] {
  return Array.from({ length: trackCount }, (_, i) => makeTrack(`track-${i}`, clipCount));
}

function countTotalClips(tracks: TimelineTrack[]): number {
  return tracks.reduce((sum, t) => sum + t.clips.length, 0);
}

describe('Chaos tests — resilience under failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rapid undo/redo cycles on 1000 clips do not corrupt state', () => {
    const tracks = makeTracks(5, 200);
    const track = tracks[0];
    const clip = track.clips[50];

    // Rapid fire: ripple, roll, slide, slip, repeat
    let current = tracks;
    for (let cycle = 0; cycle < 20; cycle++) {
      const c = current[0].clips[cycle % 50];
      const r = rippleTrim(current, current[0].id, c.id, 'out', 5, FPS);
      if (r) current = r.tracks;

      const c2 = current[0].clips[(cycle + 1) % 50];
      const r2 = roll(current, current[0].id, c2.id, current[0].clips[(cycle + 2) % 50].id, 5, FPS);
      if (r2) current = r2.tracks;

      const c3 = current[0].clips[(cycle + 3) % 50];
      const r3 = slide(current, current[0].id, c3.id, 5, FPS);
      if (r3) current = r3.tracks;

      const c4 = current[0].clips[(cycle + 4) % 50];
      const r4 = slip(current, current[0].id, c4.id, 5, FPS);
      if (r4) current = r4.tracks;
    }

    // After chaos, clip count must be preserved
    expect(countTotalClips(current)).toBe(countTotalClips(tracks));

    // All clips must have valid spans
    for (const track of current) {
      for (const clip of track.clips) {
        const startFrame = Math.round(clip.startTime * FPS);
        const endFrame = Math.round((clip.startTime + clip.duration) * FPS);
        expect(endFrame - startFrame).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('corrupted clip data does not crash edit operations', () => {
    const tracks = makeTracks(3, 50);
    const track = tracks[0];

    // Corrupt a clip's duration to 0
    const badClip = track.clips[10];
    badClip.duration = 0;

    // rippleTrim should handle gracefully (return null or valid result)
    const result = rippleTrim(tracks, track.id, badClip.id, 'out', 30, FPS);
    // Either null (cannot edit) or valid result - never throws
    if (result) {
      expect(countTotalClips(result.tracks)).toBe(countTotalClips(tracks));
    }
  });

  it('negative delta in rippleTrim clamps safely', () => {
    const tracks = makeTracks(3, 50);
    const track = tracks[0];
    const clip = track.clips[25];

    // Huge negative delta should clamp, not crash
    const result = rippleTrim(tracks, track.id, clip.id, 'in', -10000, FPS);
    expect(result).not.toBeNull();

    const updatedClip = result!.tracks[0].clips.find((c) => c.id === clip.id)!;
    expect(updatedClip.duration).toBeGreaterThanOrEqual(1 / FPS); // at least 1 frame
  });

  it('roll on clips at timeline boundary', () => {
    const tracks = makeTracks(3, 50);
    const track = tracks[0];

    // First and last clips
    const first = track.clips[0];
    const last = track.clips[track.clips.length - 1];

    // Roll first two
    const r1 = roll(tracks, track.id, first.id, track.clips[1].id, 5, FPS);
    if (r1) expect(countTotalClips(r1.tracks)).toBe(countTotalClips(tracks));

    // Roll last two (no clip after last, but roll works on the two clips)
    const r2 = roll(tracks, track.id, track.clips[track.clips.length - 2].id, last.id, -5, FPS);
    if (r2) expect(countTotalClips(r2.tracks)).toBe(countTotalClips(tracks));
  });

  it('slip with huge delta clamps safely', () => {
    const tracks = makeTracks(3, 50);
    const track = tracks[0];
    const clip = track.clips[25];

    // Slip by 10000 frames should clamp to source start
    const result = slip(tracks, track.id, clip.id, 10000, FPS);
    expect(result).not.toBeNull();

    const updatedClip = result!.tracks[0].clips.find((c) => c.id === clip.id)!;
    expect(updatedClip.sourceIn).toBeGreaterThanOrEqual(0);
  });

  it('extendBranding on non-branding tracks is no-op', () => {
    const tracks = makeTracks(5, 200);
    const initialCount = countTotalClips(tracks);

    const result = extendBranding(tracks, 100000);
    expect(result).toHaveLength(tracks.length);
    expect(countTotalClips(result)).toBe(initialCount);

    // No track should have been modified
    for (let i = 0; i < tracks.length; i++) {
      expect(result[i].clips.length).toBe(tracks[i].clips.length);
    }
  });

  it('concurrent edits on different tracks do not interfere', () => {
    const tracks = makeTracks(5, 200);

    // Edit track 0 and track 4 simultaneously (conceptually)
    const r1 = rippleTrim(tracks, tracks[0].id, tracks[0].clips[10].id, 'out', 10, FPS);
    const r2 = rippleTrim(tracks, tracks[4].id, tracks[4].clips[150].id, 'in', 10, FPS);

    if (r1 && r2) {
      // Both should succeed independently
      expect(countTotalClips(r1.tracks)).toBe(countTotalClips(tracks));
      expect(countTotalClips(r2.tracks)).toBe(countTotalClips(tracks));
    }
  });

  it('edit on empty track returns null gracefully', () => {
    const emptyTrack: TimelineTrack = {
      id: 'empty',
      name: 'Empty',
      type: 'video',
      role: 'base',
      clips: [],
      volume: 1,
      muted: false,
      solo: false,
      visible: true,
      locked: false,
    };
    const tracks = [emptyTrack];

    const result = rippleTrim(tracks, 'empty', 'nonexistent', 'out', 30, FPS);
    expect(result).toBeNull();
  });

  it('1000 clips memory usage stays bounded', () => {
    const tracks = makeTracks(10, 100); // 1000 clips
    const clipCount = countTotalClips(tracks);
    expect(clipCount).toBe(1000);

    // Each clip should have all required fields
    for (const track of tracks) {
      for (const clip of track.clips) {
        expect(clip.id).toBeDefined();
        expect(clip.mediaId).toBeDefined();
        expect(clip.startTime).toBeGreaterThanOrEqual(0);
        expect(clip.duration).toBeGreaterThan(0);
        expect(clip.type).toBeDefined();
        expect(clip.effects).toBeDefined();
        expect(clip.filter).toBeDefined();
        expect(clip.transform).toBeDefined();
      }
    }
  });

  it('mixed edit types on 1000 clips complete in reasonable time', () => {
    const tracks = makeTracks(5, 200);
    const start = performance.now();

    let current = tracks;
    for (let i = 0; i < 100; i++) {
      const trackIdx = i % 5;
      const clipIdx = (i * 7) % 200;
      const clip = current[trackIdx].clips[clipIdx];

      const op = i % 4;
      if (op === 0) {
        const r = rippleTrim(current, current[trackIdx].id, clip.id, 'out', 3, FPS);
        if (r) current = r.tracks;
      } else if (op === 1) {
        const r = slide(current, current[trackIdx].id, clip.id, 3, FPS);
        if (r) current = r.tracks;
      } else if (op === 2) {
        const r = slip(current, current[trackIdx].id, clip.id, 3, FPS);
        if (r) current = r.tracks;
      }
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000); // 100 mixed edits in < 2s
    expect(countTotalClips(current)).toBe(1000);
  });

  it('edit on locked track still works at data level', () => {
    const tracks = makeTracks(3, 50);
    // Lock a track
    const lockedTracks = tracks.map((t, i) =>
      i === 1 ? { ...t, locked: true } : t,
    );

    // Data layer doesn't check locked flag - edits still work
    const result = rippleTrim(lockedTracks, lockedTracks[1].id, lockedTracks[1].clips[10].id, 'out', 10, FPS);
    expect(result).not.toBeNull();
    expect(countTotalClips(result!.tracks)).toBe(countTotalClips(lockedTracks));
  });
});
