"use client";
import { useState } from 'react';
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardContent 
} from '@wideo11/ui/card';
import { 
  Button 
} from '@wideo11/ui/button';
import { 
  Separator 
} from '@wideo11/ui/separator';
import { 
  ScrollArea, 
  ScrollAreaScrollbar, 
  ScrollAreaViewport 
} from '@wideo11/ui/scroll-area';
import { 
  Sparkles, 
  Film, 
  Music, 
  Type, 
  Image,
  Play
} from 'lucide-react';

export function TemplatesPanel() {
  const [activeTab, setActiveTab] = useState<'video' | 'audio' | 'text' | 'image'>('video');

  // Mock templates - in real app, these would come from a template library
  const videoTemplates = [
    { 
      id: 'vt1', 
      name: 'Cinematic Intro', 
      thumbnail: '/placeholder-video-template-1.jpg',
      duration: '8s',
      description: 'Professional cinematic opening with light leaks and lens flares'
    },
    { 
      id: 'vt2', 
      name: 'Travel Vlog', 
      thumbnail: '/placeholder-video-template-2.jpg',
      duration: '15s',
      description: 'Upbeat travel montage with animated maps and transitions'
    },
    { 
      id: 'vt3', 
      name: 'Product Demo', 
      thumbnail: '/placeholder-video-template-3.jpg',
      duration: '30s',
      description: 'Clean product showcase with callouts and annotations'
    },
    { 
      id: 'vt4', 
      name: 'Social Media Ad', 
      thumbnail: '/placeholder-video-template-4.jpg',
      duration: '15s',
      description: 'Fast-paced advertisement optimized for social platforms'
    }
  ];

  const audioTemplates = [
    { 
      id: 'at1', 
      name: 'Cinematic Score', 
      thumbnail: '/placeholder-audio-template-1.jpg',
      duration: '60s',
      description: 'Epic orchestral track for film trailers'
    },
    { 
      id: 'at2', 
      name: 'Upbeat Pop', 
      thumbnail: '/placeholder-audio-template-2.jpg',
      duration: '45s',
      description: 'Happy, energetic pop instrumental'
    },
    { 
      id: 'at3', 
      name: 'Ambient Background', 
      thumbnail: '/placeholder-audio-template-3.jpg',
      duration: '120s',
      description: 'Atmospheric background music for corporate videos'
    }
  ];

  const textTemplates = [
    { 
      id: 'tt1', 
      name: 'Lower Third', 
      thumbnail: '/placeholder-text-template-1.jpg',
      duration: '5s',
      description: 'Professional lower third with name and title'
    },
    { 
      id: 'tt2', 
      name: 'Title Animation', 
      thumbnail: '/placeholder-text-template-2.jpg',
      duration: '8s',
      description: 'Animated title with kinetic typography'
    },
    { 
      id: 'tt3', 
      name: 'Subtitles', 
      thumbnail: '/placeholder-text-template-3.jpg',
      duration: '10s',
      description: 'Clean subtitle styling for accessibility'
    }
  ];

  const imageTemplates = [
    { 
      id: 'it1', 
      name: 'Photo Collage', 
      thumbnail: '/placeholder-image-template-1.jpg',
      duration: '10s',
      description: 'Animated photo grid with Ken Burns effect'
    },
    { 
      id: 'it2', 
      name: 'Logo Reveal', 
      thumbnail: '/placeholder-image-template-2.jpg',
      duration: '5s',
      description: 'Professional logo animation with particle effects'
    }
  ];

  const getTemplates = () => {
    switch (activeTab) {
      case 'video': return videoTemplates;
      case 'audio': return audioTemplates;
      case 'text': return textTemplates;
      case 'image': return imageTemplates;
      default: return videoTemplates;
    }
  };

  const templates = getTemplates();

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex space-x-2 mb-2">
        <Button 
          variant={activeTab === 'video' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('video')}
        >
          <Film className="mr-1 h-3 w-3" /> Video
        </Button>
        <Button 
          variant={activeTab === 'audio' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('audio')}
        >
          <Music className="mr-1 h-3 w-3" /> Audio
        </Button>
        <Button 
          variant={activeTab === 'text' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('text')}
        >
          <Type className="mr-1 h-3 w-3" /> Text
        </Button>
        <Button 
          variant={activeTab === 'image' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('image')}
        >
          <Image className="mr-1 h-3 w-3" /> Image
        </Button>
      </div>
      <Separator className="h-0.5 bg-border" />

      {/* Templates Grid */}
      <ScrollArea className="h-[calc(100%-80px)]">
        <ScrollAreaViewport className="grid grid-cols-2 gap-3 p-3">
          {templates.map((template) => (
            <div 
              key={template.id} 
              className="relative bg-[hsl(223_47%_11.2%)/50] border border-[hsl(217.2_32.6%_17.5%)] rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform"
              onClick={() => {/* Apply template to timeline */}}
            >
              <img 
                src={template.thumbnail} 
                alt={template.name} 
                className="w-full h-32 object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50">
                <h4 className="text-sm font-medium text-white mb-1">{template.name}</h4>
                <p className="text-xs text-gray-300 line-clamp-2">{template.description}</p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-gray-200">{template.duration}</span>
                  <Button variant="ghost" size="icon" className="p-0">
                    <Play className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {templates.length === 0 && (
            <div className="col-span-2 flex items-center justify-center py-8 text-gray-500">
              No templates found
            </div>
          )}
        </ScrollAreaViewport>
        <ScrollAreaScrollbar className="w-2" />
      </ScrollArea>
    </div>
  );
}