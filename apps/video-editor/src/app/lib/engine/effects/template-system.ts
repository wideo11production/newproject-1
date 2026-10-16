// ============================================================================
// PER-FRAME TEMPLATE SYSTEM - Save clip state as reusable template
// ============================================================================
//
// Templates capture a clip's complete visual state (transform, filter,
// videoEffects) and can be applied to other clips or specific frame ranges.
// Supports per-frame templates that clamp to specific timeline frames.
// ============================================================================

import type { TemplateClip, TimelineClip } from '../types';

const STORAGE_KEY = 'wideo11_video_templates';

export interface TemplateStore {
  templates: TemplateClip[];
  addTemplate: (template: Omit<TemplateClip, 'id' | 'createdAt' | 'usageCount'>) => string;
  getTemplate: (id: string) => TemplateClip | null;
  getAllTemplates: () => TemplateClip[];
  applyTemplate: (templateId: string, targetClip: TimelineClip) => TimelineClip;
  deleteTemplate: (id: string) => boolean;
  incrementUsage: (id: string) => void;
  exportTemplates: () => string;
  importTemplates: (json: string) => number;
}

export function createTemplateStore(): TemplateStore {
  let templates: TemplateClip[] = loadTemplates();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    } catch {
      /* storage unavailable */
    }
  }

  function loadTemplates(): TemplateClip[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return {
    get templates() {
      return templates;
    },

    addTemplate(template) {
      const id: string = `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const newTemplate: TemplateClip = {
        ...template,
        id,
        createdAt: Date.now(),
        usageCount: 0,
      };
      templates.push(newTemplate);
      save();
      return id;
    },

    getTemplate(id) {
      return templates.find((t) => t.id === id) ?? null;
    },

    getAllTemplates() {
      return [...templates];
    },

    applyTemplate(templateId, targetClip) {
      const template = templates.find((t) => t.id === templateId);
      if (!template) return targetClip;

      const { clipState } = template;
      const updated: TimelineClip = {
        ...targetClip,
        transform: { ...targetClip.transform, ...(clipState.transform ?? {}) },
        filter: { ...targetClip.filter, ...(clipState.filter ?? {}) },
        videoEffects: clipState.videoEffects
          ? [...clipState.videoEffects]
          : targetClip.videoEffects ?? [],
        effects: clipState.effects ? [...clipState.effects] : targetClip.effects,
        opacity: clipState.opacity ?? targetClip.opacity,
        speed: clipState.speed ?? targetClip.speed,
      };

      templates = templates.map((t) =>
        t.id === templateId ? { ...t, usageCount: t.usageCount + 1 } : t
      );
      save();

      return updated;
    },

    deleteTemplate(id) {
      const before = templates.length;
      templates = templates.filter((t) => t.id !== id);
      if (templates.length < before) {
        save();
        return true;
      }
      return false;
    },

    incrementUsage(id) {
      templates = templates.map((t) =>
        t.id === id ? { ...t, usageCount: t.usageCount + 1 } : t
      );
      save();
    },

    exportTemplates() {
      return JSON.stringify(templates, null, 2);
    },

    importTemplates(json) {
      try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return 0;
        let count = 0;
        for (const t of parsed) {
          if (t.id && t.name && t.clipState) {
            templates.push(t as TemplateClip);
            count++;
          }
        }
        save();
        return count;
      } catch {
        return 0;
      }
    },
  };
}

/**
 * Create a template from the current state of a timeline clip.
 * Captures transform, filter, videoEffects, opacity, speed.
 */
export function clipToTemplate(
  clip: TimelineClip,
  name: string,
  thumbnail?: string,
  frameRange?: { startFrame: number; endFrame: number }
): Omit<TemplateClip, 'id' | 'createdAt' | 'usageCount'> {
  return {
    name,
    thumbnail,
    clipState: {
      transform: { ...clip.transform },
      filter: { ...clip.filter },
      videoEffects: clip.videoEffects ? [...clip.videoEffects] : [],
      effects: [...clip.effects],
      opacity: clip.opacity,
      speed: clip.speed,
    },
    frameRange,
  };
}

/**
 * Default built-in templates that ship with the editor.
 */
export const BUILTIN_TEMPLATES: Omit<TemplateClip, 'id' | 'createdAt' | 'usageCount'>[] = [
  {
    name: 'Green Screen Removal',
    thumbnail: undefined,
    clipState: {
      transform: { ...{ x: 0.5, y: 0.5, scale: 1, rotation: 0, fit: 'contain', corner: 'bottom-right', pipSize: 0.28, zoomStart: 1, zoomEnd: 1, panX: 0, panY: 0 } },
      filter: { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0, temperature: 0 },
      videoEffects: [
        {
          id: 'fx-chroma-default',
          type: 'chroma-key',
          enabled: true,
          params: {
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
          },
          appliedAt: Date.now(),
          sourcePrompt: 'remove background',
        },
      ],
      effects: [],
      opacity: 1,
      speed: 1,
    },
  },
  {
    name: 'Water Ripple',
    thumbnail: undefined,
    clipState: {
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, fit: 'contain', corner: 'bottom-right', pipSize: 0.28, zoomStart: 1, zoomEnd: 1, panX: 0, panY: 0 },
      filter: { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0, temperature: 0 },
      videoEffects: [
        {
          id: 'fx-water-default',
          type: 'water-ripple',
          enabled: true,
          params: {
            amplitude: 15,
            frequency: 0.05,
            speed: 2.0,
            centerX: 0.5,
            centerY: 0.5,
            radius: 200,
          },
          appliedAt: Date.now(),
          sourcePrompt: 'add water ripple',
        },
      ],
      effects: [],
      opacity: 1,
      speed: 1,
    },
  },
  {
    name: 'Water Reflection',
    thumbnail: undefined,
    clipState: {
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, fit: 'contain', corner: 'bottom-right', pipSize: 0.28, zoomStart: 1, zoomEnd: 1, panX: 0, panY: 0 },
      filter: { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0, temperature: 0 },
      videoEffects: [
        {
          id: 'fx-reflection-default',
          type: 'water-reflection',
          enabled: true,
          params: {
            intensity: 0.6,
            waveHeight: 10,
            waveSpeed: 1.5,
            reflectionHeight: 0.3,
          },
          appliedAt: Date.now(),
          sourcePrompt: 'add water reflection',
        },
      ],
      effects: [],
      opacity: 1,
      speed: 1,
    },
  },
];
