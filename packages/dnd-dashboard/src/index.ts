import { useState, useCallback, useMemo, ReactNode } from 'react';
import { useStore } from 'zustand';

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  isDraggable?: boolean;
  isResizable?: boolean;
  static?: boolean;
  type?: string;
  title?: string;
  content?: ReactNode;
  data?: any;
}

export interface GridLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  items: GridItem[];
  cols?: number;
  rowHeight?: number;
  gap?: number;
  isDraggable?: boolean;
  isResizable?: boolean;
  verticalCompact?: boolean;
  preventCollision?: boolean;
  compactType?: 'vertical' | 'horizontal' | null;
  allowOverlap?: boolean;
  autoSize?: boolean;
  onLayoutChange?: (items: GridItem[]) => void;
  onDragStart?: (item: GridItem, handler: any) => void;
  onDragStop?: (item: GridItem, handler: any) => void;
  onResizeStart?: (item: GridItem, handler: any) => void;
  onResizeStop?: (item: GridItem, handler: any) => void;
}

interface GridLayoutStore {
  items: GridItem[];
  draggedItem: string | null;
  setItems: (items: GridItem[]) => void;
  setDraggedItem: (id: string | null) => void;
}

export const useGridLayoutStore = useStore<GridLayoutStore>(
  (set) => ({
    items: [],
    draggedItem: null,
    setItems: (items) => set({ items }),
    setDraggedItem: (id) => set({ draggedItem: id }),
  })
);

export function GridLayout({
  items,
  cols = 12,
  rowHeight = 100,
  gap = 10,
  isDraggable = true,
  isResizable = true,
  onLayoutChange,
  ...props
}: GridLayoutProps) {
  const [layout, setLayout] = useState(items);
  const { setDraggedItem } = useGridLayoutStore();

  const handleLayoutChange = useCallback(
    (newLayout: GridItem[]) => {
      setLayout(newLayout);
      onLayoutChange?.(newLayout);
    },
    [onLayoutChange]
  );

  const getItemById = useCallback(
    (id: string): GridItem | undefined => layout.find((item) => item.i === id),
    [layout]
  );

  const renderItem = useCallback(
    (item: GridItem) => {
      const { x, y, w, h } = item;
      const width = (w / cols) * 100;
      const height = h * rowHeight + 'px';
      
      return (
        <div
          key={item.i}
          className="absolute bg-gray-900/50 border border-gray-700 rounded-lg shadow-lg cursor-move hover:shadow-xl transition-shadow"
          style={{
            left: `${(x / cols) * 100}%`,
            top: `${y * rowHeight}px`,
            width: `${width}%`,
            height: height,
            marginRight: `${gap}px`,
            marginBottom: `${gap}px`,
            zIndex: item.i === layout[layout.length - 1].i ? 10 : 1,
          }}
          draggable={isDraggable}
          onDragStart={() => setDraggedItem(item.i)}
          onDragEnd={() => setDraggedItem(null)}
        >
          {item.content || item.title}
        </div>
      );
    },
    [layout, cols, rowHeight, gap, isDraggable, setDraggedItem]
  );

  const sortedItems = useMemo(
    () => [...layout].sort((a, b) => (a.y - b.y) || (a.x - b.x)),
    [layout]
  );

  return (
    <div
      className="relative w-full"
      style={{
        height: `${Math.max(...sortedItems.map((i) => i.y + i.h)) * (rowHeight + gap)}px`,
      }}
      {...props}
    >
      {sortedItems.map(renderItem)}
    </div>
  );
}

export function useDraggableGridItem(item: GridItem) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const handleDragStart = (e: DragEvent) => {
      setIsDragging(true);
      const rect = node.getBoundingClientRect();
      setPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };

    const handleDragEnd = () => {
      setIsDragging(true);
    };

    node.addEventListener('dragstart', handleDragStart);
    node.addEventListener('dragend', handleDragEnd);

    return () => {
      node.removeEventListener('dragstart', handleDragStart);
      node.removeEventListener('dragend', handleDragEnd);
    };
  }, []);

  return { dragRef, isDragging, position };
}

export class DragDropEngine {
  private container: HTMLElement | null = null;
  private items: GridItem[] = [];
  private cols: number = 12;
  private rowHeight: number = 100;
  private gap: number = 10;

  constructor(container: HTMLElement, options?: Partial<{ cols: number; rowHeight: number; gap: number }>) {
    this.container = container;
    if (options) {
      this.cols = options.cols ?? this.cols;
      this.rowHeight = options.rowHeight ?? this.rowHeight;
      this.gap = options.gap ?? this.gap;
    }
  }

  addItem(item: Partial<GridItem> & { i: string }): GridItem {
    const fullItem: GridItem = {
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      ...item,
    };
    this.items.push(fullItem);
    this.relayout();
    return fullItem;
  }

  removeItem(id: string) {
    this.items = this.items.filter((item) => item.i !== id);
    this.relayout();
  }

  moveItem(fromId: string, toId: string) {
    const fromIndex = this.items.findIndex((i) => i.i === fromId);
    const toIndex = this.items.findIndex((i) => i.i === toId);
    if (fromIndex !== -1 && toIndex !== -1) {
      const [moved] = this.items.splice(fromIndex, 1);
      this.items.splice(toIndex, 0, moved);
      this.relayout();
    }
  }

  resizeItem(id: string, w: number, h: number) {
    const item = this.items.find((i) => i.i === id);
    if (item) {
      item.w = w;
      item.h = h;
      this.relayout();
    }
  }

  private relayout() {
    const sorted = [...this.items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    sorted.forEach((item, index) => {
      const row = Math.floor(index / this.cols);
      const col = index % this.cols;
      item.x = col;
      item.y = row;
    });
  }

  getLayout(): GridItem[] {
    return [...this.items];
  }

  destroy() {
    this.container = null;
    this.items = [];
  }
}

export type { GridItem };
export default GridLayout;
