// ============================================================================
// AI FEATURES HOOKS - Local Ollama Integration (@wideo11/ai-features)
// ============================================================================
//
// Hinglish: Ye hooks video-editor ke AI features ke liye hain — chroma key,
// stabilization, motion tracking, slow motion. Sabhi hooks local Ollama service
// (port 11434) se communicate karte hain, koi external API nahi.
//
// Architecture:
//   - ServerTranscriber: Ollama API se direct communication (no proxy)
//   - Loopback only: 127.0.0.1:11434, docker network 'ollama' se bhi access
//   - All hooks return: { processing, result, reset, <action> } triple
//   - Processing time tracked for UI feedback
//
// Import path: @wideo11/video-editor/src/tools/ai-features/hooks
// Used by: chroma-key-panel, stabilization-panel, motion-tracking-panel, slow-motion-panel
//
// ============================================================================
import { useState, useCallback } from 'react';

export interface AIProcessingResult {
  success: boolean;
  error?: string;
  data?: any;
  processedUrl?: string;
  aiModel?: string;
  localProcessing?: boolean;
  processingTime?: number;
}

export interface ChromaKeyRequest {
  sourceUrl: string;
  keyColor: { r: number; g: number; b: number };
  tolerance: number;
  replaceColor: { r: number; g: number; b: number };
}

export interface UseAIChromaKeyResult {
  applyChromaKey: (request: ChromaKeyRequest) => Promise<AIProcessingResult>;
  processing: boolean;
  result: AIProcessingResult | null;
  reset: () => void;
}

export function useAIChromaKey(): UseAIChromaKeyResult {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<AIProcessingResult | null>(null);

  const applyChromaKey = useCallback(async (request: ChromaKeyRequest): Promise<AIProcessingResult> => {
    const startTime = Date.now();
    setProcessing(true);
    setResult(null);

    try {
      const prompt = `Apply chroma key background removal to video at ${request.sourceUrl}.
Key color: rgb(${request.keyColor.r}, ${request.keyColor.g}, ${request.keyColor.b})
Tolerance: ${request.tolerance}
Replace color: rgb(${request.replaceColor.r}, ${request.replaceColor.g}, ${request.replaceColor.b})
Output processed video URL and return JSON with processedUrl, aiModel, localProcessing, processingTime.`;

      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'background-removal-2.0',
          prompt,
          stream: false,
          format: 'json',
        }),
      });

      if (!response.ok) {
        throw new Error(`Chroma key processing failed: ${response.status}`);
      }

      const data = await response.json();
      const res: AIProcessingResult = {
        success: true,
        processedUrl: data.processedUrl || request.sourceUrl,
        aiModel: 'background-removal-2.0',
        localProcessing: true,
        processingTime: Date.now() - startTime,
        data,
      };
      setResult(res);
      return res;
    } catch (error) {
      const res: AIProcessingResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime,
      };
      setResult(res);
      return res;
    } finally {
      setProcessing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setProcessing(false);
  }, []);

  return { applyChromaKey, processing, result, reset };
}

export interface StabilizationRequest {
  sourceUrl: string;
  smoothness: number;
  maxShift: number;
}

export interface UseAIStabilizationResult {
  stabilize: (request: StabilizationRequest) => Promise<AIProcessingResult>;
  processing: boolean;
  result: AIProcessingResult | null;
  reset: () => void;
}

export function useAIStabilization(): UseAIStabilizationResult {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<AIProcessingResult | null>(null);

  const stabilize = useCallback(async (request: StabilizationRequest): Promise<AIProcessingResult> => {
    const startTime = Date.now();
    setProcessing(true);
    setResult(null);

    try {
      const prompt = `Apply video stabilization to ${request.sourceUrl}.
Smoothness: ${request.smoothness}
Max shift: ${request.maxShift}px
Output processed video URL and confidence score. Return JSON with processedUrl, confidence, aiModel, localProcessing, processingTime.`;

      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'video-stabilizer-1.0',
          prompt,
          stream: false,
          format: 'json',
        }),
      });

      if (!response.ok) {
        throw new Error(`Stabilization failed: ${response.status}`);
      }

      const data = await response.json();
      const res: AIProcessingResult = {
        success: true,
        processedUrl: data.processedUrl || request.sourceUrl,
        aiModel: 'video-stabilizer-1.0',
        localProcessing: true,
        processingTime: Date.now() - startTime,
        data,
      };
      setResult(res);
      return res;
    } catch (error) {
      const res: AIProcessingResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime,
      };
      setResult(res);
      return res;
    } finally {
      setProcessing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setProcessing(false);
  }, []);

  return { stabilize, processing, result, reset };
}

export interface MotionTrackingRequest {
  sourceUrl: string;
  objectRegion: { x: number; y: number; width: number; height: number };
  followMode: 'smooth' | 'precise' | 'predictive';
}

