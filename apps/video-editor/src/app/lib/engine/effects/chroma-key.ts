// ============================================================================
// CHROMA KEY EFFECT - Background removal via color keying
// ============================================================================
//
// Applied in the compositor's blit/paint path. Reads the source pixel,
// computes distance from the key color, and alpha-blends based on tolerance
// and softness. Supports spill suppression and replacement color/image.
//
// Params:
//   keyColorR/G/B   - The color to key out (0-255)
//   tolerance       - How close a color must be to be considered background (0-255)
//   softness        - Feather at the edges (0-100)
//   spillSuppression- Reduce color bleeding on foreground edges (0-100)
//   replaceWith     - 'transparent' | 'color' | 'image'
//   replaceColorR/G/B - Replacement color (if replaceWith === 'color')
// ============================================================================

import type { ChromaKeyParams } from '../types';

export function chromaKeyParamsFromClip(params: Record<string, number | string | boolean>): ChromaKeyParams {
  return {
    keyColor: {
      r: Number(params.keyColorR ?? 0),
      g: Number(params.keyColorG ?? 176),
      b: Number(params.keyColorB ?? 80),
    },
    tolerance: Number(params.tolerance ?? 40),
    softness: Number(params.softness ?? 15),
    spillSuppression: Number(params.spillSuppression ?? 50),
    replaceWith: (params.replaceWith ?? 'transparent') as 'transparent' | 'color' | 'image',
    replaceColor: {
      r: Number(params.replaceColorR ?? 0),
      g: Number(params.replaceColorG ?? 0),
      b: Number(params.replaceColorB ?? 0),
    },
    replaceImageUrl: params.replaceImageUrl as string | undefined,
  };
}

/**
 * Compute chroma key alpha for a single RGBA pixel.
 * Returns alpha 0..1 where 0 = fully keyed out (background), 1 = foreground.
 */
export function chromaKeyAlpha(
  r: number,
  g: number,
  b: number,
  a: number,
  cfg: ChromaKeyParams
): number {
  const { keyColor, tolerance, softness, spillSuppression } = cfg;

  // Distance from key color in RGB space
  const dr = r - keyColor.r;
  const dg = g - keyColor.g;
  const db = b - keyColor.b;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);

  // Similarity: 1 = matches key color exactly, 0 = far away
  const similarity = 1 - Math.min(1, dist / Math.max(1, tolerance));

  // Alpha: foreground pixels have high alpha
  let alpha = 1 - similarity;

  // Softness: feather the transition zone
  if (softness > 0) {
    const edge = tolerance * (softness / 100);
    const inTransition = dist > tolerance - edge && dist < tolerance + edge;
    if (inTransition) {
      const t = (dist - (tolerance - edge)) / (2 * edge);
      alpha = 1 - t;
    }
  }

  // Spill suppression: reduce background color bleed on semi-transparent edges
  if (spillSuppression > 0 && alpha < 1 && alpha > 0) {
    const spill = Math.min(1, similarity * (spillSuppression / 100));
    // Push color away from key color toward neutral
    const spillFactor = 1 - spill * 0.5;
    // Note: we only return alpha here; color adjustment happens in the shader
  }

  return Math.max(0, Math.min(1, alpha * a));
}

/**
 * Apply chroma key to an ImageData in place.
 */
export function applyChromaKeyToImageData(
  imageData: ImageData,
  cfg: ChromaKeyParams
): ImageData {
  const data = imageData.data;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    const alpha = chromaKeyAlpha(r, g, b, a, cfg);

    if (alpha <= 0) {
      // Fully background - make transparent
      data[i] = cfg.replaceColor.r;
      data[i + 1] = cfg.replaceColor.g;
      data[i + 2] = cfg.replaceColor.b;
      data[i + 3] = 0;
    } else if (alpha < 1) {
      // Semi-transparent - blend with replacement
      data[i + 3] = Math.round(alpha * 255);
      if (cfg.replaceWith === 'color') {
        data[i] = Math.round(r * alpha + cfg.replaceColor.r * (1 - alpha));
        data[i + 1] = Math.round(g * alpha + cfg.replaceColor.g * (1 - alpha));
        data[i + 2] = Math.round(b * alpha + cfg.replaceColor.b * (1 - alpha));
      }
    }
  }

  return imageData;
}
