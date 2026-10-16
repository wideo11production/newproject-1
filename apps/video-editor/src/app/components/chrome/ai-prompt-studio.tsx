// ============================================================================
// AI PROMPT STUDIO - FLOATING ON-TOP AI CHAT WINDOW
// ============================================================================
//
// Hinglish: Ye ek premium floating AI prompt window hai jo video-editor
// ke upper floating hota hai (z-index: 50), backdrop blur ke saath, jise user
// local Ollama models ke saath direct AI interactions kar sake. Ye ek premium
// feature hai jo editor ke andar se agar chahe to show ho sakti hai.
//
// YE NIA NEW COMPONENT -- Use only when user wants prompt interface
// ****************************************************************************

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Textarea } from '@wideo11/ui/textarea';
import type { TimelineClip } from '../../lib/engine/types';

interface AIPromptStudioProps {
  isOpen: boolean;
  onClose: () => void;
  currentClip: TimelineClip | null;
  timelineTime: number;
}

export function AIPromptStudio({ isOpen, onClose, currentClip, timelineTime }: AIPromptStudioProps) {
  const [prompt, setPrompt] = useState<string>('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; content: string; timestamp: number }>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Ollama connection configuration
  const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/api/generate';
  const OLLAMA_MODELS = ['llama3']; // local model pulled into the named volume

  // Check Ollama status on mount
  useEffect(() => {
    const checkOllamaStatus = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch('http://127.0.0.1:11434/api/tags', {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (data.models && data.models.length > 0) {
            setOllamaStatus('online');
            console.log('✅ Ollama AI Online with models:', data.models.map((m: any) => m.name).join(', '));
          } else {
            setOllamaStatus('offline');
          }
        } else {
          setOllamaStatus('offline');
        }
      } catch (error) {
        console.log('❌ Ollama AI Offline:', error instanceof Error ? error.message : String(error));
        setOllamaStatus('offline');
      }
    };

    checkOllamaStatus();
    // Refresh status every 30 seconds
    const interval = setInterval(checkOllamaStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isProcessing || ollamaStatus !== 'online') return;

    const userMessage = {
      role: 'user' as const,
      content: prompt,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setPrompt('');
    setIsProcessing(true);

    try {
      // Prepare context for AI prompt
      const contextInfo = {
        clipInfo: currentClip
          ? {
              id: currentClip.id,
              name: currentClip.mediaName,
              duration: currentClip.duration,
              startTime: currentClip.startTime,
              type: currentClip.type,
            }
          : null,
        timelineTime: timelineTime,
        projectInfo: {
          timestamp: new Date().toISOString(),
          user: 'advchashampalup@gmail.com', // superadmin
          role: 'superadmin',
        },
      };

      const systemPrompt = `
You are an advanced video editor AI assistant with access to local Ollama models. 
Context: Timeline: ${contextInfo.timelineTime}s, Clip: ${contextInfo.clipInfo?.name || 'None'}

You can help with:
- Video generation and editing commands
- Timeline operations
- Effects application
- Export settings
- Analysis and suggestions

Respond with actionable commands that can be executed locally. 

User Command: ${prompt}

Execute locally with no API costs:
      `;

      const requestPayload = {
        model: OLLAMA_MODELS[0], // Use first available model
        prompt: systemPrompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 1024,
          num_ctx: 4096,
          num_gpu: -1, // force CPU/GPU balance
        },
        format: 'json',
      };

const response = await fetch(OLLAMA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();

      const aiMessage = {
        role: 'ai' as const,
        content: data.response || 'No response from AI model',
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, aiMessage]);

    } catch (error) {
      console.error('AI Processing Error:', error);
      const errorMessage = {
        role: 'ai' as const,
        content: `❌ Error processing AI request: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure Ollama is running locally.`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  }, [prompt, isProcessing, ollamaStatus, currentClip, timelineTime]);

  const getConnectionStatus = () => {
    // Check if AI services are available
    return {
      online: true,
      model: 'llama3.2:1b',
      local: true,
      cost: '$0'
    };
  };

  const connection = getConnectionStatus();

  const getStatusIcon = () => {
    switch (ollamaStatus) {
      case 'online':
        return <Wifi className="h-3 w-3 text-[#ff6500]" />;
      case 'offline':
        return <WifiOff className="h-3 w-3 text-gray-500" />;
      default:
        return <Loader2 className="h-3 w-3 animate-spin text-gray-500" />;
    }
  };

  const getStatusColor = () => {
    switch (ollamaStatus) {
      case 'online':
        return 'bg-[#ff6500]/10 border border-[#ff6500]/30';
      case 'offline':
        return 'bg-[#2a2a2a] border border-[#2a2a2a]';
      default:
        return 'bg-[#2a2a2a] border border-[#2a2a2a]';
    }
  };

  const getStatusTextColor = () => {
    switch (ollamaStatus) {
      case 'online':
        return 'text-[#ff6500]';
      case 'offline':
        return 'text-gray-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusText = () => {
    switch (ollamaStatus) {
      case 'online':
        return 'Ollama AI Online';
      case 'offline':
        return 'Ollama AI Offline';
      default:
        return 'Checking Ollama...';
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={(e) => e.stopPropagation()}
      />

      {/* AI Prompt Studio Window */}
      <div
        className="relative w-full max-w-4xl h-[600px] rounded-md-edge-strong bg-surface-raised border border-surface-overlay
                   flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-overlay">
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-2 py-1 rounded-full ${getStatusColor()}`}>
              {getStatusIcon()}
              <span className={`text-xs font-medium ${getStatusTextColor()}`}>
                {getStatusText()}
              </span>
            </div>
            <MessageSquare className="h-5 w-5 text-[#ff6500]" />
            <h2 className="text-lg font-semibold text-fg">AI Prompt Studio</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Context Info */}
        {(currentClip || timelineTime > 0) && (
          <div className="px-4 py-2 bg-surface-raised border-b border-surface-overlay">
            <div className="flex items-center gap-4 text-xs text-fg-muted">
              {currentClip && (
                <div className="flex items-center gap-1">
                  <span className="font-medium text-fg">Clip:</span>
                  <span>{currentClip.mediaName}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <span className="font-medium text-fg">Time:</span>
                <span>{timelineTime.toFixed(2)}s</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-medium text-fg">User:</span>
                <span>advchashampalup@gmail.com (superadmin)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-medium text-fg">Role:</span>
                <span>superadmin</span>
              </div>
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-fg-muted">
              <Bot className="h-12 w-12 mb-4" />
              <p className="text-sm">No messages yet. Start your first AI prompt!</p>
              <p className="text-xs mt-1">Local Ollama AI is ready for commands.</p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.timestamp}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-3 rounded-md text-sm font-medium transition-all ${message.role === 'user'
                    ? 'bg-[#ff6500] text-white rounded-br-none'
                    : 'bg-[#1a1a1a] text-gray-300 rounded-bl-none border border-[#2a2a2a]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {message.role === 'user' ? (
                      <User className="h-3 w-3" />
                    ) : (
                      <Bot className="h-3 w-3" />
                    )}
                    <span className="text-xs opacity-70">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">
                    {message.content}
                  </p>
                </div>
              </div>
            ))
          )
          }
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-surface-overlay bg-surface-raised">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Textarea
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              placeholder="Enter your AI command... (e.g., 'add motion blur to this clip', 'convert to 60fps', 'apply chroma key with green screen')"
              className="flex-1 min-h-[44px] max-h-32 resize-none"
              disabled={isProcessing || ollamaStatus !== 'online'}
            />
            <Button
              type="submit"
              disabled={!prompt.trim() || isProcessing || ollamaStatus !== 'online'}
              className="self-end h-11 px-6"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>

          {ollamaStatus !== 'online' && (
            <div className="mt-3 p-3 rounded-md bg-[#2a2a2a] border border-[#2a2a2a]">
              <p className="text-xs text-gray-400">
                ⚠️ Ollama AI is not running. Please start Ollama locally:
                <code className="block mt-1 p-1 bg-[#1a1a1a] rounded text-xs text-gray-300">
                  docker run -d -p 11434:11434 --name ollama ollama/ollama:latest -v ollama-models:/root/.ollama
                </code>
              </p>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>Local Ollama AI processing — no API costs</span>
            <span>Models: {OLLAMA_MODELS.join(', ')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
