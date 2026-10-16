import { useState, useCallback } from 'react';
import { AIProcessor } from '../../../tools/ai-features/ai-services';
import type { 
  StabilizationRequest, 
  ChromaKeyRequest, 
  MotionTrackingRequest, 
  SlowMotionRequest,
  AIResponse 
} from '../../../tools/ai-features/implementation';

export function useAIStabilization() {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);
  const processor = new AIProcessor();

  const stabilize = useCallback(async (request: StabilizationRequest) => {
    setProcessing(true);
    try {
      const response = await processor.process({ ...request, type: 'stabilization' });
      setResult(response);
      return response;
    } finally {
      setProcessing(false);
    }
  }, [processor]);

  return { stabilize, processing, result, reset: () => setResult(null) };
}

export function useAIChromaKey() {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);
  const processor = new AIProcessor();

  const applyChromaKey = useCallback(async (request: ChromaKeyRequest) => {
    setProcessing(true);
    try {
      const response = await processor.process({ ...request, type: 'chroma' });
      setResult(response);
      return response;
    } finally {
      setProcessing(false);
    }
  }, [processor]);

  return { applyChromaKey, processing, result, reset: () => setResult(null) };
}

export function useAIMotionTracking() {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);
  const processor = new AIProcessor();

  const trackObject = useCallback(async (request: MotionTrackingRequest) => {
    setProcessing(true);
    try {
      const response = await processor.process({ ...request, type: 'motion-tracking' });
      setResult(response);
      return response;
    } finally {
      setProcessing(false);
    }
  }, [processor]);

  return { trackObject, processing, result, reset: () => setResult(null) };
}

export function useAISlowMotion() {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);
  const processor = new AIProcessor();

  const enhanceSpeed = useCallback(async (request: SlowMotionRequest) => {
    setProcessing(true);
    try {
      const response = await processor.process({ ...request, type: 'slow-motion' });
      setResult(response);
      return response;
    } finally {
      setProcessing(false);
    }
  }, [processor]);

  return { enhanceSpeed, processing, result, reset: () => setResult(null) };
}
