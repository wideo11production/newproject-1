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
  ScrollArea
} from '@wideo11/ui/scroll-area';
import { 
  Type, 
  Sparkles, 
  Circle, 
  RotateCcw,
  RefreshCw,
  TrendingUp,
  Activity,
  Play
} from 'lucide-react';

export function AnimationsPanel() {
  const [activeTab, setActiveTab] = useState<'transitions' | 'effects' | 'behaviors'>('transitions');

  // Mock animations - in real app, these would be actual animation presets
  const transitions = [
    { 
      id: 't1', 
      name: 'Cross Dissolve', 
      thumbnail: '/placeholder-transition-1.jpg',
      duration: '0.5s',
      description: 'Standard fade between clips'
    },
    { 
      id: 't2', 
      name: 'Slide Left', 
      thumbnail: '/placeholder-transition-2.jpg',
      duration: '0.5s',
      description: 'Clip slides in from left'
    },
    { 
      id: 't3', 
      name: 'Zoom', 
      thumbnail: '/placeholder-transition-3.jpg',
      duration: '0.5s',
      description: 'Quick zoom transition'
    },
    { 
      id: 't4', 
      name: 'Spin', 
      thumbnail: '/placeholder-transition-4.jpg',
      duration: '0.5s',
      description: '360 degree rotation'
    },
    { 
      id: 't5', 
      name: 'Flash', 
      thumbnail: '/placeholder-transition-5.jpg',
      duration: '0.3s',
      description: 'White flash transition'
    },
    { 
      id: 't6', 
      name: 'Wipe', 
      thumbnail: '/placeholder-transition-6.jpg',
      duration: '0.5s',
      description: 'Line wipe transition'
    }
  ];

  const effects = [
    { 
      id: 'e1', 
      name: 'Fade In', 
      thumbnail: '/placeholder-effect-1.jpg',
      duration: '1s',
      description: 'Gradual opacity increase'
    },
    { 
      id: 'e2', 
      name: 'Fade Out', 
      thumbnail: '/placeholder-effect-2.jpg',
      duration: '1s',
      description: 'Gradual opacity decrease'
    },
    { 
      id: 'e3', 
      name: 'Scale Up', 
      thumbnail: '/placeholder-effect-3.jpg',
      duration: '1s',
      description: 'Grow from center'
    },
    { 
      id: 'e4', 
      name: 'Scale Down', 
      thumbnail: '/placeholder-effect-4.jpg',
      duration: '1s',
      description: 'Shrink to center'
    },
    { 
      id: 'e5', 
      name: 'Rotate', 
      thumbnail: '/placeholder-effect-4.jpg',
      duration: '1s',
      description: 'Spin around center point'
    },
    { 
      id: 'e6', 
      name: 'Bounce', 
      thumbnail: '/placeholder-effect-6.jpg',
      duration: '1s',
      description: 'Playful bouncing motion'
    }
  ];

  const behaviors = [
    { 
      id: 'b1', 
      name: 'Typewriter', 
      thumbnail: '/placeholder-behavior-1.jpg',
      duration: '2s',
      description: 'Text appears letter by letter'
    },
    { 
      id: 'b2', 
      name: 'Pop', 
      thumbnail: '/placeholder-behavior-2.jpg',
      duration: '0.5s',
      description: 'Text scales up then settles'
    },
    { 
      id: 'b3', 
      name: 'Fade', 
      thumbnail: '/placeholder-behavior-3.jpg',
      duration: '1s',
      description: 'Text fades in/out'
    },
    { 
      id: 'b4', 
      name: 'Slide', 
      thumbnail: '/placeholder-behavior-4.jpg',
      duration: '0.5s',
      description: 'Text slides in from side'
    },
    { 
      id: 'b5', 
      name: 'Bounce', 
      thumbnail: '/placeholder-behavior-5.jpg',
      duration: '0.8s',
      description: 'Text bounces into place'
    },
    { 
      id: 'b6', 
      name: 'Shake', 
      thumbnail: '/placeholder-behavior-6.jpg',
      duration: '0.5s',
      description: 'Text shakes for emphasis'
    }
  ];

  const getAnimations = () => {
    switch (activeTab) {
      case 'transitions': return transitions;
      case 'effects': return effects;
      case 'behaviors': return behaviors;
      default: return transitions;
    }
  };

  const animations = getAnimations();

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex space-x-2 mb-2">
        <Button 
          variant={activeTab === 'transitions' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('transitions')}
        >
          <RefreshCw className="mr-1 h-3 w-3" /> Transitions
        </Button>
        <Button 
          variant={activeTab === 'effects' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('effects')}
        >
          <Sparkles className="mr-1 h-3 w-3" /> Effects
        </Button>
        <Button 
          variant={activeTab === 'behaviors' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('behaviors')}
        >
          <Type className="mr-1 h-3 w-3" /> Behaviors
        </Button>
      </div>
      <Separator className="h-0.5 bg-border" />

      {/* Animations Grid */}
      <ScrollArea className="h-[calc(100%-80px)]">
        <div className="grid grid-cols-2 gap-3 p-3">
          {animations.map((animation) => (
            <div 
              key={animation.id} 
              className="relative bg-[hsl(223_47%_11.2%)/50] border border-[hsl(217.2_32.6%_17.5%)] rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform"
              onClick={() => {/* Apply animation to selected clip/text */}}
            >
              <img 
                src={animation.thumbnail} 
                alt={animation.name} 
                className="w-full h-32 object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50">
                <h4 className="text-sm font-medium text-white mb-1">{animation.name}</h4>
                <p className="text-xs text-gray-300 line-clamp-2">{animation.description}</p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-gray-200">{animation.duration}</span>
                  <Button variant="ghost" size="icon" className="p-0">
                    <Play className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {animations.length === 0 && (
            <div className="col-span-2 flex items-center justify-center py-8 text-gray-500">
              No animations found
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}