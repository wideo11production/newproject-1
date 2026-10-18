'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { FrameTemplate, TimelineClip, TimelineTrack } from '../lib/engine/types';

interface PanelClipData {
  id: string;
  mediaName?: string;
  duration: number;
}

interface EditorOverlayState {
  showFrameTemplateEditor: boolean;
  showAIPromptStudio: boolean;
  showAuraStudio: boolean;
  frameTemplateClipId: string | null;
  activeFrameTemplate: FrameTemplate | null;
  activeFrameIndex: number;
  canOpenFrameTemplate: boolean;
  setCanOpenFrameTemplate: (v: boolean) => void;
}

interface EditorOverlayContext extends EditorOverlayState {
  showFrameTemplateEditor: boolean;
  showAIPromptStudio: boolean;
  showAuraStudio: boolean;
  frameTemplateClipId: string | null;
  activeFrameTemplate: FrameTemplate | null;
  activeFrameIndex: number;
  canOpenFrameTemplate: boolean;
  tracks: TimelineTrack[];
  panelClip: PanelClipData | null;
  playheadSeconds: number;
  fps: number;
  projectName: string;
  panelClipDuration: number;
  session: {
    isSuperAdmin: boolean;
    email: string;
    role: string;
    maxFps: number;
    plan: string;
  };
  isAIPromptStudioEnabled: boolean;
  isAuraStudioEnabled: boolean;
  openFrameTemplateEditor: () => void;
  closeFrameTemplateEditor: () => void;
  openAIPromptStudio: () => void;
  closeAIPromptStudio: () => void;
  toggleAuraStudio: () => void;
  toggleAIPromptStudio: () => void;
  setShowFrameTemplateEditor: (v: boolean) => void;
  setShowAIPromptStudio: (v: boolean) => void;
  setShowAuraStudio: (v: boolean) => void;
  setFrameTemplateClipId: (id: string | null) => void;
  setActiveFrameTemplate: (t: FrameTemplate | null) => void;
  setActiveFrameIndex: (i: number) => void;
  patchClip: (clipId: string, p: Partial<TimelineClip>, coalesceKey?: string) => void;
  setToast: (msg: string) => void;
  setSelect: (ids: string[]) => void;
  _videoEditorInternal: {
    setTracks: (tracks: TimelineTrack[]) => void;
    setPanelClip: (c: PanelClipData | null) => void;
    setPlayheadSeconds: (s: number) => void;
    setFps: (f: number) => void;
    setProjectName: (n: string) => void;
    setPanelClipDuration: (d: number) => void;
    setCanOpenFrameTemplate: (v: boolean) => void;
    setPatchClip: (fn: (clipId: string, p: Partial<TimelineClip>, coalesceKey?: string) => void) => void;
    setSetToast: (fn: (msg: string) => void) => void;
    setSetSelect: (fn: (ids: string[]) => void) => void;
    setPatch: (fn: (p: Partial<{ fps: number }>) => void) => void;
  };
}

const EditorOverlayContext = createContext<EditorOverlayContext | null>(null);

export function useEditorOverlay() {
  const ctx = useContext(EditorOverlayContext);
  if (!ctx) {
    throw new Error('useEditorOverlay must be used within EditorOverlayProvider');
  }
  return ctx;
}

interface EditorOverlayProviderProps {
  children: ReactNode;
  initialSession: {
    isSuperAdmin: boolean;
    email: string;
    role: string;
    maxFps: number;
    plan: string;
  };
}

