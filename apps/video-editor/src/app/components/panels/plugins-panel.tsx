'use client';

import { useState } from 'react';

// ============================================================================
// Plugins Panel — borderless, rounded-md
// ============================================================================
//
// Hinglish: plugins panel me koi bhi `border-edge` separator nahi hai.
// PanelSection ek `bg-[#1a1a1a]` Rich Charcoal block hai jo contrast
// grid bana deta hai bina kisi line ke. Tiles: default me koi nahi, `hover` par
// `border-[#ff6500]` orange-red accent appear hota hai. Inputs: base
// hata diya, `focus` par `border-[#ff6500]` accent aata hai.

import { Palette, Wand2, Puzzle, Settings, Download, Upload, Trash2 } from 'lucide-react';
import { PanelSection, Tile, TileGrid, Button, Field, Slider, EmptyState, Toggle } from './panel-kit';

// ---------------------------------------------------------------------------
// Mock plugin data
// ---------------------------------------------------------------------------

const BUILTIN_PLUGINS = [
  {
    id: 'color-correction',
    label: 'Color Correction',
    hint: 'Adjust hue, saturation, and brightness across all clips',
    swatch: 'bg-gradient-to-br from-[#ff6500]/30 to-[#1a1a1a]/10',
  },
  {
    id: 'stabilization',
    label: 'Stabilization',
    hint: 'Remove camera shake and stabilize footage',
    swatch: 'bg-gradient-to-br from-[#a855f7]/30 to-[#1a1a1a]/10',
  },
  {
    id: 'audio-enhancement',
    label: 'Audio Enhancement',
    hint: 'Noise reduction, equalization, and compression',
    swatch: 'bg-gradient-to-br from-[#22c55e]/30 to-[#1a1a1a]/10',
  },
  {
    id: 'text-overlays',
    label: 'Text Overlays',
    hint: 'Add and animate text on top of your timeline',
    swatch: 'bg-gradient-to-br from-[#fbbf24]/30 to-[#1a1a1a]/10',
  },
];

const PLUGIN_CATEGORIES = [
  { id: 'effects', label: 'Effects', count: 24 },
  { id: 'filters', label: 'Filters', count: 18 },
  { id: 'transitions', label: 'Transitions', count: 32 },
  { id: 'tools', label: 'Tools', count: 15 },
];

export interface PluginsPanelProps {
  activePluginId: string | null;
  onSelectPlugin: (pluginId: string) => void;
  onEnablePlugin: (pluginId: string, enabled: boolean) => void;
  onConfigurePlugin: (pluginId: string) => void;
  onRemovePlugin: (pluginId: string) => void;
}

export function PluginsPanel({
  activePluginId,
  onSelectPlugin,
  onEnablePlugin,
  onConfigurePlugin,
  onRemovePlugin,
}: PluginsPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState('effects');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPlugins = BUILTIN_PLUGINS.filter((p) =>
    selectedCategory === 'all' || p.id.includes(selectedCategory)
  );

  const selectedPlugin = BUILTIN_PLUGINS.find((p) => p.id === activePluginId);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <PanelSection title="Plugin Controls" hint="Manage enabled plugins and search for new ones.">
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setSelectedCategory('all')}
            className="flex-1"
          >
            All Plugins
          </Button>
          {PLUGIN_CATEGORIES.map((cat) => (
            <Button
              key={cat.id}
              variant={selectedCategory === cat.id ? 'default' : 'outline'}
              onClick={() => setSelectedCategory(cat.id)}
              className="flex-1"
            >
              {cat.label}
              <span className="ml-1 text-fg-muted">({cat.count})</span>
            </Button>
          ))}
        </div>

        <Field label="Search plugins" hint="Type to find specific functionality">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plugins..."
            aria-label="Search plugins"
            className="w-full rounded-md bg-surface px-2 py-1 text-[8px] text-fg placeholder:text-fg-muted focus:border-[#ff6500] focus:outline-none"
          />
        </Field>
      </PanelSection>

      {/* Plugin Grid */}
      <PanelSection title="Available Plugins" hint="Click to select, toggle to enable, configure for settings.">
        <TileGrid cols={2}>
          {filteredPlugins.map((plugin) => (
            <Tile
              key={plugin.id}
              label={plugin.label}
              hint={plugin.hint}
              swatch={plugin.swatch}
              active={activePluginId === plugin.id}
              onClick={() => onSelectPlugin(plugin.id)}
              ariaLabel={`Select ${plugin.label} plugin`}
            />
          ))}
        </TileGrid>

        {filteredPlugins.length === 0 && (
          <EmptyState
            title="No plugins found"
            body="Try a different category or search term."
          />
        )}
      </PanelSection>

      {/* Selected Plugin Configuration */}
      {selectedPlugin && (
        <PanelSection
          title={selectedPlugin.label}
          hint="Configure the selected plugin's settings."
          action={
            <Button variant="danger" onClick={() => onRemovePlugin(selectedPlugin.id)}>
              <Trash2 className="h-2.5 w-2.5" />
              Remove
            </Button>
          }
        >
          <div className="space-y-2">
            <Toggle
              checked={true}
              onChange={(checked) => onEnablePlugin(selectedPlugin.id, checked)}
              label="Enable plugin"
              hint="When disabled, the plugin is ignored"
            />

            <Button onClick={() => onConfigurePlugin(selectedPlugin.id)} full>
              Configure settings
            </Button>

            <div className="rounded-md bg-surface p-2">
              <p className="text-[8px] text-fg-muted">Plugin metadata</p>
              <p className="text-[8px] text-fg">ID: {selectedPlugin.id}</p>
              <p className="text-[8px] text-fg-muted">Version: 1.0.0</p>
              <p className="text-[8px] text-fg-muted">Last updated: 2026-10-01</p>
            </div>
          </div>
        </PanelSection>
      )}

      {/* Plugin Library Management */}
      <PanelSection title="Plugin Library" hint="Manage installed plugins and add new ones.">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => {}}>
              <Download className="h-2.5 w-2.5" />
              Install from marketplace
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => {}}>
              <Upload className="h-2.5 w-2.5" />
              Upload plugin
            </Button>
          </div>

          <div className="rounded-md bg-surface p-3">
            <p className="text-[8px] font-medium text-fg">Installed plugins</p>
            <div className="mt-2 space-y-1">
              {BUILTIN_PLUGINS.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-[8px]">
                  <span className="text-fg">{p.label}</span>
                  <span className="text-fg-muted">v1.0.0</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </PanelSection>
    </div>
  );
}