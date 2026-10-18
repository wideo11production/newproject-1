// ============================================================================
// WEB AI PROMPT STUDIO — Borderless floating AI chat dialog (web-adapted)
// ============================================================================
//
// Hinglish: Ye video-editor ke ai-prompt-studio.tsx ka WEB-ADAPTED version hai.
// Video editor use karta hai timeline types (TimelineClip/TimelineTrack) jo
// web app mein nahi hote — isliye ye simplified version banaya gaya hai jo
// web app ke IdentityProvider se user session read karta hai.
//
// BORDERLESS MANDATE:
//   - Saare wireframe borders, gray lines, cell dividers hataaye gaye
//   - Panels flush rounded-md contours mein: Charcoal #161616 + Slate Gray #1e1e1e
//   - Signature orange-red #ff6500 accent, 150ms state transitions
//
// SUPERADMIN GATING:
//   - continuously evaluates 'advchashampalup@gmail.com' as root 'superadmin'
//   - green blinking pulse indicator dot live rehta hai
//   - useSessionIdentity() se email + isSuperadmin read hota hai
// ============================================================================

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Bot,
  User,
  Loader2,
  Wifi,
  Zap,
  Sparkles,
} from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Textarea } from '@wideo11/ui/textarea';
import { SuperadminPulseIndicator } from '@wideo11/ui/superadmin-pulse';
import { useSessionIdentity } from '@/lib/identity-context';

import {
  productPanel,
  productSunken,
  productTextMuted,
  productAccent,
} from '@wideo11/ui/design-system';

// Hinglish: Borderless palette — Charcoal #161616 + Slate Gray #1e1e1e + #ff6500
const PANEL_BG = '#161616';
const PANEL_HEADER_BG = '#1e1e1e';
const ACCENT = '#ff6500';
const ACCENT_DARK = '#e05500';

interface MediaRef {
  id: string;
  filename: string;
  kind: 'video' | 'reel' | 'audio';
}

export interface WebAIPromptStudioProps {
  isOpen: boolean;
  onClose: () => void;
  currentMedia: MediaRef | null;
}

// Hinglish: Lightweight AI command examples jo web app ke liye kaam karte hain
const WEB_AI_COMMANDS = [
  { prompt: 'describe this clip', result: 'info' },
  { prompt: 'generate title', result: 'title' },
  { prompt: 'suggest tags', result: 'tags' },
  { prompt: 'create thumbnail', result: 'thumbnail' },
  { prompt: 'extract audio', result: 'audio' },
];

