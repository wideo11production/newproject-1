// ============================================================================
// AI FEATURES INDEX - Public API
// ============================================================================
//
// Hinglish: Ye module AI features ke liye public API provide karta hai:
// - AI Provider - Local AI model registry
// - AI Processor - Feature coordination
// - UI Components - React panels for each feature
// - Services - Backend processing implementations
//

export { LocalAIProvider } from './implementation';
export { AIProcessor } from './implementation';
export { 
  useAIStabilization, 
  useAIChromaKey, 
  useAIMotionTracking, 
  useAISlowMotion 
} from './implementation';

export { StabilizationAI, ChromaKeyAI, MotionTrackingAI, SlowMotionAI } from './ai-services';

export { StabilizationPanel } from '../components/panels/stabilization-panel';
export { ChromaKeyPanel } from '../components/panels/chroma-key-panel';

export { default as AIHooks } from './implementation';
export { default as AIIndex } from './implementation';

// ============================================================================
// AI FEATURE CONFIGURATION
// ============================================================================

export const AI_FEATURE_CONFIG = {
  stabilization: {
    id: 'stabilize',
    label: 'Stabilization',
    icon: 'Shield',
    status: 'ready',
    hint: 'Smooth out hand-held shake using local motion estimation and camera path analysis',
    component: StabilizationPanel,
    endpoint: '/api/ai/stabilize',
    model: 'motion-estimate-1.0',
    cost: 0,
    local: true
  },
  chromaKey: {
    id: 'chroma',
    label: 'Chroma Key',
    icon: 'Droplets',
    status: 'ready',
    hint: 'Remove a flat colour and make it transparent using local per-pixel color keying',
    component: ChromaKeyPanel,
    endpoint: '/api/ai/chroma-key',
    model: 'background-removal-2.0',
    cost: 0,
    local: true
  },
  motionTracking: {
    id: 'motion-tracking',
    label: 'Motion Tracking',
    icon: 'Target',
    status: 'ready',
    hint: 'Follow objects and predict trajectory using local object detection',
    endpoint: '/api/ai/motion-tracking',
    model: 'object-tracker-1.0',
    cost: 0,
    local: true
  },
  slowMotion: {
    id: 'slow-motion',
    label: 'Slow Motion',
    icon: 'Clock',
    status: 'ready',
    hint: 'Generate smooth slow-motion with high frame rate and temporal interpolation',
    endpoint: '/api/ai/slow-motion',
    model: 'temporal-interpolation-1.0',
    cost: 0,
    local: true
  }
};

export type AIFeatureId = keyof typeof AI_FEATURE_CONFIG;

export function getAIFeature(id: AIFeatureId) {
  return AI_FEATURE_CONFIG[id];
}

export function getAllAIFeatures() {
  return Object.values(AI_FEATURE_CONFIG);
}

export function isAIFeatureReady(id: AIFeatureId): boolean {
  return AI_FEATURE_CONFIG[id].status === 'ready';
}