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
  Input 
} from '@wideo11/ui/input';
import { 
  Label 
} from '@wideo11/ui/label';
import { 
  Music, 
  Volume2, 
  VolumeX, 
  Repeat, 
  SkipBack, 
  SkipForward,
  ArrowLeftRight
} from 'lucide-react';

export function AudioPanel() {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'music' | 'sfx' | 'voiceover'>('music');
  const [volume, setVolume] = useState(0.7);
  const [isLooping, setIsLooping] = useState(false);

  // Mock audio library
  const musicTracks = [
    { 
      id: 'mt1', 
      name: 'Epic Adventure', 
      artist: 'AudioJungle',
      duration: '2:15',
      thumbnail: '/placeholder-audio-track-1.jpg',
      genre: 'Orchestral',
      mood: 'Epic'
    },
    { 
      id: 'mt2', 
      name: 'Happy Pop', 
      artist: 'PremiumBeat',
      duration: '1:45',
      thumbnail: '/placeholder-audio-track-2.jpg',
      genre: 'Pop',
      mood: 'Upbeat'
    },
    { 
      id: 'mt3', 
      name: 'Chill Vibes', 
      artist: 'Artlist',
      duration: '3:30',
      thumbnail: '/placeholder-audio-track-3.jpg',
      genre: 'Electronic',
      mood: 'Relaxed'
    },
    { 
      id: 'mt4', 
      name: 'Corporate Motivation', 
      artist: 'AudioNetwork',
      duration: '2:00',
      thumbnail: '/placeholder-audio-track-4.jpg',
      genre: 'Pop/Rock',
      mood: 'Inspirational'
    }
  ];

  const sfxTracks = [
    { 
      id: 'sfx1', 
      name: 'Whoosh', 
      duration: '0.5s',
      thumbnail: '/placeholder-sfx-1.jpg',
      category: 'Transition'
    },
    { 
      id: 'sfx2', 
      name: 'Hit', 
      duration: '0.3s',
      thumbnail: '/placeholder-sfx-2.jpg',
      category: 'Impact'
    },
    { 
      id: 'sfx3', 
      name: 'Riser', 
      duration: '2.0s',
      thumbnail: '/placeholder-sfx-3.jpg',
      category: 'Build'
    },
    { 
      id: 'sfx4', 
      name: 'Ding', 
      duration: '0.2s',
      thumbnail: '/placeholder-sfx-4.jpg',
      category: 'Notification'
    }
  ];

  const voiceoverTracks = [
    { 
      id: 'vo1', 
      name: 'Narration - Male', 
      artist: 'VoiceBank',
      duration: '1:20',
      thumbnail: '/placeholder-voiceover-1.jpg',
      language: 'English',
      gender: 'Male'
    },
    { 
      id: 'vo2', 
      name: 'Narration - Female', 
      artist: 'VoiceBank',
      duration: '1:15',
      thumbnail: '/placeholder-voiceover-2.jpg',
      language: 'English',
      gender: 'Female'
    }
  ];

  const getAudio = () => {
    switch (activeTab) {
      case 'music': return musicTracks;
      case 'sfx': return sfxTracks;
      case 'voiceover': return voiceoverTracks;
      default: return musicTracks;
    }
  };

  const audioList = getAudio();
  const filteredAudio = audioList.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.artist && item.artist.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.genre && item.genre.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.mood && item.mood.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.category && item.category.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.language && item.language.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      {/* Search and Tabs */}
      <div className="space-y-3">
        <CardHeader>
          <Input
            placeholder="Search audio..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full"
          />
        </CardHeader>
        
        <div className="flex space-x-2 mt-2">
          <Button 
            variant={activeTab === 'music' ? 'default' : 'outline'} 
            size="sm" 
            onClick={() => setActiveTab('music')}
          >
            <Music className="mr-1 h-3 w-3" /> Music
          </Button>
          <Button 
            variant={activeTab === 'sfx' ? 'default' : 'outline'} 
            size="sm" 
            onClick={() => setActiveTab('sfx')}
          >
            <Zap className="mr-1 h-3 w-3" /> SFX
          </Button>
          <Button 
            variant={activeTab === 'voiceover' ? 'default' : 'outline'} 
            size="sm" 
            onClick={() => setActiveTab('voiceover')}
          >
            <Volume2 className="mr-1 h-3 w-3" /> Voiceover
          </Button>
        </div>
      </div>
      <Separator className="h-0.5 bg-border" />

      {/* Audio List */}
      <ScrollArea className="h-[calc(100%-120px)]">
        <ScrollAreaViewport className="space-y-2 p-2">
          {filteredAudio.map((audio) => (
            <div 
              key={audio.id} 
              className="flex items-center p-3 bg-[hsl(223_47%_11.2%)/50] border border-[hsl(217.2_32.6%_17.5%)] rounded-lg cursor-pointer hover:bg-[hsl(223_47%_11.2%)/70] transition-colors"
              onClick={() => {/* Add audio to timeline */}}
            >
              <div className="flex-shrink-0">
                <img 
                  src={audio.thumbnail} 
                  alt={audio.name} 
                  className="w-10 h-10 object-cover rounded"
                />
              </div>
              <div className="flex-1 min-w-0 space-y-1 ml-3">
                <div className="flex justify-between">
                  <h4 className="text-sm font-medium text-white">{audio.name}</h4>
                  <span className="text-xs text-gray-400">{audio.duration}</span>
                </div>
                <div className="text-xs text-gray-300 flex-wrap">
                  {audio.artist && (
                    <span className="mr-2">{audio.artist}</span>
                  )}
                  {audio.genre && (
                    <span className="mr-2">#{audio.genre}</span>
                  )}
                  {audio.mood && (
                    <span className="mr-2">#{audio.mood}</span>
                  )}
                  {audio.category && (
                    <span className="mr-2">#{audio.category}</span>
                  )}
                  {audio.language && (
                    <span className="mr-2">{audio.language}</span>
                  )}
                  {audio.gender && (
                    <span className="mr-2">{audio.gender}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filteredAudio.length === 0 && (
            <div className="flex items-center justify-center py-8 text-gray-500">
              No audio found
            </div>
          )}
        </ScrollAreaViewport>
        <ScrollAreaScrollbar className="w-2" />
      </ScrollArea>
      
      {/* Audio Controls */}
      <div className="space-y-3">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Playback Controls</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => {/* Skip back */}}
              >
                <SkipBack className="h-3 w-3" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => {/* Play/Pause */}}
              >
                <Music className="h-3 w-3" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => {/* Skip forward */}}
              >
                <SkipForward className="h-3 w-3" />
              </Button>
            </div>
            
            <div className="flex items-center space-x-3">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsLooping(!isLooping)}
                className={isLooping ? 'text-blue-400' : 'text-gray-400'}
              >
                <Repeat className="h-3 w-3" />
              </Button>
              <div className="flex items-center space-x-2">
                <Label>Volume</Label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="ml-2 text-xs">{Math.round(volume * 100)}%</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setVolume(0)}
                  className="ml-2"
                >
                  <VolumeX className="h-3 w-3" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setVolume(1)}
                  className="ml-2"
                >
                  <Volume2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </div>
    </div>
  );
}