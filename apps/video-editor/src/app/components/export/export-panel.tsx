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
  Input 
} from '@wideo11/ui/input';
import { 
  Label 
} from '@wideo11/ui/label';
import { 
  Select, 
  SelectTrigger, 
  SelectValue, 
  SelectContent, 
  SelectItem 
} from '@wideo11/ui/select';
import { 
  Checkbox 
} from '@wideo11/ui/checkbox';
import { 
  Upload, 
  Save, 
  Clock, 
  Film, 
  HardDrive
} from 'lucide-react';

export function ExportPanel() {
  const [filename, setFilename] = useState('my-video');
  const [format, setFormat] = useState('mp4');
  const [resolution, setResolution] = useState('1920x1080');
  const [fps, setFps] = useState('30');
  const [quality, setQuality] = useState('high');
  const [bitrate, setBitrate] = useState('12');
  const [audioCodec, setAudioCodec] = useState('aac');
  const [audioBitrate, setAudioBitrate] = useState('320');
  const [hardwareAcceleration, setHardwareAcceleration] = useState(true);
  const [usePreviews, setUsePreviews] = useState(false);
  const [maximumRenderQuality, setMaximumRenderQuality] = useState(true);
  const [progress, setProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const formats = [
    { value: 'mp4', label: 'MP4 (H.264)' },
    { value: 'mov', label: 'MOV (ProRes)' },
    { value: 'avi', label: 'AVI' },
    { value: 'webm', label: 'WEBM' },
    { value: 'gif', label: 'GIF' }
  ];

  const resolutions = [
    { value: '3840x2160', label: '4K UHD (3840×2160)' },
    { value: '2560x1440', label: '2K QHD (2560×1440)' },
    { value: '1920x1080', label: 'Full HD (1920×1080)' },
    { value: '1280x720', label: 'HD (1280×720)' },
    { value: '854x480', label: 'FWVGA (854×480)' },
    { value: '640x480', label: 'VGA (640×480)' }
  ];

  const fpsOptions = [
    { value: '24', label: '24 fps (Film)' },
    { value: '25', label: '25 fps (PAL)' },
    { value: '30', label: '30 fps (NTSC)' },
    { value: '50', label: '50 fps (PAL)' },
    { value: '60', label: '60 fps (NTSC)' },
    { value: '120', label: '120 fps (Slow Motion)' }
  ];

  const qualityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'maximum', label: 'Maximum' }
  ];

  const bitrateOptions = [
    { value: '5', label: '5 Mbps' },
    { value: '8', label: '8 Mbps' },
    { value: '12', label: '12 Mbps' },
    { value: '16', label: '16 Mbps' },
    { value: '20', label: '20 Mbps' },
    { value: '25', label: '25 Mbps' },
    { value: '35', label: '35 Mbps' },
    { value: '45', label: '45 Mbps' },
    { value: '50', label: '50 Mbps' }
  ];

  const audioCodecOptions = [
    { value: 'aac', label: 'AAC' },
    { value: 'mp3', label: 'MP3' },
    { value: 'wav', label: 'WAV' },
    { value: 'flac', label: 'FLAC' }
  ];

  const audioBitrateOptions = [
    { value: '96', label: '96 kbps' },
    { value: '128', label: '128 kbps' },
    { value: '192', label: '192 kbps' },
    { value: '256', label: '256 kbps' },
    { value: '320', label: '320 kbps' }
  ];

  const handleExport = () => {
    // In real app, this would trigger the export process
    setIsExporting(true);
    setProgress(0);
    
    // Simulate export progress
    const interval = setInterval(() => {
      setProgress(prev => {
        const newProgress = Math.min(prev + 1, 100);
        if (newProgress >= 100) {
          clearInterval(interval);
          setIsExporting(false);
          // Show success notification
          alert('Export completed successfully!');
        }
        return newProgress;
      });
    }, 50); // 5 second export simulation
  };

  return (
    <div className="space-y-4">
      {/* Basic Settings */}
      <Card className="bg-[hsl(223_47%_11.2%)/50]">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Basic Settings</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="filename">Filename</Label>
                <Input
                  id="filename"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="Enter filename..."
                  className="w-full"
                />
              </div>
              
              <div>
<Label htmlFor="format">Format</Label>
                 <Select defaultValue={format} onValueChange={setFormat}>
                   <SelectTrigger className="w-full">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent className="w-full">
                     {formats.map((option) => (
                       <SelectItem key={option.value} value={option.value}>
                         {option.label}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
              </div>
              
              <div>
<Label htmlFor="resolution">Resolution</Label>
                 <Select defaultValue={resolution} onValueChange={setResolution}>
                   <SelectTrigger className="w-full">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent className="w-full">
                     {resolutions.map((option) => (
                       <SelectItem key={option.value} value={option.value}>
                         {option.label}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
              </div>
              
              <div>
<Label htmlFor="fps">Frame Rate</Label>
                 <Select defaultValue={fps} onValueChange={setFps}>
                   <SelectTrigger className="w-full">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent className="w-full">
                     {fpsOptions.map((option) => (
                       <SelectItem key={option.value} value={option.value}>
                         {option.label}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Quality Settings */}
      <Card className="bg-[hsl(223_47%_11.2%)/50]">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Quality Settings</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
<Label htmlFor="quality">Quality</Label>
                 <Select defaultValue={quality} onValueChange={setQuality}>
                   <SelectTrigger className="w-full">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent className="w-full">
                     {qualityOptions.map((option) => (
                       <SelectItem key={option.value} value={option.value}>
                         {option.label}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
              </div>
              
              <div>
<Label htmlFor="bitrate">Video Bitrate</Label>
                 <Select defaultValue={bitrate} onValueChange={setBitrate}>
                   <SelectTrigger className="w-full">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent className="w-full">
                     {bitrateOptions.map((option) => (
                       <SelectItem key={option.value} value={option.value}>
                         {option.label}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
              </div>
              
              <div>
<Label htmlFor="audioCodec">Audio Codec</Label>
                 <Select defaultValue={audioCodec} onValueChange={setAudioCodec}>
                   <SelectTrigger className="w-full">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent className="w-full">
                     {audioCodecOptions.map((option) => (
                       <SelectItem key={option.value} value={option.value}>
                         {option.label}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
              </div>
              
              <div>
<Label htmlFor="audioBitrate">Audio Bitrate</Label>
                 <Select defaultValue={audioBitrate} onValueChange={setAudioBitrate}>
                   <SelectTrigger className="w-full">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent className="w-full">
                     {audioBitrateOptions.map((option) => (
                       <SelectItem key={option.value} value={option.value}>
                         {option.label}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Advanced Settings */}
      <Card className="bg-[hsl(223_47%_11.2%)/50]">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-200">Advanced Settings</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
<Checkbox
                 checked={hardwareAcceleration}
                 onCheckedChange={(checked) => setHardwareAcceleration(!!checked)}
                 className="h-3 w-3"
               />
              <Label>Hardware Acceleration</Label>
              <span className="ml-2 text-xs text-gray-400">
                (Uses GPU for faster encoding)
              </span>
            </div>
            
            <div className="flex items-center space-x-3">
<Checkbox
                 checked={usePreviews}
                 onCheckedChange={(checked) => setUsePreviews(!!checked)}
                 className="h-3 w-3"
               />
              <Label>Use Previews</Label>
              <span className="ml-2 text-xs text-gray-400">
                (Renders with effects applied)
              </span>
            </div>
            
            <div className="flex items-center space-x-3">
<Checkbox
                 checked={maximumRenderQuality}
                 onCheckedChange={(checked) => setMaximumRenderQuality(!!checked)}
                 className="h-3 w-3"
               />
              <Label>Maximum Render Quality</Label>
              <span className="ml-2 text-xs text-gray-400">
                (Higher quality, slower render)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Export Button */}
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 text-center">
            {isExporting ? (
              <>
                <div className="mb-3">
                  <div className="w-full bg-gray-800/50 rounded-full h-2.5">
                    <div 
                      className="bg-blue-500 h-full rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">
                    Exporting... {progress}%
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {/* Cancel export */}}
                  className="w-full"
                >
                  Cancel Export
                </Button>
              </>
            ) : (
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleExport}
                className="w-full"
              >
                <Save className="mr-2 h-4 w-4" /> Export Video
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}