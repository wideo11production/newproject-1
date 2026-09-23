import { 
  Button
} from '@wideo11/ui/button';
import { 
  Separator 
} from '@wideo11/ui/separator';
import { 
  Play, 
  Pause, 
  Square, 
  Undo, 
  Redo, 
  Copy, 
  Download, 
  Settings, 
  Plus, 
  Scissors,
  Music,
  Type,
  ZoomIn,
  ZoomOut,
  Film
} from 'lucide-react';
import { 
  DropdownMenu, 
  DropdownMenuTrigger, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator 
} from '@wideo11/ui/dropdown-menu';
import { 
  Label 
} from '@wideo11/ui/label';
import { 
  Input 
} from '@wideo11/ui/input';

export function Toolbar({ 
  onPlayPause, 
  onStop,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onExport,
  onSplit,
  onZoomIn,
  onZoomOut 
}: {
  onPlayPause: () => void;
  onStop?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onCut?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onExport?: () => void;
  onSplit?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}) {
  return (
    <div className="flex items-center px-4 py-3 bg-[hsl(223_47%_11.2%)/80] border-b border-[hsl(217.2_32.6%_17.5%)]">
      {/* Playback Controls */}
      <div className="mr-6 flex items-center space-x-2">
        <Button variant="ghost" size="icon" onClick={onStop}>
          <Square className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onPlayPause}>
          {/* Would dynamically change based on playing state */}
          <Play className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Editing Controls */}
      <div className="mr-6 flex items-center space-x-2">
        <Button variant="ghost" size="icon" onClick={onUndo} disabled>
          <Undo className="h-4 w-4 text-gray-400" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onRedo} disabled>
          <Redo className="h-4 w-4 text-gray-400" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Plus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => {/* Add video track */}}>
              <Film className="mr-2 h-4 w-4" /> Video Track
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {/* Add audio track */}}>
              <Music className="mr-2 h-4 w-4" /> Audio Track
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {/* Add text track */}}>
              <Type className="mr-2 h-4 w-4" /> Text Track
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSplit}>
              <Scissors className="mr-2 h-4 w-4" /> Split Clip
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {/* Zoom Controls */}
      <div className="mr-6 flex items-center space-x-2">
        <Button variant="ghost" size="icon" onClick={onZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Time Display */}
      <div className="mr-6 flex items-center space-x-2 text-sm text-gray-400">
        <Label>00:00:00:00</Label>
        <span>/</span>
        <Label>00:00:30:00</Label>
      </div>
      
      {/* Spacer */}
      <div className="flex-1"></div>
      
      {/* Export Button */}
      <Button variant="default" size="icon" onClick={onExport} className="mr-2">
        <Download className="h-4 w-4" />
      </Button>
      
      {/* Settings Button */}
      <Button variant="ghost" size="icon">
        <Settings className="h-4 w-4" />
      </Button>
    </div>
  );
}