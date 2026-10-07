'use client';

import { useState, useMemo } from 'react';
import { FunctionSquare, Trash2 } from 'lucide-react';
import { PanelSection, Tile, TileGrid, TextInput, Button, EmptyState } from './panel-kit';
import type { TimelineClip } from '../../lib/engine/types';

export interface ExpressionsPanelProps {
  clip: TimelineClip | null;
  onApplyExpression: (property: string, expression: string) => void;
  onClearExpression: (property: string) => void;
  onRemoveAllExpressions: () => void;
}

const EXPRESSION_PROPS = [
  { id: 'opacity', label: 'Opacity', group: 'Visual' as const, hint: 'alpha channel' },
  { id: 'rotation', label: 'Rotation', group: 'Transform' as const, hint: 'degrees' },
  { id: 'scale', label: 'Scale', group: 'Transform' as const, hint: '0.5x to 2x' },
  { id: 'x', label: 'X position', group: 'Transform' as const, hint: 'horizontal' },
  { id: 'y', label: 'Y position', group: 'Transform' as const, hint: 'vertical' },
  { id: 'volume', label: 'Volume', group: 'Audio' as const, hint: '0% to 100%' },
  { id: 'brightness', label: 'Brightness', group: 'Color' as const, hint: '0 to 2' },
  { id: 'contrast', label: 'Contrast', group: 'Color' as const, hint: '0 to 2' },
  { id: 'saturation', label: 'Saturation', group: 'Color' as const, hint: '0 to 3' },
  { id: 'text.size', label: 'Text size', group: 'Text' as const, hint: 'fraction of height' },
] as const satisfies readonly { id: string; label: string; group: string; hint: string }[];

const PRESETS = [
  {
    id: 'wiggle',
    label: 'Wiggle',
    hint: 'Random oscillation around the current value',
    template: 'wiggle(freq, amp)',
  },
  {
    id: 'oscillate',
    label: 'Oscillate',
    hint: 'Smooth back-and-forth between two values',
    template: 'oscillate(min, max, period, ease)',
  },
  {
    id: 'bounce',
    label: 'Bounce',
    hint: 'Decay toward a target value',
    template: 'bounce(target, decay)',
  },
  {
    id: 'loop',
    label: 'Loop',
    hint: 'Repeat a value between two bounds',
    template: 'loop(min, max, period)',
  },
];

const VARIABLES = [
  { name: 'time', hint: 'Seconds since the clip started' },
  { name: 't', hint: 'Shorthand for time' },
  { name: 'frames', hint: 'Current frame number' },
  { name: 'fps', hint: 'Project frame rate' },
  { name: 'clipDuration', hint: 'Total clip length in seconds' },
  { name: 'value', hint: 'The property\'s base value — the expression adds to it' },
  { name: 'playhead', hint: 'Current global timecode in seconds' },
  { name: 'pi', hint: '3.14159...' },
  { name: 'e', hint: 'Euler\'s number, 2.71828...' },
];

const FUNCTIONS = [
  { name: 'sin/cos/tan', hint: 'Trigonometric — sin(2*pi*time) for a smooth cycle' },
  { name: 'abs', hint: 'Absolute value' },
  { name: 'min/max/clamp', hint: 'Bound a result: clamp(x, lo, hi)' },
  { name: 'map', hint: 'Remap a range: map(value, inMin, inMax, outMin, outMax)' },
  { name: 'smooth', hint: 'Smooth a noisy signal' },
  { name: 'delay', hint: 'Offset by a time: delay(expr, seconds)' },
  { name: 'if', hint: 'Conditional: if(cond, a, b)' },
];