export function WebAIPromptStudio({
  isOpen,
  onClose,
  currentMedia,
}: WebAIPromptStudioProps) {
  const { email, role, isSuperadmin, _isAuthenticated } = useSessionIdentity();

  // Hinglish: Admin Pass — continuously evaluate 'advchashampalup@gmail.com' as root
  const isRootSuperadmin =
    (email ?? '').toLowerCase().trim() === 'advchashampalup@gmail.com' || isSuperadmin;

  const [prompt, setPrompt] = useState<string>('');
  const [messages, setMessages] = useState<
    Array<{ role: 'user' | 'ai'; content: string; timestamp: number }>
  >([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    void messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = prompt.trim();
      if (!trimmed || isProcessing || !_isAuthenticated) return;

      const userMessage = {
        role: 'user' as const,
        content: trimmed,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setPrompt('');
      setIsProcessing(true);

      try {
        const mediaContext = currentMedia
          ? `clip: ${currentMedia.filename} (${currentMedia.kind})`
          : 'no clip selected';

        const systemPrompt = `
You are an AI video editing assistant on the Wideo11 web platform.
The user said: "${trimmed}".
Current context: ${mediaContext}
User: ${email ?? 'anonymous'} | Role: ${isRootSuperadmin ? 'superadmin' : role}

Respond helpfully. Confirm what you will do and suggest next steps.
Keep it short (2-3 sentences). Hinglish is fine if natural.
`;

        const response = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: systemPrompt,
            model: 'web-studio',
            context: {
              media: currentMedia
                ? {
                    id: currentMedia.id,
                    filename: currentMedia.filename,
                    kind: currentMedia.kind,
                  }
                : null,
              userEmail: email,
              isSuperadmin: isRootSuperadmin,
              timestamp: new Date().toISOString(),
            },
          }),
        });

        let aiReply: string;
        if (response.ok) {
          const data = await response.json();
          aiReply = data.response || 'Command processed.';
        } else {
          // Local fallback — simulate AI response
          aiReply = `✅ Processed: "${trimmed}". ${
            currentMedia
              ? `Targeting "${currentMedia.filename}" for ${trimmed}.`
              : 'Select a media item first for targeted edits.'
          }`;
        }

        setMessages((prev) => [
          ...prev,
          { role: 'ai', content: aiReply, timestamp: Date.now() },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: 'ai',
            content: `✅ Received: "${trimmed}". Connect to AI service for advanced edits.`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsProcessing(false);
      }
    },
    [prompt, isProcessing, _isAuthenticated, email, role, isRootSuperadmin, currentMedia]
  );

  if (!isOpen) return null;

  const targetDisplay = currentMedia ? currentMedia.filename : 'no media selected';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={(e) => e.stopPropagation()}
      />

      {/* AI Prompt Studio Window — BORDERLESS, rounded-md, #ff6500 accent */}
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
        {/* Header — flush, no border, green pulse dot for superadmin */}
        <div
          className="flex items-center justify-between px-4 py-3 transition-colors duration-150"
          style={{
            backgroundColor: PANEL_HEADER_BG,
            borderBottom: 'none',
            border: 'none',
          }}
        >
          <div className="flex items-center gap-3">
            {/* Green blinking pulse indicator — continuously checks root status */}
            <SuperadminPulseIndicator
              email={email}
              role={role}
              isSuperadmin={isSuperadmin}
              size="sm"
            />
            <div
              className="flex items-center gap-2 px-2 py-1 rounded-full"
              style={{ backgroundColor: `${ACCENT}/10` }}
            >
              <Wifi className="h-3 w-3" style={{ color: ACCENT }} />
              <span
                className="text-xs font-medium"
                style={{ color: isRootSuperadmin ? ACCENT : '#9fa7b3' }}
              >
                {isRootSuperadmin ? 'Superadmin AI Online' : 'AI Ready'}
              </span>
            </div>
            <MessageSquare className="h-5 w-5" style={{ color: ACCENT }} />
            <h2 className="text-lg font-semibold text-white">AI Prompt Studio</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-white transition-colors duration-150"
            style={{ backgroundColor: PANEL_HEADER_BG, border: 'none' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = `${ACCENT}/20`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = PANEL_HEADER_BG;
            }}
          >
            <X className="h-5 w-5" style={{ color: ACCENT }} />
          </button>
        </div>

        {/* Target Media Info — borderless */}
        <div
          className="px-4 py-2"
          style={{ backgroundColor: PANEL_BG, borderBottom: 'none', border: 'none' }}
        >
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="font-medium text-gray-300">Target:</span>
            <span className="truncate text-white">{targetDisplay}</span>
            <span className="ml-auto text-[8px]" style={{ color: ACCENT }}>
              ✓ AI Active
            </span>
          </div>
        </div>

        {/* Messages Area — borderless scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Sparkles className="h-12 w-12 mb-4 text-gray-500" />
              <p className="text-sm text-gray-300">
                No messages yet. Start your first AI prompt!
              </p>
              <p className="text-xs mt-1 text-gray-500">
                {WEB_AI_COMMANDS.map((e) => `"${e.prompt}"`).join(' • ')}
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.timestamp}
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className="max-w-xs lg:max-w-md px-4 py-3 text-sm font-medium transition-all duration-150"
                  style={{
                    borderRadius: '0.375rem',
                    backgroundColor:
                      message.role === 'user' ? ACCENT : PANEL_HEADER_BG,
                    color:
                      message.role === 'user' ? 'white' : '#e8e8e8',
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
                  <p className="leading-relaxed whitespace-pre-wrap">
                    {message.content}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area — flush bottom, borderless */}
        <div
          className="p-4"
          style={{ backgroundColor: PANEL_BG, borderTop: 'none', border: 'none' }}
        >
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Textarea
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setPrompt(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (prompt.trim() && !isProcessing && _isAuthenticated) {
                    handleSubmit(
                      e as unknown as React.FormEvent
                    );
                  }
                }
              }}
              placeholder="Enter your AI command... (e.g., 'generate title', 'suggest tags')"
              className="flex-1 min-h-[44px] max-h-32 resize-none rounded-md border-0 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-600 focus-visible:outline-none focus-visible:ring-2 transition-colors duration-150"
              style={{
                backgroundColor: PANEL_HEADER_BG,
                '--tw-ring-color': `${ACCENT}/30`,
              } as React.CSSProperties}
              disabled={isProcessing || !_isAuthenticated}
            />
            <Button
              type="submit"
              disabled={!prompt.trim() || isProcessing || !_isAuthenticated}
              className="self-end h-11 px-6 rounded-md font-medium text-white transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: ACCENT,
                border: 'none',
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled)
                  e.currentTarget.style.backgroundColor = ACCENT_DARK;
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled)
                  e.currentTarget.style.backgroundColor = ACCENT;
              }}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>

          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>AI processing — no API costs on local plans</span>
            {isRootSuperadmin && (
              <span className="flex items-center gap-1 text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse"></span>
                Root privileges active
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
