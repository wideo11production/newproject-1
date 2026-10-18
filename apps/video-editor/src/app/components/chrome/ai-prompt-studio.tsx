// ============================================================================
// AI PROMPT STUDIO - BORDERLESS FLOATING ON-TOP AI CHAT WINDOW
// ============================================================================
//
// Hinglish: Ye ek premium floating AI prompt window hai jo video-editor
// ke upper floating hota hai (z-index: 50), backdrop blur ke saath. User
// natural language prompts likhta hai (e.g. "remove background", "add water
// ripple", "save as template") aur AI usse automatically timeline clips par
// apply karta hai.
//
// YE CONNECTS AI TO TIMELINE - prompts actually edit clips, not just advice.
//
// ---- BORDERLESS STYLING MANDATE ----
// Hinglish: Saare horizontal/vertical wireframe borders, gray lines, aur cell
// dividers hata diye gaye hain. Panels flush rehte hain soft medium rounded
// contours (rounded-md) mein. Port 3000 palette ka use karta hai:
//   - Charcoal #161616 (sidebars, component blocks)
//   - Slate Gray #1e1e1e (timelines, metrics grids)
//   - Signature solid orange-red accent #ff6500 (active components, 150ms state changes)
//
// ---- SUPERADMIN GATING ----
// Hinglish: Root checking array continuously evaluate karta hai ki kya user
// 'advchashampalup@gmail.com' hai. Agar haan, superadmin role milta hai aur
// green blinking pulse indicator dot live rehta hai.
//
// ============================================================================

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2, Wifi, WifiOff, Zap, Edit3, Save, Play, Video, Wand2 } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Textarea } from '@wideo11/ui/textarea';
import { SuperadminPulseIndicator } from '@wideo11/ui/superadmin-pulse';
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
  /** Current user email for superadmin gating check. */
  userEmail?: string;
  /** Current user role for superadmin gating check. */
  userRole?: string;
}

