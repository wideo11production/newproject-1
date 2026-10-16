// ============================================================================
// AI PROMPT STUDIO - FLOATING ON-TOP AI CHAT WINDOW
// ============================================================================
//
// Hinglish: Ye ek premium floating AI prompt window hai jo video-editor
// ke upper floating hota hai (z-index: 50), backdrop blur ke saath. User
// natural language prompts likhta hai (e.g. "remove background", "add water
// ripple", "save as template") aur AI usse automatically timeline clips par
// apply karta hai.
//
// YE CONNECTS AI TO TIMELINE - prompts actually edit clips, not just advice.
// ============================================================================

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2, Wifi, WifiOff, Zap, Edit3, Save, Play, Video, Wand2 } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Textarea } from '@wideo11/ui/textarea';
import type { TimelineClip, TimelineTrack, VideoEffect } from '../../lib/engine/types';
import { parseAICommand, buildVideoEffect, AI_COMMAND_EXAMPLES, type ParsedCommand } from '../../lib/engine/effects/ai-command-parser';
import { createTemplateStore, clipToTemplate, BUILTIN_TEMPLATES, type TemplateStore } from '../../lib/engine/effects/template-system';

interface AIPromptStudioProps {
  isOpen: boolean;
  onClose: () => void;
  currentClip: TimelineClip | null;
  timelineTime: number;
  /** The clip currently selected on the timeline (for applying effects). */
  panelClip: TimelineClip | null;
  /** All tracks - needed to find clip by ID and apply effects. */
  tracks: TimelineTrack[];
  /** Update a clip on the timeline (from video-editor.tsx). */
  patchClip: (clipId: string, p: Partial<TimelineClip>, coalesceKey?: string) => void;
  /** Show a toast notification. */
  setToast: (msg: string) => void;
  /** Select a clip on the timeline. */
  setSelect: (ids: string[]) => void;
}

