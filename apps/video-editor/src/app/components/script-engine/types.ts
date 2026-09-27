// Script Engine - shared types aur state
//
// YE FILE KYUN: Purane apps/editor ka content (tools, properties, documents)
// video-editor ke andar migrate hua hai. Ye types SAREE components ka
// single source of truth hain - isse state ek jagah rehta hai aur
// "unified state variables" ka requirement poora hota hai.
//
// Hinglish comments: har block ka arth

/** Ek scene - script ka sabse chhota unit */
export interface Scene {
  id: string;
  /** Scene number (1-based, display ke liye) */
  number: number;
  /** Scene ka title/heading */
  heading: string;
  /** Scene ki location (INT/EXT etc.) */
  location: string;
  /** Dialogue / narration text */
  dialogue: string;
  /** Shot description - visual kya dikhega */
  shot: string;
  /** Scene ki estimated duration (seconds) */
  duration: number;
}

/** Dialogue line - kisi scene ke andar */
export interface DialogueLine {
  id: string;
  sceneId: string;
  character: string;
  text: string;
}

/** Text overlay - video par dikhne wala text (subtitles/title) */
export interface TextLayout {
  id: string;
  content: string;
  /** Vertical position (0-100, screen ka percentage) */
  positionY: number;
  fontSize: number;
  fontWeight: number;
  color: string;
  background: string;
  align: 'left' | 'center' | 'right';
  startTime: number;
  endTime: number;
}

/** Clip transform - video clip ki position/scale/rotation */
export interface ClipTransform {
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
}

/** Editor tool - editor app se migrate hua */
export type EditorTool = 'cut' | 'split' | 'crop' | 'rotate';

/** Active panel - kaun sa document panel khula hai */
export type PanelTab = 'scenes' | 'text' | 'transform' | 'documents';

/** Compiled script document - export hone wala structured output */
export interface CompiledScript {
  title: string;
  compiledAt: string;
  totalScenes: number;
  totalDuration: number;
  totalLines: number;
  wordCount: number;
  /** Plain text export (cue sheet format) */
  text: string;
}

/** Script Engine ka poora state - ek jagah */
export interface ScriptState {
  /** Project title */
  title: string;
  /** Saare scenes */
  scenes: Scene[];
  /** Dialogue lines */
  dialogue: DialogueLine[];
  /** Text overlays */
  textLayouts: TextLayout[];
  /** Selected clip ka transform */
  transform: ClipTransform;
  /** Active tool */
  tool: EditorTool;
  /** Active panel tab */
  tab: PanelTab;
  /** Settings drawer khula hai ya nahi */
  settingsOpen: boolean;
  /** Documents panel me hai ya nahi */
  documentsOpen: boolean;
}

/** Default state - naya project shuru karte waqt */
export function createInitialState(title = 'Untitled Project'): ScriptState {
  return {
    title,
    scenes: [
      {
        id: 'scene-1',
        number: 1,
        heading: 'INT. STUDIO - DAY',
        location: 'INT',
        dialogue: 'Welcome to the studio.',
        shot: 'Wide shot of the editing desk',
        duration: 5,
      },
    ],
    dialogue: [],
    textLayouts: [],
    transform: { positionX: 0, positionY: 0, scale: 100, rotation: 0 },
    tool: 'cut',
    tab: 'scenes',
    settingsOpen: false,
    documentsOpen: false,
  };
}

/** Scene duration ka total (seconds) */
export function totalDuration(scenes: Scene[]): number {
  return scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
}

/** Seconds ko HH:MM:SS me convert karo */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** Scenes ko compile karke plain-text cue sheet banao */
export function compileScript(state: ScriptState): CompiledScript {
  const lines: string[] = [];
  lines.push(`TITLE: ${state.title}`);
  lines.push(`SCENES: ${state.scenes.length}`);
  lines.push(`DURATION: ${formatDuration(totalDuration(state.scenes))}`);
  lines.push('');

  for (const scene of state.scenes) {
    lines.push(`${scene.number}. ${scene.heading}  [${scene.duration}s]`);
    if (scene.shot) lines.push(`   SHOT: ${scene.shot}`);
    if (scene.dialogue) lines.push(`   DIALOGUE: ${scene.dialogue}`);

    // Us scene ki dialogue lines
    const sceneLines = state.dialogue.filter((d) => d.sceneId === scene.id);
    for (const d of sceneLines) {
      lines.push(`   ${d.character}: ${d.text}`);
    }
    lines.push('');
  }

  // Text overlays section
  if (state.textLayouts.length > 0) {
    lines.push('--- TEXT OVERLAYS ---');
    for (const t of state.textLayouts) {
      lines.push(
        `"${t.content}" @ ${t.startTime}s-${t.endTime}s ` +
          `(${t.fontSize}px, ${t.align}, color=${t.color})`
      );
    }
    lines.push('');
  }

  // Transform
  lines.push('--- CLIP TRANSFORM ---');
  lines.push(
    `position: (${state.transform.positionX}, ${state.transform.positionY}) ` +
      `scale: ${state.transform.scale}% rotation: ${state.transform.rotation}deg`
  );

  const text = lines.join('\n');
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    title: state.title,
    compiledAt: new Date().toISOString(),
    totalScenes: state.scenes.length,
    totalDuration: totalDuration(state.scenes),
    totalLines: state.dialogue.length,
    wordCount,
    text,
  };
}

/** Unique ID generator (deterministic enough for client use) */
let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}
