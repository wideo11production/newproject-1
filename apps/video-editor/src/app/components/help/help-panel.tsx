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
  Tabs, 
  TabsList, 
  TabsTrigger, 
  TabsContent 
} from '@wideo11/ui/tabs';
import { 
  ScrollArea, 
  ScrollAreaScrollbar, 
  ScrollAreaViewport 
} from '@wideo11/ui/scroll-area';
import { 
  HelpCircle, 
  Play, 
  BookOpen, 
  Code, 
  ShieldCheck,
  Trophy,
  Users
} from 'lucide-react';

export function HelpPanel() {
  const [activeTab, setActiveTab] = useState<'getting-started' | 'tutorials' | 'reference' | 'community'>('getting-started');

  return (
    <div className="space-y-4">
      {/* Help Tabs */}
      <div className="flex space-x-2 mb-2">
        <Button 
          variant={activeTab === 'getting-started' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('getting-started')}
        >
          <BookOpen className="mr-1 h-3 w-3" /> Getting Started
        </Button>
        <Button 
          variant={activeTab === 'tutorials' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('tutorials')}
        >
          <Play className="mr-1 h-3 w-3" /> Tutorials
        </Button>
        <Button 
          variant={activeTab === 'reference' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('reference')}
        >
          <Code className="mr-1 h-3 w-3" /> Reference
        </Button>
        <Button 
          variant={activeTab === 'community' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setActiveTab('community')}
        >
          <Users className="mr-1 h-3 w-3" /> Community
        </Button>
      </div>
      <Separator className="h-0.5 bg-border" />

      {/* Help Content */}
      <ScrollArea className="h-[calc(100%-80px)]">
        <ScrollAreaViewport className="p-4">
          {activeTab === 'getting-started' && (
            <GettingStartedContent />
          )}
          {activeTab === 'tutorials' && (
            <TutorialsContent />
          )}
          {activeTab === 'reference' && (
            <ReferenceContent />
          )}
          {activeTab === 'community' && (
            <CommunityContent />
          )}
        </ScrollAreaViewport>
        <ScrollAreaScrollbar className="w-2" />
      </ScrollArea>
    </div>
  );
}

// Getting Started Content
function GettingStartedContent() {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white mb-2">Welcome to Wideo11 Video Editor</h3>
        <p className="text-gray-300 leading-relaxed">
          Wideo11 Video Editor is a professional-grade video editing application built for creators who need powerful 
          tools without the complexity. Whether you're making YouTube videos, short films, or social media content, 
          our editor provides everything you need to bring your vision to life.
        </p>
      </div>
      
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white mb-2">Interface Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-200">Main Workspace</h4>
            <p className="text-gray-300 text-sm">
              The central area contains your timeline, preview window, and toolbar. This is where you'll spend most 
              of your time editing and arranging your video clips.
            </p>
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-200">Sidebar Panels</h4>
            <p className="text-gray-300 text-sm">
              The left sidebar contains all your media assets, templates, filters, animations, text tools, audio 
              library, and help documentation. Switch between tabs to access different tools.
            </p>
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white mb-2">Basic Workflow</h3>
        <ol className="list-decimal list-inside space-y-2 text-gray-300">
          <li>Import your media files using the Media Library tab</li>
          <li>Drag clips from the media library to your timeline tracks</li>
          <li>Arrange and trim your clips on the timeline</li>
          <li>Add transitions, effects, and animations from the respective panels</li>
          <li>Enhance your video with text, color correction, and audio</li>
          <li>Preview your work in real-time using the preview window</li>
          <li>Export your final video in your desired format and settings</li>
        </ol>
      </div>
      
      <div className="flex justify-start">
        <Button 
          variant="default" 
          size="sm" 
          onClick={() => {/* Open first tutorial */}}
        >
          <Play className="mr-2 h-3 w-3" /> Start First Tutorial
        </Button>
      </div>
    </div>
  );
}