export function AIPromptStudio({
  isOpen,
  onClose,
  currentClip,
  timelineTime,
  panelClip,
  tracks,
  patchClip,
  setToast,
  setSelect,
}: AIPromptStudioProps) {
  const [prompt, setPrompt] = useState<string>('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; content: string; timestamp: number }>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [lastCommand, setLastCommand] = useState<ParsedCommand | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Template store (singleton for this session)
  const templateStoreRef = useRef<TemplateStore | null>(null);
  if (!templateStoreRef.current) templateStoreRef.current = createTemplateStore();
  const templateStore = templateStoreRef.current;

  // Seed built-in templates on first mount
  useEffect(() => {
    const existing = templateStore.getAllTemplates();
    if (existing.length === 0) {
      for (const t of BUILTIN_TEMPLATES) {
        templateStore.addTemplate(t);
      }
    }
  }, []);

  // Ollama connection configuration
  const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/api/generate';
  const OLLAMA_MODELS = ['llama3'];

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
          } else {
            setOllamaStatus('offline');
          }
        } else {
          setOllamaStatus('offline');
        }
      } catch {
        setOllamaStatus('offline');
      }
    };

    checkOllamaStatus();
    const interval = setInterval(checkOllamaStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** Get all clip IDs across all tracks for command targeting. */
  const allClipIds = useCallback(() => {
    return tracks.flatMap((t) => t.clips.map((c) => c.id));
  }, [tracks]);

  /** Find a clip by ID across all tracks. */
  const findClip = useCallback(
    (clipId: string): TimelineClip | null => {
      for (const t of tracks) {
        const c = t.clips.find((x) => x.id === clipId);
        if (c) return c;
      }
      return null;
    },
    [tracks]
  );

  /** Apply a parsed command to the timeline. */
  const executeCommand = useCallback(
    async (cmd: ParsedCommand, userPrompt: string) => {
      const clipIds = allClipIds();
      if (clipIds.length === 0) {
        setToast('No clips on timeline. Import a video first, then try again.');
        return;
      }

      // Determine target clip: use selected panelClip, or first available
      const targetClipId = panelClip?.id || clipIds[0];
      const targetClip = findClip(targetClipId);
      if (!targetClip) {
        setToast('Selected clip not found on timeline.');
        return;
      }

      switch (cmd.action) {
        case 'apply-effect': {
          if (!cmd.effectType) break;
          const effect = buildVideoEffect(cmd.effectType, cmd.params || {}, userPrompt);
          const nextEffects = [...(targetClip.videoEffects ?? []), effect];
          patchClip(targetClip.id, { videoEffects: nextEffects }, `ai-effect:${cmd.effectType}`);
          setLastCommand(cmd);
          setToast(`✅ ${cmd.description} applied to "${targetClip.mediaName}"`);
          break;
        }

        case 'remove-effect': {
          patchClip(targetClip.id, { videoEffects: [] }, 'ai-remove-effect');
          setLastCommand(cmd);
          setToast(`✅ All effects removed from "${targetClip.mediaName}"`);
          break;
        }

        case 'create-template': {
          const tpl = clipToTemplate(targetClip, `AI Template ${Date.now()}`, undefined);
          const id = templateStore.addTemplate(tpl);
          setLastCommand(cmd);
          setToast(`✅ Template "${tpl.name}" saved (${id.slice(-6)})`);
          break;
        }

        case 'apply-template': {
          const allTemplates = templateStore.getAllTemplates();
          if (allTemplates.length === 0) {
            setToast('No templates saved yet. Say "save as template" first.');
            return;
          }
          // Apply the most recent template
          const latest = allTemplates[allTemplates.length - 1];
          const updatedClip = templateStore.applyTemplate(latest.id, targetClip);
          patchClip(updatedClip.id, {
            transform: updatedClip.transform,
            filter: updatedClip.filter,
            videoEffects: updatedClip.videoEffects ?? [],
            effects: updatedClip.effects,
            opacity: updatedClip.opacity,
            speed: updatedClip.speed,
          }, `ai-template:${latest.id}`);
          setLastCommand(cmd);
          setToast(`✅ Template "${latest.name}" applied to "${targetClip.mediaName}"`);
          break;
        }

        case 'info': {
          setLastCommand(cmd);
          const examples = AI_COMMAND_EXAMPLES.map((e) => `• "${e.prompt}" → ${e.result}`).join('\n');
          setToast(cmd.description);
          // Also add info as AI message
          setMessages((prev) => [
            ...prev,
            { role: 'ai', content: `Available AI commands:\n${examples}\n\nTry any of these in the chat box!`, timestamp: Date.now() },
          ]);
          return;
        }

        default: {
          setLastCommand(cmd);
          setToast(cmd.description);
          break;
        }
      }
    },
    [allClipIds, panelClip, findClip, patchClip, setToast, templateStore]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!prompt.trim() || isProcessing || ollamaStatus !== 'online') return;

      const userMessage = {
        role: 'user' as const,
        content: prompt,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setPrompt('');
      setIsProcessing(true);

      try {
        // Parse the AI command
        const clipIds = allClipIds();
        const cmd = parseAICommand(prompt, clipIds);

        // Execute the command on the timeline
        await executeCommand(cmd, prompt);

        // Also get Ollama's conversational response for context
        try {
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
            timelineTime,
            projectInfo: {
              timestamp: new Date().toISOString(),
              user: 'advchashampalup@gmail.com',
              role: 'superadmin',
            },
          };

          const systemPrompt = `
You are an advanced video editor AI assistant. The user just said: "${prompt}".
I have already executed the command on the timeline: ${cmd.description}.
Context: Timeline ${contextInfo.timelineTime}s, Clip: ${contextInfo.clipInfo?.name || 'None'}.

Respond in a helpful, friendly way. Confirm what was done and suggest next steps.
Keep it short (2-3 sentences). Write in English but you can use Hinglish terms if natural.
`;

          const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama3',
              prompt: systemPrompt,
              stream: false,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            const aiReply = data.response || 'Command executed successfully.';
            setMessages((prev) => [
              ...prev,
              { role: 'ai', content: aiReply, timestamp: Date.now() },
            ]);
          }
        } catch {
          // Ollama conversational reply is optional - command already executed
          setMessages((prev) => [
            ...prev,
            { role: 'ai', content: '✅ Command executed on timeline. The effect should now be visible in the preview.', timestamp: Date.now() },
          ]);
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [prompt, isProcessing, ollamaStatus, currentClip, timelineTime, allClipIds, executeCommand]
  );

  if (!isOpen) return null;

  const targetDisplayName = panelClip?.mediaName || (allClipIds()[0] ? 'first clip on timeline' : 'no clips');

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
        className="relative rounded-md bg-[#1a1a1a] border border-[#2a2a2a] flex flex-col shadow-2xl overflow-hidden"
        style={{ width: 420, height: 520, minWidth: 300, minHeight: 320, maxWidth: 700, maxHeight: 700 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-[#2a2a2a]/50 hover:bg-[#ff6500]/30"
        />

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-[#ff6500]/10 border border-[#ff6500]/30">
              <Wifi className="h-3 w-3 text-[#ff6500]" />
              <span className={`text-xs font-medium ${ollamaStatus === 'online' ? 'text-[#ff6500]' : 'text-gray-500'}`}>
                {ollamaStatus === 'online' ? 'Ollama AI Online' : 'Ollama AI Offline'}
              </span>
            </div>
            <MessageSquare className="h-5 w-5 text-[#ff6500]" />
            <h2 className="text-lg font-semibold text-white">AI Prompt Studio</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md bg-[#2a2a2a] text-[#ff6500] hover:bg-[#ff6500]/20 hover:text-[#ff6500] transition-colors border border-transparent hover:border-[#ff6500]/40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Target Clip Info */}
        <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#2a2a2a]">
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="font-medium text-gray-300">Target:</span>
            <span className="truncate text-white">{targetDisplayName}</span>
            <span className="ml-auto text-[8px] text-[#ff6500]">✓ AI Active</span>
          </div>
        </div>

        {/* Last Command Feedback */}
        {lastCommand && (
          <div className="px-4 py-2 border-b border-[#2a2a2a] bg-[#2a2a2a]/30">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#ff6500]" />
              <span className="text-xs text-[#ff6500]/90 font-medium">
                {lastCommand.description}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">{lastCommand.sourcePrompt}</p>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Bot className="h-12 w-12 mb-4 text-gray-500" />
              <p className="text-sm text-gray-300">No messages yet. Start your first AI prompt!</p>
              <p className="text-xs mt-1 text-gray-500">Local Ollama AI is ready for commands.</p>
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
                    : 'bg-[#1a1a1a] text-white rounded-bl-none border border-[#2a2a2a]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {message.role === 'user' ? (
                      <User className="h-3 w-3" />
                    ) : (
                      <Bot className="h-3 w-3" />
                    )}
                    <span className="text-xs text-white/90">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-[#2a2a2a] bg-[#1a1a1a]">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Textarea
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (prompt.trim() && !isProcessing && ollamaStatus === 'online') {
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }
              }}
              placeholder="Enter your AI command... (e.g., 'remove background', 'add water ripple', 'save as template')"
              className="flex-1 min-h-[44px] max-h-32 resize-none rounded-md border-0 bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-white placeholder:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/30"
              disabled={isProcessing || ollamaStatus !== 'online'}
            />
            <Button
              type="submit"
              disabled={!prompt.trim() || isProcessing || ollamaStatus !== 'online'}
              className="self-end h-11 px-6 rounded-md bg-[#ff6500] font-medium text-white hover:bg-[#e55a00] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
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
