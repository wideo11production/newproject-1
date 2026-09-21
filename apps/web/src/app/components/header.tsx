import { Moon, Sun, User, LogOut, Settings } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@wideo11/ui/dropdown-menu';
import { Button } from '@wideo11/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@wideo11/ui/avatar';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="text-gray-300 hover:text-white hover:bg-gray-800"
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="h-4 w-4 hidden dark:block" />
    </Button>
  );
}

export function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
          <Avatar className="h-6 w-6">
            <AvatarImage src="/placeholder.svg" />
            <AvatarFallback>UN</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-gray-800 border-gray-700">
        <DropdownMenuItem>
          <User className="h-4 w-4 mr-2" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="h-4 w-4 mr-2" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem>
          <LogOut className="h-4 w-4 mr-2" /> Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>
  );
}