export function EditorOverlayProvider({ children, initialSession }: EditorOverlayProviderProps) {
  // Toggle state (managed by provider, consumed by both VideoEditor and PageLayout)
  const [showFrameTemplateEditor, setShowFrameTemplateEditor] = useState(false);
  const [showAIPromptStudio, setShowAIPromptStudio] = useState(false);
  const [showAuraStudio, setShowAuraStudio] = useState(false);
  const [frameTemplateClipId, setFrameTemplateClipId] = useState<string | null>(null);
  const [activeFrameTemplate, setActiveFrameTemplate] = useState<FrameTemplate | null>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [canOpenFrameTemplate, setCanOpenFrameTemplate] = useState(false);

  // Data state (populated by VideoEditor via _videoEditorInternal)
  const [tracks, setTracks] = useState<TimelineTrack[]>([]);
  const [panelClip, setPanelClip] = useState<PanelClipData | null>(null);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [fps, setFps] = useState(30);
  const [projectName, setProjectName] = useState('Untitled');
  const [panelClipDuration, setPanelClipDuration] = useState(5);
  const [patchClipImpl, setPatchClipImpl] = useState<(clipId: string, p: Partial<TimelineClip>, coalesceKey?: string) => void>(() => () => {});
  const [setToastImpl, setSetToastImpl] = useState<(msg: string) => void>(() => () => {});
  const [setSelectImpl, setSetSelectImpl] = useState<(ids: string[]) => void>(() => () => {});
  const [patchImpl, setPatchImpl] = useState<(p: Partial<{ fps: number }>) => void>(() => () => {});

  // Superadmin identity lock for advchashampalup@gmail.com
  const session = useMemo(
    () => ({
      isSuperAdmin:
        initialSession.email?.toLowerCase().trim() === 'advchashampalup@gmail.com' ||
        initialSession.role === 'superadmin' ||
        initialSession.isSuperAdmin,
      email: initialSession.email,
      role: initialSession.email?.toLowerCase().trim() === 'advchashampalup@gmail.com'
        ? 'superadmin'
        : initialSession.role,
      maxFps: initialSession.maxFps,
      plan: initialSession.plan,
    }),
    [initialSession]
  );

  const isAuraStudioEnabled = process.env.NEXT_PUBLIC_AURA_MICRO_FRAME_STUDIO_ENABLED === 'true';
  const isAIPromptStudioEnabled =
    process.env.NEXT_PUBLIC_AI_PROMPT_STUDIO_ENABLED === 'true' ||
    process.env.NEXT_PUBLIC_AURA_MICRO_FRAME_STUDIO_ENABLED === 'true';

  const openFrameTemplateEditor = useCallback(() => {
    if (canOpenFrameTemplate) {
      setShowFrameTemplateEditor(true);
    }
  }, [canOpenFrameTemplate]);

  const closeFrameTemplateEditor = useCallback(() => setShowFrameTemplateEditor(false), []);
  const openAIPromptStudio = useCallback(() => setShowAIPromptStudio(true), []);
  const closeAIPromptStudio = useCallback(() => setShowAIPromptStudio(false), []);
  const toggleAuraStudio = useCallback(() => setShowAuraStudio((o) => !o), []);
  const toggleAIPromptStudio = useCallback(() => setShowAIPromptStudio((o) => !o), []);

  const ctxValue: EditorOverlayContext = useMemo(
    () => ({
      showFrameTemplateEditor,
      showAIPromptStudio,
      showAuraStudio,
      frameTemplateClipId,
      activeFrameTemplate,
      activeFrameIndex,
      canOpenFrameTemplate,
      setCanOpenFrameTemplate,
      tracks,
      panelClip,
      playheadSeconds,
      fps,
      projectName,
      panelClipDuration,
      session,
      isAIPromptStudioEnabled,
      isAuraStudioEnabled,
      openFrameTemplateEditor,
      closeFrameTemplateEditor,
      openAIPromptStudio,
      closeAIPromptStudio,
      toggleAuraStudio,
      toggleAIPromptStudio,
      setShowFrameTemplateEditor,
      setShowAIPromptStudio,
      setShowAuraStudio,
      setFrameTemplateClipId,
      setActiveFrameTemplate,
      setActiveFrameIndex,
      patchClip: patchClipImpl,
      setToast: setToastImpl,
      setSelect: setSelectImpl,
      _videoEditorInternal: {
        setTracks,
        setPanelClip,
        setPlayheadSeconds,
        setFps,
        setProjectName,
        setPanelClipDuration,
        setPatchClip: setPatchClipImpl,
        setSetToast: setSetToastImpl,
        setSetSelect: setSetSelectImpl,
        setPatch: setPatchImpl,
        setCanOpenFrameTemplate,
      },
    }),
    [
      showFrameTemplateEditor, showAIPromptStudio, showAuraStudio,
      frameTemplateClipId, activeFrameTemplate, activeFrameIndex, canOpenFrameTemplate,
      tracks, panelClip, playheadSeconds, fps, projectName, panelClipDuration,
      session, isAIPromptStudioEnabled, isAuraStudioEnabled,
      openFrameTemplateEditor, closeFrameTemplateEditor, openAIPromptStudio,
      closeAIPromptStudio, toggleAuraStudio, toggleAIPromptStudio,
      setShowFrameTemplateEditor, setShowAIPromptStudio, setShowAuraStudio,
      setFrameTemplateClipId, setActiveFrameTemplate, setActiveFrameIndex,
      setCanOpenFrameTemplate,
      patchClipImpl, setToastImpl, setSelectImpl,
      setTracks, setPanelClip, setPlayheadSeconds, setFps, setProjectName, setPanelClipDuration,
      setPatchClipImpl, setSetToastImpl, setSetSelectImpl, setPatchImpl,
    ]
  );

  return <EditorOverlayContext.Provider value={ctxValue}>{children}</EditorOverlayContext.Provider>;
}