const SAMPLES = [
  {
    id: 'breath',
    label: 'Breathing scale',
    hint: 'scale = 1 + 0.1 * sin(2*pi*time)',
    property: 'scale',
    expression: '1 + 0.1 * sin(2 * pi * time)',
  },
  {
    id: 'pulse-fade',
    label: 'Pulsing opacity',
    hint: 'opacity = 0.5 + 0.3 * sin(pi * time)',
    property: 'opacity',
    expression: '0.5 + 0.3 * sin(pi * time)',
  },
  {
    id: 'rotate',
    label: 'Continuous rotation',
    hint: 'rotation = 360 * time',
    property: 'rotation',
    expression: '360 * time',
  },
  {
    id: 'drift',
    label: 'Slow position drift',
    hint: 'x = x + 0.1 * sin(2*pi*time*0.3)',
    property: 'x',
    expression: 'value + 0.1 * sin(2 * pi * time * 0.3)',
  },
];

function NoSelection({ what }: { what: string }) {
  return <EmptyState title="No clip selected" body={`Select a clip to edit ${what}.`} />;
}

export function ExpressionsPanel({ clip, onApplyExpression, onClearExpression, onRemoveAllExpressions }: ExpressionsPanelProps) {
  const [selectedProp, setSelectedProp] = useState<string>('opacity');
  const [expression, setExpression] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, typeof EXPRESSION_PROPS[number][]>;
    for (const p of EXPRESSION_PROPS) {
      if (!map.has(p.group)) map.set(p.group, []);
      map.get(p.group)!.push(p);
    }
    return Array.from(map.entries());
  }, []);

  const evaluate = (expr: string, t: number): number | null => {
    try {
      const safe = expr
        .replace(/sin/g, 'Math.sin')
        .replace(/cos/g, 'Math.cos')
        .replace(/tan/g, 'Math.tan')
        .replace(/abs/g, 'Math.abs')
        .replace(/min/g, 'Math.min')
        .replace(/max/g, 'Math.max')
        .replace(/\bpi\b/g, 'Math.PI')
        .replace(/\be\b/g, 'Math.E');
      const fn = new Function('time', 'frames', 'fps', 'clipDuration', 'value', `return ${safe}`);
      const result = fn(t, t * 30, 30, 10, 1);
      return typeof result === 'number' && Number.isFinite(result) ? result : null;
    } catch {
      return null;
    }
  };

  const testExpression = () => {
    if (!expression) return;
    const results = [];
    for (let t = 0; t <= 2; t += 0.2) {
      const v = evaluate(expression, t);
      results.push(v !== null ? `${Math.round(v * 100) / 100}` : 'invalid');
    }
    setPreview(results.join(', '));
  };

  const activeExpressions = clip?.expressions ?? {};

  return (
    <div className="space-y-3">
      <PanelSection
        title="Animated properties"
        hint="Link any property to a mathematical expression. The editor evaluates it on every frame during preview and export."
        action={
          Object.keys(activeExpressions).length > 0 ? (
            <Button variant="outline" onClick={onRemoveAllExpressions} ariaLabel="Clear all expressions">
              <Trash2 className="h-2 w-2" aria-hidden="true" />
              Clear all
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {groups.map(([groupName, props]) => (
            <div key={groupName}>
              <span className="text-[7px] font-semibold uppercase tracking-wide text-fg-muted">{groupName}</span>
              <div className="mt-1 flex flex-col gap-1">
                {props.map((p) => {
                  const has = Boolean(activeExpressions[p.id]);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProp(p.id)}
                      aria-pressed={selectedProp === p.id}
                      title={`${p.label} — ${p.hint}`}
                      className={[
                        'flex items-center justify-between rounded px-2 py-1 text-[8px] text-left transition-colors',
                        selectedProp === p.id
                          ? 'bg-[#ff6500]/15 text-[#ff6500] ring-1 ring-[#ff6500]/40'
                          : 'text-fg-secondary hover:bg-surface-overlay hover:text-fg',
                        has ? 'ring-1 ring-inset ring-[#ff6500]/30' : '',
                      ].join(' ')}
                    >
                      <span>{p.label}</span>
                      {has && <FunctionSquare className="h-4 w-4 text-[#ff6500]" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {!clip && <NoSelection what="an expression" />}
      </PanelSection>

      {clip && (
        <>
          <PanelSection
            title="Expression editor"
            hint={`Property: ${EXPRESSION_PROPS.find((p) => p.id === selectedProp)?.label ?? selectedProp}`}
            action={
              activeExpressions[selectedProp] ? (
                <Button variant="outline" onClick={() => { onClearExpression(selectedProp); }} ariaLabel={`Clear expression on ${selectedProp}`}>
<Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : undefined
            }
          >
            {activeExpressions[selectedProp] ? (
              <>
                <TextInput
                  value={activeExpressions[selectedProp]}
                  ariaLabel={`${selectedProp} expression`}
                  onChange={(v) => {
                    const updated = { ...activeExpressions, [selectedProp]: v };
                    Object.keys(updated).forEach((k) => {
                      if (k !== selectedProp) delete (updated as Record<string, string>)[k];
                    });
                    onApplyExpression(selectedProp, v);
                  }}
                  placeholder="e.g. 0.5 + 0.3 * sin(2*pi*time)"
                />
                {preview && (
                  <p className="mt-1 text-[7px] text-fg-muted">Preview (t=0..2s): {preview}</p>
                )}
                <Button onClick={testExpression} ariaLabel="Test expression with sample values">
                  Test expression
                </Button>
              </>
            ) : (
              <>
                <TextInput
                  value={expression}
                  ariaLabel="New expression"
                  placeholder="e.g. 1 + 0.1 * sin(2 * pi * time)"
                  onChange={setExpression}
                />
                {preview && (
                  <p className="mt-1 text-[7px] text-fg-muted">Preview (t=0..2s): {preview}</p>
                )}
                <div className="mt-2 flex gap-1.5">
                  <Button
                    onClick={() => {
                      if (expression) {
                        onApplyExpression(selectedProp, expression);
                        setExpression('');
                        setPreview(null);
                      }
                    }}
                    disabled={!expression}
                    ariaLabel={`Apply expression to ${selectedProp}`}
                  >
                    Apply
                  </Button>
                  <Button variant="outline" onClick={testExpression} disabled={!expression} ariaLabel="Test expression">
                    Test
                  </Button>
                </div>
              </>
            )}
          </PanelSection>

          <PanelSection title="Ready-made expressions">
            <TileGrid cols={2}>
              {SAMPLES.map((s) => (
                <Tile
                  key={s.id}
                  label={s.label}
                  hint={s.hint}
                  onClick={() => {
                    onApplyExpression(s.property, s.expression);
                    setSelectedProp(s.property);
                  }}
                  ariaLabel={`Apply the ${s.label} expression to ${s.property}`}
                />
              ))}
            </TileGrid>
          </PanelSection>

          <PanelSection title="Preset formulas">
            <TileGrid cols={2}>
              {PRESETS.map((p) => (
                <Tile
                  key={p.id}
                  label={p.label}
                  hint={p.template}
                  onClick={() => {
                    setExpression(p.template);
                    setPreview(null);
                  }}
                  ariaLabel={`Load the ${p.label} template`}
                />
              ))}
            </TileGrid>
          </PanelSection>
        </>
      )}

      <PanelSection title="Variables" hint="These are available inside any expression.">
        <div className="space-y-1 text-[8px]">
          {VARIABLES.map((v) => (
            <div key={v.name} className="flex justify-between">
              <span className="font-mono text-[#ff6500]">{v.name}</span>
              <span className="text-fg-muted">{v.hint}</span>
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Functions" hint="Mathematical helpers available inside expressions.">
        <div className="space-y-1 text-[8px]">
          {FUNCTIONS.map((f) => (
            <div key={f.name} className="flex justify-between">
              <span className="font-mono text-[#ff6500]">{f.name}</span>
              <span className="text-fg-muted">{f.hint}</span>
            </div>
          ))}
        </div>
      </PanelSection>
    </div>
  );
}
