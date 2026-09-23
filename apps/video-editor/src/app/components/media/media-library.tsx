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
  Input 
} from '@wideo11/ui/input';
import { 
  Label 
} from '@wideo11/ui/label';
import { 
  Separator 
} from '@wideo11/ui/separator';
import { 
  ScrollArea, 
  ScrollAreaScrollbar, 
  ScrollAreaViewport 
} from '@wideo11/ui/scroll-area';
import { 
  Film, 
  Music, 
  Image, 
  Type, 
  Folder 
} from 'lucide-react';

export function MediaLibrary() {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'video' | 'audio' | 'images' | 'text'>('all');

  // Mock media files - in real app, this would come from an API or file system
  const allMedia = [
    { id: '1', name: 'Opening Scene.mp4', type: 'video', thumbnail: '/placeholder-video-1.jpg', duration: '12:34' },
    { id: '2', name: 'Interview Clip.mp4', type: 'video', thumbnail: '/placeholder-video-2.jpg', duration: '8:12' },
    { id: '3', name: 'B-roll Footage.mp4', type: 'video', thumbnail: '/placeholder-video-3.jpg', duration: '5:45' },
    { id: '4', name: 'Background Music.mp3', type: 'audio', thumbnail: '/placeholder-audio-1.jpg', duration: '2:15' },
    { id: '5', name: 'Sound Effect.wav', type: 'audio', thumbnail: '/placeholder-audio-2.jpg', duration: '0:05' },
    { id: '6', name: 'Logo.png', type: 'image', thumbnail: '/placeholder-image-1.jpg' },
    { id: '7', name: 'Thumbnail.jpg', type: 'image', thumbnail: '/placeholder-image-2.jpg' },
    { id: '8', name: 'Title Text.png', type: 'image', thumbnail: '/placeholder-image-3.jpg' },
  ];

  const filteredMedia = allMedia.filter(item => {
    if (searchTerm && !item.name.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    if (activeTab === 'all') return true;
    return item.type === activeTab;
  });

  return (
    <div className="space-y-4">
      {/* Search */}
      <Card className="bg-[hsl(223_47%_11.2%)/50]">
        <CardHeader>
          <Input
            placeholder="Search media..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full"
          />
        </CardHeader>
      </Card>

      {/* Tabs */}
      <div className="flex space-x-2">
        <Button 
          variant={activeTab === 'all' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('all')}
        >
          All
        </Button>
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
          variant={activeTab === 'images' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('images')}
        >
          <Image className="mr-1 h-3 w-3" /> Images
        </Button>
        <Button 
          variant={activeTab === 'text' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('text')}
        >
          <Type className="mr-1 h-3 w-3" /> Text
        </Button>
      </div>
      <Separator className="h-0.5 bg-border" />

      {/* Media Grid */}
      <ScrollArea className="h-[calc(100%-140px)]">
        <ScrollAreaViewport className="grid grid-cols-2 gap-2 p-2">
          {filteredMedia.map((media) => (
            <div 
              key={media.id} 
              className="relative bg-[hsl(223_47%_11.2%)/50] border border-[hsl(217.2_32.6%_17.5%)] rounded-lg overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform"
              onClick={() => {/* Add to timeline */}}
            >
              <img 
                src={media.thumbnail} 
                alt={media.name} 
                className="w-full h-32 object-cover"
              />
              {media.duration && (
                <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-1 rounded">
                  {media.duration}
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50 text-white text-sm">
                {media.name}
              </div>
            </div>
          ))}
          {filteredMedia.length === 0 && (
            <div className="col-span-2 flex items-center justify-center py-8 text-gray-500">
              No media found
            </div>
          )}
        </ScrollAreaViewport>
        <ScrollAreaScrollbar className="w-2" />
      </ScrollArea>
    </div>
  );
}