// ============================================================================
// WATER EFFECT - Animated ripple and reflection shaders
// ============================================================================
//
// Applied in the compositor's blit/paint path. Distorts the source image
// using a sine-wave ripple pattern, and optionally adds a reflection below.
//
// WaterRipple params:
//   amplitude  - Pixel displacement strength (0-50)
//   frequency  - Wave density (0.01-0.2)
//   speed      - Animation speed (0-5)
//   centerX/Y  - Ripple center as fraction of frame (0-1)
//   radius     - Ripple effect radius in pixels
//
// WaterReflection params:
//   intensity   - Reflection visibility (0-1)
//   waveHeight  - Wave amplitude (0-30)
//   waveSpeed   - Animation speed (0-5)
//   reflectionHeight - Height of reflection as fraction of frame (0-1)
// ============================================================================

import type { WaterRippleParams, WaterReflectionParams } from '../types';

export function waterRippleParamsFromClip(params: Record<string, number | string | boolean>): WaterRippleParams {
  return {
    amplitude: Number(params.amplitude ?? 15),
    frequency: Number(params.frequency ?? 0.05),
    speed: Number(params.speed ?? 2.0),
    centerX: Number(params.centerX ?? 0.5),
    centerY: Number(params.centerY ?? 0.5),
    radius: Number(params.radius ?? 200),
  };
}

export function waterReflectionParamsFromClip(params: Record<string, number | string | boolean>): WaterReflectionParams {
  return {
    intensity: Number(params.intensity ?? 0.6),
    waveHeight: Number(params.waveHeight ?? 10),
    waveSpeed: Number(params.waveSpeed ?? 1.5),
    reflectionHeight: Number(params.reflectionHeight ?? 0.3),
  };
}

/**
 * Compute water ripple displacement for a pixel at (x, y) at time `t`.
 * Returns { dx, dy } offset in pixels.
 */
export function waterRippleDisplacement(
  x: number,
  y: number,
  t: number,
  cfg: WaterRippleParams,
  frameW: number,
  frameH: number
): { dx: number; dy: number } {
  const { amplitude, frequency, speed, centerX, centerY, radius } = cfg;

  const cx = centerX * frameW;
  const cy = centerY * frameH;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Only apply ripple within radius
  if (dist > radius) return { dx: 0, dy: 0 };

  // Radial falloff
  const falloff = 1 - dist / radius;

  // Time-based wave phase
  const phase = dist * frequency - t * speed;
  const wave = Math.sin(phase) * amplitude * falloff;

  // Displacement direction is radial
  const dirX = dist > 0 ? dx / dist : 0;
  const dirY = dist > 0 ? dy / dist : 0;

  return { dx: dirX * wave, dy: dirY * wave };
}

/**
 * Compute water reflection wave offset for a pixel at (x, y) at time `t`.
 * Returns vertical offset for reflection sampling.
 */
export function waterReflectionOffset(
  x: number,
  y: number,
  t: number,
  cfg: WaterReflectionParams,
  frameW: number,
  frameH: number
): number {
  const { waveHeight, waveSpeed } = cfg;

  // Horizontal wave pattern for reflection
  const wave = Math.sin(x * 0.02 + t * waveSpeed) * waveHeight;
  return wave;
}
