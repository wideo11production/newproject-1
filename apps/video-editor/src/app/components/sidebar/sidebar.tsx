"use client"
import { useState } from 'react';
import { 
  ScrollArea
} from '@wideo11/ui/scroll-area';
import { 
  Tabs, 
  TabsList, 
  TabsTrigger, 
  TabsContent 
} from '@wideo11/ui/tabs';
import { 
  Film, 
  Palette, 
  Sparkles, 
  Type, 
  Music, 
  HelpCircle 
} from 'lucide-react';
import { MediaLibrary } from '../media/media-library';
import { TemplatesPanel } from '../templates/templates-panel';
import { FiltersPanel } from '../filters/filters-panel';
import { AnimationsPanel } from '../animations/animations-panel';
import { TextPanel } from '../text/text-panel';
import { AudioPanel } from '../audio/audio-panel';
import { HelpPanel } from '../help/help-panel';

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<'media' | 'templates' | 'filters' | 'animations' | 'text' | 'audio' | 'help'>('media');

  return (
    <div className="w-72 bg-[hsl(223_47%_11.2%)] border-r border-[hsl(217.2_32.6%_17.5%)] overflow-hidden">
      <div className="flex h-full flex-col">
        {/* Tabs */}
        <div className="flex-shrink-0 bg-[hsl(223_47%_11.2%)/80] border-b border-[hsl(217.2_32.6%_17.5%)] px-4 py-3">
          <Tabs 
            defaultValue="media" 
            orientation="vertical" 
            className="w-full"
            onValueChange={(value) => setActiveTab(value as typeof activeTab)}
          >
            <TabsList className="flex flex-col gap-1">
              <TabsTrigger value="media">
                <Film className="h-4 w-4 mr-2" /> Media
              </TabsTrigger>
              <TabsTrigger value="templates">
                <Sparkles className="h-4 w-4 mr-2" /> Templates
              </TabsTrigger>
              <TabsTrigger value="filters">
                <Palette className="h-4 w-4 mr-2" /> Filters
              </TabsTrigger>
              <TabsTrigger value="animations">
                <Type className="h-4 w-4 mr-2" /> Animations
              </TabsTrigger>
              <TabsTrigger value="text">
                <Type className="h-4 w-4 mr-2" /> Text
              </TabsTrigger>
              <TabsTrigger value="audio">
                <Music className="h-4 w-4 mr-2" /> Audio
              </TabsTrigger>
              <TabsTrigger value="help">
                <HelpCircle className="h-4 w-4 mr-2" /> Help
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="media">
              <MediaLibrary />
            </TabsContent>
            <TabsContent value="templates">
              <TemplatesPanel />
            </TabsContent>
            <TabsContent value="filters">
              <FiltersPanel />
            </TabsContent>
            <TabsContent value="animations">
              <AnimationsPanel />
            </TabsContent>
            <TabsContent value="text">
              <TextPanel />
            </TabsContent>
            <TabsContent value="audio">
              <AudioPanel />
            </TabsContent>
            <TabsContent value="help">
              <HelpPanel />
            </TabsContent>
          </Tabs>
        </div>
        
        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full w-full">
            <div className="p-4 space-y-4">
              {activeTab === 'media' && <MediaLibrary />}
              {activeTab === 'templates' && <TemplatesPanel />}
              {activeTab === 'filters' && <FiltersPanel />}
              {activeTab === 'animations' && <AnimationsPanel />}
              {activeTab === 'text' && <TextPanel />}
              {activeTab === 'audio' && <AudioPanel />}
              {activeTab === 'help' && <HelpPanel />}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}