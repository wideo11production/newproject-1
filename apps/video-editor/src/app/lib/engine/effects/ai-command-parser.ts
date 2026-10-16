// ============================================================================
// AI COMMAND PARSER - Natural language → video effect commands
// ============================================================================
//
// Parses user prompts from the AI chat and maps them to concrete effect
// operations on timeline clips. Supports:
//   - "remove background" / "chroma key green screen" → chroma-key effect
//   - "add water ripple" / "water effect" → water-ripple effect
//   - "add water reflection" → water-reflection effect
//   - "save this frame as template" → template creation
//   - "apply template to this clip" → template application
//
// Returns structured commands that the effect pipeline executes on clips.
// ============================================================================

import type { VideoEffect, VideoEffectType, ChromaKeyParams, WaterRippleParams, WaterReflectionParams, BackgroundRemoveParams, TemplateClip } from '../types';

export interface ParsedCommand {
  action: 'apply-effect' | 'remove-effect' | 'create-template' | 'apply-template' | 'info' | 'unknown';
  effectType?: VideoEffectType;
  targetClipId?: string;
  params?: Record<string, number | string | boolean>;
  sourcePrompt: string;
  confidence: number; // 0..1
  description: string;
}

export function parseAICommand(prompt: string, availableClipIds: string[]): ParsedCommand {
  const p = prompt.toLowerCase().trim();

  // ---- Background removal / chroma key ----
  if (
    p.includes('remove background') ||
    p.includes('chroma key') ||
    p.includes('green screen') ||
    p.includes('blue screen') ||
    p.includes('bg remove') ||
    p.includes('background removal')
  ) {
    let keyColor = { r: 0, g: 176, b: 80 }; // default green
    let tolerance = 40;
    let softness = 15;
    let replaceWith: 'transparent' | 'color' | 'image' = 'transparent';
    let replaceColor = { r: 0, g: 0, b: 0 };

    if (p.includes('blue')) keyColor = { r: 0, g: 120, b: 255 };
    if (p.includes('red')) keyColor = { r: 255, g: 0, b: 0 };
    if (p.includes('white')) keyColor = { r: 255, g: 255, b: 255 };
    if (p.includes('black')) keyColor = { r: 0, g: 0, b: 0 };

    if (p.includes('replace with color') || p.includes('replace color')) replaceWith = 'color';
    if (p.includes('replace with image') || p.includes('replace image')) replaceWith = 'image';

    return {
      action: 'apply-effect',
      effectType: 'chroma-key',
      targetClipId: availableClipIds[0],
      params: {
        keyColorR: keyColor.r,
        keyColorG: keyColor.g,
        keyColorB: keyColor.b,
        tolerance,
        softness,
        spillSuppression: 50,
        replaceWith,
        replaceColorR: replaceColor.r,
        replaceColorG: replaceColor.g,
        replaceColorB: replaceColor.b,
      },
      sourcePrompt: prompt,
      confidence: 0.9,
      description: 'Remove background using chroma key (green/blue screen keying)',
    };
  }

  // ---- Water ripple ----
  if (
    p.includes('water ripple') ||
    p.includes('water effect') ||
    p.includes('add water') ||
    p.includes('ripple effect') ||
    p.includes('water animation')
  ) {
    return {
      action: 'apply-effect',
      effectType: 'water-ripple',
      targetClipId: availableClipIds[0],
      params: {
        amplitude: 15,
        frequency: 0.05,
        speed: 2.0,
        centerX: 0.5,
        centerY: 0.5,
        radius: 200,
      },
      sourcePrompt: prompt,
      confidence: 0.85,
      description: 'Add animated water ripple effect to the clip',
    };
  }

  // ---- Water reflection ----
  if (
    p.includes('water reflection') ||
    p.includes('reflection') ||
    p.includes('mirror water')
  ) {
    return {
      action: 'apply-effect',
      effectType: 'water-reflection',
      targetClipId: availableClipIds[0],
      params: {
        intensity: 0.6,
        waveHeight: 10,
        waveSpeed: 1.5,
        reflectionHeight: 0.3,
      },
      sourcePrompt: prompt,
      confidence: 0.85,
      description: 'Add water reflection effect below the clip',
    };
  }

  // ---- Background remove (AI segmentation) ----
  if (
    p.includes('ai remove background') ||
    p.includes('segmentation') ||
    p.includes('remove bg') ||
    p.includes('cutout')
  ) {
    return {
      action: 'apply-effect',
      effectType: 'background-remove',
      targetClipId: availableClipIds[0],
      params: {
        method: 'ai-segmentation',
        tolerance: 50,
        edgeFeather: 5,
        backgroundColorR: 0,
        backgroundColorG: 0,
        backgroundColorB: 0,
      },
      sourcePrompt: prompt,
      confidence: 0.8,
      description: 'Remove background using AI segmentation (no green screen needed)',
    };
  }

  // ---- Create template ----
  if (
    p.includes('save as template') ||
    p.includes('create template') ||
    p.includes('save this frame') ||
    p.includes('template from this')
  ) {
    return {
      action: 'create-template',
      targetClipId: availableClipIds[0],
      sourcePrompt: prompt,
      confidence: 0.9,
      description: 'Save current clip state as a reusable per-frame template',
    };
  }

  // ---- Apply template ----
  if (
    p.includes('apply template') ||
    p.includes('use template') ||
    p.includes('load template')
  ) {
    return {
      action: 'apply-template',
      targetClipId: availableClipIds[0],
      sourcePrompt: prompt,
      confidence: 0.85,
      description: 'Apply a saved template to the selected clip',
    };
  }

  // ---- Remove effect ----
  if (
    p.includes('remove effect') ||
    p.includes('delete effect') ||
    p.includes('clear effect') ||
    p.includes('no effect')
  ) {
    return {
      action: 'remove-effect',
      targetClipId: availableClipIds[0],
      sourcePrompt: prompt,
      confidence: 0.8,
      description: 'Remove all video effects from the selected clip',
    };
  }

  // ---- Info / help ----
  if (
    p.includes('what can you do') ||
    p.includes('help') ||
    p.includes('commands') ||
    p.includes('capabilities')
  ) {
    return {
      action: 'info',
      sourcePrompt: prompt,
      confidence: 1.0,
      description: 'Available: remove background, chroma key, add water ripple, water reflection, save template, apply template, remove effect',
    };
  }

  return {
    action: 'unknown',
    sourcePrompt: prompt,
    confidence: 0,
    description: 'I did not understand that command. Try: "remove background", "add water ripple", "save as template"',
  };
}

