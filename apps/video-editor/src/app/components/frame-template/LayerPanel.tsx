'use client';

import { useState } from 'react';
import type { FrameLayer, Frame } from '../../lib/engine/types';

interface LayerPanelProps {
  activeFrame: Frame | null;
  onAddLayer: (type: string) => void;
  onRemoveLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, updates: Partial<FrameLayer>) => void;
}

export function LayerPanel({
  activeFrame,
  onAddLayer,
  onRemoveLayer,
  onUpdateLayer,
}: LayerPanelProps) {
  return (
    <div className="flex flex-col h-full bg-[#121212] border-l border-[#2a2a2a] overflow-hidden">
      <div className="px-3 py-3 bg-[#1a1a1a] border-b border-[#2a2a2a]">
        <span className="text-xs font-semibold text-white">Layers</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {activeFrame?.layers.length ?? 0} layers
      </div>
    </div>
  );
}