// Hinglish: Borderless styling tokens - Charcoal #161616 + Slate Gray #1e1e1e palette
const PANEL_BG = '#161616';        // Charcoal - main panel background
const PANEL_HEADER_BG = '#1e1e1e'; // Slate Gray - header/section backgrounds
const ACCENT = '#ff6500';          // Signature orange-red accent
const ACCENT_DARK = '#e05500';     // One step darker for hover
const BORDER_SUBTLE = '#2a2a2a';   // ONLY for accent context, not wireframe dividers

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
  userEmail,
  userRole,
}: AIPromptStudioProps) {
  const [prompt, setPrompt] = useState<string>('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; content: string; timestamp: number }>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [lastCommand, setLastCommand] = useState<ParsedCommand | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
    void messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
              user: userEmail ?? 'advchashampalup@gmail.com',
              role: userRole ?? 'superadmin',
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
    [prompt, isProcessing, ollamaStatus, currentClip, timelineTime, allClipIds, executeCommand, userEmail, userRole]
  );

  if (!isOpen) return null;

  const targetDisplayName = panelClip?.mediaName || (allClipIds()[0] ? 'first clip on timeline' : 'no clips');

  // Hinglish: Admin Pass - root checking array continuously evaluates user email
  const isRootSuperadmin = (userEmail ?? '').toLowerCase().trim() === 'advchashampalup@gmail.com';

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

      {/* AI Prompt Studio Window — BORDERLESS, padded panels, rounded-md, #ff6500 accent */}
      <div
        className="relative flex flex-col shadow-2xl overflow-hidden"
        style={{
          width: 420,
          height: 520,
          minWidth: 300,
          minHeight: 320,
          maxWidth: 700,
          maxHeight: 700,
          backgroundColor: PANEL_BG,
          borderRadius: '0.375rem',
          border: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — flush, no top border, green pulse dot for superadmin */}
        <div
          className="flex items-center justify-between px-4 py-3 transition-colors duration-150"
          style={{
            backgroundColor: PANEL_HEADER_BG,
            borderBottom: 'none',
          }}
        >
          <div className="flex items-center gap-3">
            {/* Hinglish: Green blinking pulse indicator dot — continuously checks
                user login profile 'advchashampalup@gmail.com' as global root 'superadmin' */}
            <SuperadminPulseIndicator
              email={userEmail}
              role={userRole}
              size="sm"
            />
            <div className="flex items-center gap-2 px-2 py-1 rounded-full" style={{ backgroundColor: `${ACCENT}/10` }}>
              <Wifi className="h-3 w-3" style={{ color: ACCENT }} />
              <span
                className="text-xs font-medium"
                style={{ color: ollamaStatus === 'online' ? ACCENT : '#9fa7b3' }}
              >
                {ollamaStatus === 'online' ? 'Ollama AI Online' : 'Ollama AI Offline'}
              </span>
            </div>
            <MessageSquare className="h-5 w-5" style={{ color: ACCENT }} />
            <h2 className="text-lg font-semibold text-white">AI Prompt Studio</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-white transition-colors duration-150"
            style={{ backgroundColor: PANEL_HEADER_BG }}
            onMouseEnter={(e) => { (e.currentTarget.style.backgroundColor = `${ACCENT}/20`); }}
            onMouseLeave={(e) => { (e.currentTarget.style.backgroundColor = PANEL_HEADER_BG); }}
          >
            <X className="h-5 w-5" style={{ color: ACCENT }} />
          </button>
        </div>

        {/* Target Clip Info — flush, no border */}
        <div
          className="px-4 py-2"
          style={{ backgroundColor: PANEL_BG, borderBottom: 'none' }}
        >
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="font-medium text-gray-300">Target:</span>
            <span className="truncate text-white">{targetDisplayName}</span>
            <span className="ml-auto text-[8px]" style={{ color: ACCENT }}>✓ AI Active</span>
          </div>
        </div>

        {/* Last Command Feedback — borderless */}
        {lastCommand && (
          <div
            className="px-4 py-2"
            style={{ backgroundColor: PANEL_HEADER_BG, borderBottom: 'none' }}
          >
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" style={{ color: ACCENT }} />
              <span className="text-xs font-medium" style={{ color: `${ACCENT}/90` }}>
                {lastCommand.description}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">{lastCommand.sourcePrompt}</p>
          </div>
        )}

        {/* Messages Area — borderless scrollable pane */}
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
                  className="max-w-xs lg:max-w-md px-4 py-3 text-sm font-medium transition-all duration-150"
                  style={{
                    borderRadius: '0.375rem',
                    backgroundColor: message.role === 'user' ? ACCENT : PANEL_BG,
                    color: message.role === 'user' ? 'white' : '#e8e8e8',
                    border: 'none',
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {message.role === 'user' ? (
                      <User className="h-3 w-3" />
                    ) : (
                      <Bot className="h-3 w-3" style={{ color: ACCENT }} />
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

        {/* Input Area — flush at bottom, no top border */}
        <div
          className="p-4"
          style={{ backgroundColor: PANEL_BG, borderTop: 'none' }}
        >
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
              className="flex-1 min-h-[44px] max-h-32 resize-none rounded-md border-0 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-600 focus-visible:outline-none focus-visible:ring-2 transition-colors duration-150"
              style={{
                backgroundColor: PANEL_HEADER_BG,
                '--tw-ring-color': `${ACCENT}/30`,
              } as React.CSSProperties}
              disabled={isProcessing || ollamaStatus !== 'online'}
            />
            <Button
              type="submit"
              disabled={!prompt.trim() || isProcessing || ollamaStatus !== 'online'}
              className="self-end h-11 px-6 rounded-md font-medium text-white transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: ACCENT,
                border: 'none',
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = ACCENT_DARK;
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = ACCENT;
              }}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>

          {ollamaStatus !== 'online' && (
            <div className="mt-3 p-3 rounded-md" style={{ backgroundColor: PANEL_HEADER_BG, border: 'none' }}>
              <p className="text-xs text-gray-400">
                ⚠️ Ollama AI is not running. Please start Ollama locally:
                <code className="block mt-1 p-1 rounded text-xs text-gray-300" style={{ backgroundColor: PANEL_BG }}>
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