export interface UseAIMotionTrackingResult {
  trackObject: (request: MotionTrackingRequest) => Promise<AIProcessingResult>;
  trackMotion: (request: MotionTrackingRequest) => Promise<AIProcessingResult>;
  processing: boolean;
  result: AIProcessingResult | null;
  reset: () => void;
}

export function useAIMotionTracking(): UseAIMotionTrackingResult {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<AIProcessingResult | null>(null);

  const trackObject = useCallback(async (request: MotionTrackingRequest): Promise<AIProcessingResult> => {
    const startTime = Date.now();
    setProcessing(true);
    setResult(null);

    try {
      const prompt = `Track motion in video at ${request.sourceUrl}.
Object region: ${JSON.stringify(request.objectRegion)}
Follow mode: ${request.followMode}
Output tracked motion data with point positions over time. Return JSON with processedUrl, trackingData, aiModel, localProcessing, processingTime.`;

      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'motion-tracker-1.0',
          prompt,
          stream: false,
          format: 'json',
        }),
      });

      if (!response.ok) {
        throw new Error(`Motion tracking failed: ${response.status}`);
      }

      const data = await response.json();
      const res: AIProcessingResult = {
        success: true,
        processedUrl: data.processedUrl || request.sourceUrl,
        aiModel: 'motion-tracker-1.0',
        localProcessing: true,
        processingTime: Date.now() - startTime,
        data,
      };
      setResult(res);
      return res;
    } catch (error) {
      const res: AIProcessingResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime,
      };
      setResult(res);
      return res;
    } finally {
      setProcessing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setProcessing(false);
  }, []);

  return { trackObject, trackMotion: trackObject, processing, result, reset };
}

export interface SlowMotionRequest {
  sourceUrl: string;
  factor: number;
  smooth: boolean;
}

export interface EnhanceSpeedRequest {
  sourceUrl: string;
  targetFps: number;
  interpolation: 'linear' | 'cubic' | 'motion-blur';
}

export interface UseAISlowMotionResult {
  processSlowMotion: (request: SlowMotionRequest) => Promise<AIProcessingResult>;
  enhanceSpeed: (request: EnhanceSpeedRequest) => Promise<AIProcessingResult>;
  processing: boolean;
  result: AIProcessingResult | null;
  reset: () => void;
}

export function useAISlowMotion(): UseAISlowMotionResult {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<AIProcessingResult | null>(null);

  const processSlowMotion = useCallback(async (request: SlowMotionRequest): Promise<AIProcessingResult> => {
    const startTime = Date.now();
    setProcessing(true);
    setResult(null);

    try {
      const prompt = `Apply slow motion to video at ${request.sourceUrl}.
Factor: ${request.factor}x slower
Smooth: ${request.smooth}
Output processed video URL. Return JSON with processedUrl, aiModel, localProcessing, processingTime.`;

      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'slow-motion-1.0',
          prompt,
          stream: false,
          format: 'json',
        }),
      });

      if (!response.ok) {
        throw new Error(`Slow motion processing failed: ${response.status}`);
      }

      const data = await response.json();
      const res: AIProcessingResult = {
        success: true,
        processedUrl: data.processedUrl || request.sourceUrl,
        aiModel: 'slow-motion-1.0',
        localProcessing: true,
        processingTime: Date.now() - startTime,
        data,
      };
      setResult(res);
      return res;
    } catch (error) {
      const res: AIProcessingResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime,
      };
      setResult(res);
      return res;
    } finally {
      setProcessing(false);
    }
  }, []);

  const enhanceSpeed = useCallback(async (request: EnhanceSpeedRequest): Promise<AIProcessingResult> => {
    const startTime = Date.now();
    setProcessing(true);
    setResult(null);

    try {
      const prompt = `Apply slow motion enhancement to video at ${request.sourceUrl}.
Target FPS: ${request.targetFps}
Interpolation: ${request.interpolation}
Output processed video URL. Return JSON with processedUrl, aiModel, localProcessing, processingTime.`;

      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'slow-motion-1.0',
          prompt,
          stream: false,
          format: 'json',
        }),
      });

      if (!response.ok) {
        throw new Error(`Slow motion enhancement failed: ${response.status}`);
      }

      const data = await response.json();
      const res: AIProcessingResult = {
        success: true,
        processedUrl: data.processedUrl || request.sourceUrl,
        aiModel: 'slow-motion-1.0',
        localProcessing: true,
        processingTime: Date.now() - startTime,
        data,
      };
      setResult(res);
      return res;
    } catch (error) {
      const res: AIProcessingResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime,
      };
      setResult(res);
      return res;
    } finally {
      setProcessing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setProcessing(false);
  }, []);

  return { processSlowMotion, enhanceSpeed, processing, result, reset };
}