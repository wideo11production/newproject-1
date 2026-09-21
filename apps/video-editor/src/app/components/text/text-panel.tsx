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
  Type, 
  FontSizes, 
  Bold, 
  Italic, 
  AlignLeft, 
  AlignCenter, 
  AlignRight,
  List,
  Layout,
  Palette
} from 'lucide-react';

export function TextPanel() {
  const [textContent, setTextContent] = useState('');
  const [fontSize, setFontSize] = useState(24);
  const [fontWeight, setFontWeight] = useState('normal');
  const [fontStyle, setFontStyle] = useState('normal');
  const [textAlign, setTextAlign] = useState('left');
  const [textColor, setTextColor] = useState('#ffffff');
  const [backgroundColor, setBackgroundColor] = useState('transparent');

  // Mock text styles/presets
  const textStyles = [
    { 
      id: 'ts1', 
      name: 'Default', 
      thumbnail: '/placeholder-text-style-1.jpg',
      fontSize: 24,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textAlign: 'left',
      color: '#ffffff',
      background: 'transparent'
    },
    { 
      id: 'ts2', 
      name: 'Title', 
      thumbnail: '/placeholder-text-style-2.jpg',
      fontSize: 48,
      fontWeight: 'bold',
      fontStyle: 'normal',
      textAlign: 'center',
      color: '#ffffff',
      background: 'rgba(0,0,0,0.5)'
    },
    { 
      id: 'ts3', 
      name: 'Lower Third', 
      thumbnail: '/placeholder-text-style-3.jpg',
      fontSize: 20,
      fontWeight: 'medium',
      fontStyle: 'normal',
      textAlign: 'left',
      color: '#ffffff',
      background: 'rgba(0,0,0,0.7)'
    },
    { 
      id: 'ts4', 
      name: 'Subtitle', 
      thumbnail: '/placeholder-text-style-4.jpg',
      fontSize: 18,
      fontWeight: 'normal',
      fontStyle: 'italic',
      textAlign: 'center',
      color: '#ffff00',
      background: 'transparent'
    },
    { 
      id: 'ts5', 
      name: 'Callout', 
      thumbnail: '/placeholder-text-style-5.jpg',
      fontSize: 28,
      fontWeight: 'bold',
      fontStyle: 'normal',
      textAlign: 'center',
      color: '#ff0000',
      background: 'rgba(255,255,255,0.8)'
    }
  ];

  return (
    <div className="space-y-4">
      {/* Text Presets */}
      <div className="space-y-3">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Text Styles</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <ScrollArea className="h-[120px]">
            <ScrollAreaViewport className="flex flex-col space-y-2">
              {textStyles.map((style) => (
                <div 
                  key={style.id} 
                  className="flex items-center p-2 bg-[hsl(223_47%_11.2%)/30] border border-[hsl(217.2_32.6%_17.5%)] rounded-lg cursor-pointer hover:bg-[hsl(223_47%_11.2%)/50] transition-colors"
                  onClick={() => {
                    setTextStyle(style);
                  }}
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <div 
                        className="h-6 w-6 bg-[hsl(223_47%_11.2%)/50] border border-[hsl(217.2_32.6%_17.5%)] rounded flex items-center justify-center text-xs"
                        style={{
                          fontSize: `${style.fontSize}px`,
                          fontWeight: style.fontWeight === 'bold' ? 'bold' : 'normal',
                          fontStyle: style.fontStyle === 'italic' ? 'italic' : 'normal',
                          textAlign: style.textAlign,
                          color: style.color,
                          backgroundColor: style.background
                        }}
                      >
                        Txt
                      </div>
                      <span className="text-xs font-medium">{style.name}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="p-0 ml-2">
                    <Play className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </ScrollAreaViewport>
            <ScrollAreaScrollbar className="w-2" />
          </ScrollArea>
        </CardContent>
      </div>
      
      {/* Text Editor */}
      <div className="space-y-3">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Text Content</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <Label htmlFor="text-content">Content</Label>
          <Input
            id="text-content"
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Enter your text here..."
            className="w-full"
          />
        </CardContent>
      </div>
      
      {/* Text Controls */}
      <div className="space-y-3">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Text Formatting</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center space-x-2">
              <Label htmlFor="font-size">Size</Label>
              <input
                type="range"
                min="8"
                max="72"
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                className="w-24"
              />
              <span className="ml-2 text-xs">{fontSize}px</span>
            </div>
            
            <div className="flex items-center space-x-2">
              <Label>Bold</Label>
              <input
                type="checkbox"
                checked={fontWeight === 'bold'}
                onChange={(e) => setFontWeight(e.target.checked ? 'bold' : 'normal')}
                className="h-3 w-3"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Label>Italic</Label>
              <input
                type="checkbox"
                checked={fontStyle === 'italic'}
                onChange={(e) => setFontStyle(e.target.checked ? 'italic' : 'normal')}
                className="h-3 w-3"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Label>Align</Label>
              <div className="flex space-x-2">
                <button 
                  onClick={() => setTextAlign('left')}
                  className={`px-2 py-1 text-xs ${textAlign === 'left' ? 'bg-blue-500/30' : 'bg-transparent'} rounded`}
                >
                  <AlignLeft className="h-3 w-3" />
                </button>
                <button 
                  onClick={() => setTextAlign('center')}
                  className={`px-2 py-1 text-xs ${textAlign === 'center' ? 'bg-blue-500/30' : 'bg-transparent'} rounded`}
                >
                  <AlignCenter className="h-3 w-3" />
                </button>
                <button 
                  onClick={() => setTextAlign('right')}
                  className={`px-2 py-1 text-xs ${textAlign === 'right' ? 'bg-blue-500/30' : 'bg-transparent'} rounded`}
                >
                  <AlignRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </div>
      
      {/* Color Controls */}
      <div className="space-y-3">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Colors</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Label>Text Color</Label>
              <input
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                className="h-6 w-10"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Label>Background</Label>
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                className="h-6 w-10"
              />
              <button 
                onClick={() => setBackgroundColor('transparent')}
                className="ml-2 text-xs hover:text-gray-300"
              >
                Transparent
              </button>
            </div>
          </div>
        </CardContent>
      </div>
      
      {/* Preview and Apply */}
      <div className="space-y-4">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Preview</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div 
            className="h-[100px] flex items-center justify-center bg-[hsl(223_47%_11.2%)/30] border border-[hsl(217.2_32.6%_17.5%)] rounded-lg"
          >
            <div 
              className="text-center max-w-[200px] text-xs"
              style={{
                fontSize: `${fontSize}px`,
                fontWeight: fontWeight,
                fontStyle: fontStyle,
                textAlign: textAlign,
                color: textColor,
                backgroundColor: backgroundColor,
                padding: '4px',
                borderRadius: '2px'
              }}
            >
              {textContent || 'Your text here...'}
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button 
              variant="default" 
              size="sm" 
              onClick={() => {/* Add text to timeline */}}
            >
              Add to Timeline
            </Button>
          </div>
        </CardContent>
      </div>
    </div>
  );
}

// Helper function to apply text style (would be implemented in real app)
function setTextStyle(style: any) {
  setFontSize(style.fontSize);
  setFontWeight(style.fontWeight);
  setFontStyle(style.fontStyle);
  setTextAlign(style.textAlign);
  setTextColor(style.color);
  setBackgroundColor(style.background);
}