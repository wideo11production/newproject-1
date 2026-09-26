import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface ShortcutConfig {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  description: string;
  action: () => void;
}

export const useKeyboardShortcuts = (shortcuts: ShortcutConfig[]) => {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const matches = 
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          (shortcut.ctrlKey === undefined || e.ctrlKey === shortcut.ctrlKey) &&
          (shortcut.metaKey === undefined || e.metaKey === shortcut.metaKey) &&
          (shortcut.shiftKey === undefined || e.shiftKey === shortcut.shiftKey) &&
          (shortcut.altKey === undefined || e.altKey === shortcut.altKey);

        if (matches) {
          e.preventDefault();
          shortcut.action();
          break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, router]);
};

export const grafanaShortcuts: ShortcutConfig[] = [
  { key: 'n', ctrlKey: true, description: 'New dashboard', action: () => {} },
  { key: 's', ctrlKey: true, description: 'Save dashboard', action: () => {} },
  { key: 'e', ctrlKey: true, description: 'Edit dashboard', action: () => {} },
  { key: 'f', ctrlKey: true, description: 'Fullscreen panel', action: () => {} },
  { key: 'p', ctrlKey: true, description: 'Add panel', action: () => {} },
  { key: '/', description: 'Search', action: () => {} },
  { key: 'g', ctrlKey: true, description: 'Toggle sidebar', action: () => {} },
  { key: 'Escape', description: 'Escape/Reset', action: () => {} },
];

export const getGrafanaShortcutsHelp = () => {
  return grafanaShortcuts.map(s => {
    const keys = [];
    if (s.ctrlKey) keys.push('Ctrl');
    if (s.shiftKey) keys.push('Shift');
    if (s.altKey) keys.push('Alt');
    keys.push(s.key.toUpperCase());
    return { label: keys.join(' + '), description: s.description };
  });
};