export function buildVideoEffect(
  type: VideoEffectType,
  params: Record<string, number | string | boolean>,
  sourcePrompt?: string
): VideoEffect {
  return {
    id: `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    enabled: true,
    params,
    appliedAt: Date.now(),
    sourcePrompt,
  };
}

export function mergeEffectParams(
  effect: VideoEffect,
  updates: Partial<ChromaKeyParams | WaterRippleParams | WaterReflectionParams | BackgroundRemoveParams>
): VideoEffect {
  return {
    ...effect,
    params: { ...effect.params, ...updates },
    appliedAt: Date.now(),
  };
}

export function getDefaultParams(type: VideoEffectType): Record<string, number | string | boolean> {
  switch (type) {
    case 'chroma-key':
      return {
        keyColorR: 0,
        keyColorG: 176,
        keyColorB: 80,
        tolerance: 40,
        softness: 15,
        spillSuppression: 50,
        replaceWith: 'transparent',
        replaceColorR: 0,
        replaceColorG: 0,
        replaceColorB: 0,
      };
    case 'water-ripple':
      return {
        amplitude: 15,
        frequency: 0.05,
        speed: 2.0,
        centerX: 0.5,
        centerY: 0.5,
        radius: 200,
      };
    case 'water-reflection':
      return {
        intensity: 0.6,
        waveHeight: 10,
        waveSpeed: 1.5,
        reflectionHeight: 0.3,
      };
    case 'background-remove':
      return {
        method: 'ai-segmentation',
        tolerance: 50,
        edgeFeather: 5,
        backgroundColorR: 0,
        backgroundColorG: 0,
        backgroundColorB: 0,
      };
    default:
      return {};
  }
}

export const AI_COMMAND_EXAMPLES = [
  { prompt: 'remove background', result: 'chroma-key effect applied to selected clip' },
  { prompt: 'chroma key green screen', result: 'green background removed' },
  { prompt: 'chroma key blue screen', result: 'blue background removed' },
  { prompt: 'add water ripple', result: 'animated water ripple overlay' },
  { prompt: 'add water reflection', result: 'water reflection below clip' },
  { prompt: 'ai remove background', result: 'AI segmentation background removal' },
  { prompt: 'save as template', result: 'clip state saved as reusable template' },
  { prompt: 'apply template', result: 'template applied to selected clip' },
  { prompt: 'remove effect', result: 'all effects cleared from clip' },
];
