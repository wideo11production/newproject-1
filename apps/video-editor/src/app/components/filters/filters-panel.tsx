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
  Palette, 
  Circle, 
  Moon, 
  Sun, 
  Droplet,
  Zap,
  Airplay,
  Play
} from 'lucide-react';

export function FiltersPanel() {
  const [activeTab, setActiveTab] = useState<'color' | 'lighting' | 'special'>('color');

  // Mock filters - in real app, these would be actual filter presets
  const colorFilters = [
    { 
      id: 'cf1', 
      name: 'Classic', 
      thumbnail: '/placeholder-filter-1.jpg',
      description: 'Timeless color balance with warm tones'
    },
    { 
      id: 'cf2', 
      name: 'Vibrant', 
      thumbnail: '/placeholder-filter-2.jpg',
      description: 'Boosted saturation and contrast'
    },
    { 
      id: 'cf3', 
      name: 'Muted', 
      thumbnail: '/placeholder-filter-3.jpg',
      description: 'Desaturated for a subtle, filmic look'
    },
    { 
      id: 'cf4', 
      name: 'Warm', 
      thumbnail: '/placeholder-filter-4.jpg',
      description: 'Golden hour warmth with soft highlights'
    },
    { 
      id: 'cf5', 
      name: 'Cool', 
      thumbnail: '/placeholder-filter-5.jpg',
      description: 'Blue-toned for a calm, professional feel'
    },
    { 
      id: 'cf6', 
      name: 'Monochrome', 
      thumbnail: '/placeholder-filter-6.jpg',
      description: 'Black and white with adjustable contrast'
    }
  ];

  const lightingFilters = [
    { 
      id: 'lf1', 
      name: 'Bright', 
      thumbnail: '/placeholder-lighting-1.jpg',
      description: 'Increased exposure and highlights'
    },
    { 
      id: 'lf2', 
      name: 'Dramatic', 
      thumbnail: '/placeholder-lighting-2.jpg',
      description: 'High contrast with deep shadows'
    },
    { 
      id: 'lf3', 
      name: 'Soft', 
      thumbnail: '/placeholder-lighting-3.jpg',
      description: 'Reduced contrast with gentle fill light'
    },
    { 
      id: 'lf4', 
      name: 'Silhouette', 
      thumbnail: '/placeholder-lighting-4.jpg',
      description: 'Strong backlighting for dramatic outlines'
    }
  ];

  const specialFilters = [
    { 
      id: 'sf1', 
      name: 'Glitch', 
      thumbnail: '/placeholder-special-1.jpg',
      description: 'Digital distortion and RGB splitting'
    },
    { 
      id: 'sf2', 
      name: 'Film Grain', 
      thumbnail: '/placeholder-special-2.jpg',
      description: 'Analog film texture with adjustable intensity'
    },
    { 
      id: 'sf3', 
      name: 'Blur', 
      thumbnail: '/placeholder-special-3.jpg',
      description: 'Gaussian blur for transitions or privacy'
    },
    { 
      id: 'sf4', 
      name: 'Sharpen', 
      thumbnail: '/placeholder-special-4.jpg',
      description: 'Enhanced edge detail and clarity'
    },
    { 
      id: 'sf5', 
      name: 'Vignette', 
      thumbnail: '/placeholder-special-5.jpg',
      description: 'Darkened edges to focus attention'
    },
    { 
      id: 'sf6', 
      name: 'Lens Flare', 
      thumbnail: '/placeholder-special-6.jpg',
      description: 'Realistic light streaks and orbs'
    }
  ];

  const getFilters = () => {
    switch (activeTab) {
      case 'color': return colorFilters;
      case 'lighting': return lightingFilters;
      case 'special': return specialFilters;
      default: return colorFilters;
    }
  };

  const filters = getFilters();

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex space-x-2 mb-2">
        <Button 
          variant={activeTab === 'color' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('color')}
        >
          <Palette className="mr-1 h-3 w-3" /> Color
        </Button>
        <Button 
          variant={activeTab === 'lighting' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('lighting')}
        >
          <Sun className="mr-1 h-3 w-3" /> Lighting
        </Button>
        <Button 
          variant={activeTab === 'special' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('special')}
        >
          <Zap className="mr-1 h-3 w-3" /> Special
        </Button>
      </div>
      <Separator className="h-0.5 bg-border" />

      {/* Filters Grid */}
      <ScrollArea className="h-[calc(100%-80px)]">
        <ScrollAreaViewport className="grid grid-cols-2 gap-3 p-3">
          {filters.map((filter) => (
            <div 
              key={filter.id} 
              className="relative bg-[hsl(223_47%_11.2%)/50] border border-[hsl(217.2_32.6%_17.5%)] rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform"
              onClick={() => {/* Apply filter to selected clip */}}
            >
              <img 
                src={filter.thumbnail} 
                alt={filter.name} 
                className="w-full h-32 object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50">
                <h4 className="text-sm font-medium text-white mb-1">{filter.name}</h4>
                <p className="text-xs text-gray-300 line-clamp-2">{filter.description}</p>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="p-0 mt-1"
                >
                  <Play className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
          {filters.length === 0 && (
            <div className="col-span-2 flex items-center justify-center py-8 text-gray-500">
              No filters found
            </div>
          )}
        </ScrollAreaViewport>
        <ScrollAreaScrollbar className="w-2" />
      </ScrollArea>
    </div>
  );
}