// Tutorials Content
function TutorialsContent() {
  const tutorials = [
    {
      id: 't1',
      title: 'Getting Started: Your First Edit',
      duration: '8:32',
      level: 'Beginner',
      thumbnail: '/placeholder-tutorial-1.jpg',
      description: 'Learn the basics of importing, cutting, and exporting your first video'
    },
    {
      id: 't2',
      title: 'Color Correction Basics',
      duration: '12:15',
      level: 'Intermediate',
      thumbnail: '/placeholder-tutorial-2.jpg',
      description: 'Master primary color correction, LUTs, and creating cinematic looks'
    },
    {
      id: 't3',
      title: 'Working with Audio',
      duration: '10:45',
      level: 'Intermediate',
      thumbnail: '/placeholder-tutorial-3.jpg',
      description: 'Mix audio, add music, and clean up dialogue for professional sound'
    },
    {
      id: 't4',
      title: 'Advanced Keyframing',
      duration: '15:20',
      level: 'Advanced',
      thumbnail: '/placeholder-tutorial-4.jpg',
      description: 'Create complex animations using keyframes for position, scale, and rotation'
    },
    {
      id: 't5',
      title: 'Multi-Camera Editing',
      duration: '18:10',
      level: 'Advanced',
      thumbnail: '/placeholder-tutorial-5.jpg',
      description: 'Sync and edit footage from multiple camera angles seamlessly'
    },
    {
      id: 't6',
      title: 'Motion Graphics & Titles',
      duration: '14:05',
      level: 'Intermediate',
      thumbnail: '/placeholder-tutorial-6.jpg',
      description: 'Create professional lower thirds, titles, and animated graphics'
    }
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white mb-2">Video Tutorials</h3>
        <p className="text-gray-300">
          Learn at your own pace with our comprehensive tutorial library. Each tutorial includes 
          downloadable project files so you can follow along step-by-step.
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="space-y-3">
          {tutorials.map((tutorial) => (
            <div 
              key={tutorial.id} 
              className="flex items-start space-x-4 p-3 bg-[hsl(223_47%_11.2%)/30] border border-[hsl(217.2_32.6%_17.5%)] rounded-lg hover:bg-[hsl(223_47%_11.2%)/50] transition-colors cursor-pointer"
              onClick={() => {/* Play tutorial */}}
            >
              <div className="flex-shrink-0">
                <img 
                  src={tutorial.thumbnail} 
                  alt={tutorial.title} 
                  className="w-16 h-16 object-cover rounded"
                />
                <div className="flex items-center space-x-1 mt-2">
                  <span className="text-xs text-gray-400">{tutorial.duration}</span>
                  <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-gray-800/50">
                    {tutorial.level}
                  </span>
                </div>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-white mb-1">{tutorial.title}</h4>
                <p className="text-xs text-gray-300 line-clamp-2">{tutorial.description}</p>
                <div className="mt-2 flex items-center text-xs">
                  <Play className="mr-1 h-3 w-3" />
                  <span>Watch Tutorial</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="flex justify-center">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => {/* View all tutorials */}}
        >
          <BookOpen className="mr-2 h-3 w-3" /> Browse All Tutorials
        </Button>
      </div>
    </div>
  );
}

// Reference Content
function ReferenceContent() {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white mb-2">Keyboard Shortcuts</h3>
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Shortcut
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Play/Pause
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Space
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Split Clip at Playhead
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    S
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Undo
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Cmd/Ctrl + Z
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Redo
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Cmd/Ctrl + Shift + Z
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Cut
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Cmd/Ctrl + X
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Copy
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Cmd/Ctrl + C
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Paste
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Cmd/Ctrl + V
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Delete Selected Clip
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Delete
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Zoom In Timeline
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    +
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Zoom Out Timeline
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    -
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Snap to Grid
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    Cmd/Ctrl
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white mb-2">Supported Formats</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <h4 className="font-medium text-gray-200 mb-2">Video Formats</h4>
            <ul className="list-disc list-inside text-gray-300">
              <li>MP4 (H.264, H.265)</li>
              <li>MOV (ProRes, DNxHD)</li>
              <li>AVI</li>
              <li>WEBM</li>
              <li>QuickTime</li>
              <li>MXF</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-medium text-gray-200 mb-2">Audio Formats</h4>
            <ul className="list-disc list-inside text-gray-300">
              <li>MP3</li>
              <li>AAC</li>
              <li>WAV</li>
              <li>FLAC</li>
              <li>AIFF</li>
              <li>OGG</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-medium text-gray-200 mb-2">Image Formats</h4>
            <ul className="list-disc list-inside text-gray-300">
              <li>JPEG</li>
              <li>PNG</li>
              <li>TIFF</li>
              <li>BMP</li>
              <li>GIF</li>
              <li>RAW</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// Community Content
function CommunityContent() {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white mb-2">Join the Wideo11 Community</h3>
        <p className="text-gray-300">
          Connect with other creators, get help, share your work, and stay updated on new features 
          and tutorials.
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-200">Official Forums</h4>
            <p className="text-gray-300">
              Ask questions, share tips, and get direct support from our team and experienced users.
            </p>
            <div className="mt-3">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {/* Open forums */}}
              >
                <Users className="mr-2 h-3 w-3" /> Visit Forums
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-200">Discord Community</h4>
            <p className="text-gray-300">
              Real-time chat with creators, quick help, and community events.
            </p>
            <div className="mt-3">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {/* Open Discord */}}
              >
                <Users className="mr-2 h-3 w-3" /> Join Discord
              </Button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white mb-2">Showcase Your Work</h3>
        <p className="text-gray-300">
          Share your videos made with Wideo11 and get featured in our community showcase.
        </p>
        <div className="mt-4">
          <Button 
            variant="default" 
            size="sm" 
            onClick={() => {/* Open submit form */}}
          >
            <Trophy className="mr-2 h-3 w-3" /> Submit Your Work
          </Button>
        </div>
      </div>
      
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white mb-2">Stay Updated</h3>
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-200">Release Notes</h4>
          <p className="text-xs text-gray-400">
            v1.2.0 • September 20, 2026 • Added new AI-powered tools, improved performance, 
            and expanded format support
          </p>
        </div>
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-200">Newsletter</h4>
          <p className="text-xs text-gray-400">
            Get monthly updates on new features, tutorials, and community highlights.
          </p>
          <div className="mt-2 flex items-center space-x-2">
            <input
              type="email"
              placeholder="Enter your email..."
              className="w-[200px] px-3 py-2 bg-gray-800/50 border border-gray-700 rounded text-white"
            />
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {/* Subscribe */}}
            >
              Subscribe
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}