// ============================================================================
// FRAME TEMPLATE STORE - State management for per-frame templates
// ============================================================================
//
// Manages all frame templates in the editor. Templates store frames,
// layers, masks, and synced frame size. Supports localStorage persistence,
// export/import as .wido-template JSON, and isolated element editing.
//
// Max layers per frame = 5 (enforced).
// Default frame size = 3x normal (1920*3 x 1080*3).
// Resize range: 100px - 500px width per frame thumbnail.
// ============================================================================

import type {
  FrameTemplate,
  FrameLayer,
  FrameMask,
  FrameSize,
  TemplateStoreState,
} from '../types';
import {
  DEFAULT_FRAME_SIZE,
  MAX_LAYERS_PER_FRAME,
  MIN_FRAME_WIDTH,
  MAX_FRAME_WIDTH,
} from '../types';

const STORAGE_KEY = 'wideo11_frame_templates';

export function createFrameTemplateStore(): TemplateStoreState {
  let templates: FrameTemplate[] = loadTemplates();
  let activeTemplateId: string | null = null;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    } catch {
      /* storage unavailable */
    }
  }

  function loadTemplates(): FrameTemplate[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function findTemplateIndex(id: string): number {
    return templates.findIndex((t) => t.id === id);
  }

  function nextId(): string {
    return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function nextLayerId(): string {
    return `lyr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function nextMaskId(): string {
    return `msk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getTemplateSafe(id: string): FrameTemplate | null {
    return templates.find((t) => t.id === id) ?? null;
  }

  return {
    get templates() {
      return templates;
    },
    get activeTemplateId() {
      return activeTemplateId;
    },

    addTemplate(template) {
      const id: string = nextId();
      const now = Date.now();
      const newTemplate: FrameTemplate = {
        ...template,
        id,
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
      };
      templates.push(newTemplate);
      save();
      return id;
    },

    getTemplate(id) {
      return getTemplateSafe(id);
    },

    getAllTemplates() {
      return [...templates];
    },

    deleteTemplate(id) {
      const idx = findTemplateIndex(id);
      if (idx < 0) return false;
      templates.splice(idx, 1);
      if (activeTemplateId === id) activeTemplateId = null;
      save();
      return true;
    },

    setActiveTemplate(id) {
      activeTemplateId = id;
    },

    setActiveFrame(templateId, frameIndex) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      if (frameIndex < 0 || frameIndex >= tpl.frames.length) return;
      tpl.activeFrameIndex = frameIndex;
      tpl.updatedAt = Date.now();
      save();
    },

    addLayer(templateId, frameIndex, layer) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      const frame = tpl.frames[frameIndex];
      if (!frame) return;
      if (frame.layers.length >= MAX_LAYERS_PER_FRAME) return;

      const newLayer: FrameLayer = {
        ...layer,
        id: nextLayerId(),
        isolated: false,
      };

      // Re-index zIndex: new layer goes on top
      const maxZ = frame.layers.reduce((max, l) => Math.max(max, l.zIndex), -1);
      newLayer.zIndex = maxZ + 1;

      frame.layers.push(newLayer);
      frame.layers.sort((a, b) => a.zIndex - b.zIndex);
      tpl.updatedAt = Date.now();
      save();
    },

    removeLayer(templateId, frameIndex, layerId) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      const frame = tpl.frames[frameIndex];
      if (!frame) return;
      frame.layers = frame.layers.filter((l) => l.id !== layerId);
      tpl.updatedAt = Date.now();
      save();
    },

    updateLayer(templateId, frameIndex, layerId, updates) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      const frame = tpl.frames[frameIndex];
      if (!frame) return;
      const layer = frame.layers.find((l) => l.id === layerId);
      if (!layer) return;
      Object.assign(layer, updates);
      layer.zIndex = updates.zIndex ?? layer.zIndex;
      tpl.updatedAt = Date.now();
      save();
    },

    addMask(templateId, frameIndex, mask) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      const frame = tpl.frames[frameIndex];
      if (!frame) return;
      const newMask: FrameMask = {
        ...mask,
        id: nextMaskId(),
      };
      frame.masks.push(newMask);
      tpl.updatedAt = Date.now();
      save();
    },

    updateMask(templateId, frameIndex, maskId, updates) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      const frame = tpl.frames[frameIndex];
      if (!frame) return;
      const mask = frame.masks.find((m) => m.id === maskId);
      if (!mask) return;
      Object.assign(mask, updates);
      tpl.updatedAt = Date.now();
      save();
    },

    resizeFrameSize(templateId, size) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      // Clamp size
      const clampedWidth = Math.max(MIN_FRAME_WIDTH, Math.min(MAX_FRAME_WIDTH, size.width));
      const clampedHeight = Math.max(MIN_FRAME_WIDTH, Math.min(MAX_FRAME_WIDTH, size.height));
      tpl.frameSize = { width: clampedWidth, height: clampedHeight };

      if (tpl.sizeLocked) {
        // Apply to all frames
        for (const frame of tpl.frames) {
          frame.size = { width: clampedWidth, height: clampedHeight };
        }
      }
      tpl.updatedAt = Date.now();
      save();
    },

    toggleSizeLock(templateId) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      tpl.sizeLocked = !tpl.sizeLocked;
      tpl.updatedAt = Date.now();
      save();
    },

    toggleLayerIsolated(templateId, frameIndex, layerId) {
      const tpl = getTemplateSafe(templateId);
      if (!tpl) return;
      const frame = tpl.frames[frameIndex];
      if (!frame) return;
      const layer = frame.layers.find((l) => l.id === layerId);
      if (!layer) return;
      layer.isolated = !layer.isolated;
      tpl.updatedAt = Date.now();
      save();
    },

    exportTemplate(id) {
      const tpl = getTemplateSafe(id);
      if (!tpl) return '';
      // Increment usage
      tpl.usageCount += 1;
      save();
      return JSON.stringify(tpl, null, 2);
    },

    importTemplate(json) {
      try {
        const parsed = JSON.parse(json);
        if (!parsed.id || !parsed.name || !Array.isArray(parsed.frames)) return null;
        const id: string = nextId();
        const now = Date.now();
        const newTemplate: FrameTemplate = {
          ...parsed,
          id,
          createdAt: now,
          updatedAt: now,
          usageCount: 0,
        };
        templates.push(newTemplate);
        save();
        return id;
      } catch {
        return null;
      }
    },
  };
}
