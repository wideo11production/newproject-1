"use client"
import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@wideo11/ui/button';
import { Badge } from '@wideo11/ui/badge';
import { Card, CardContent } from '@wideo11/ui/card';
import { Play, Copy, Trash2 } from 'lucide-react';

// Local Textarea component since @wideo11/ui doesn't export it
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, value, onChange, onKeyDown, placeholder, rows, disabled, ...props }, ref) => (
  <textarea
    className={className}
    value={value}
    onChange={onChange}
    onKeyDown={onKeyDown}
    placeholder={placeholder}
    rows={rows}
    disabled={disabled}
    {...props}
    ref={ref}
  />
));
Textarea.displayName = 'Textarea';

// Local Command components since @wideo11/ui doesn't export them
const Command = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { className?: string }
>(({ children, className, ...props }, ref) => (
  <div className={className} ref={ref} {...props} />
));
Command.displayName = 'Command';

const CommandInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input className={className} ref={ref} {...props} />
));
CommandInput.displayName = 'CommandInput';

const CommandItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { className?: string; onSelect?: () => void }
>(({ children, className, onSelect, ...props }, ref) => (
  <div
    className={className}
    onClick={() => {
      onSelect?.();
    }}
    ref={ref}
    {...props}>
    {children}
  </div>
));
CommandItem.displayName = 'CommandItem';

const CommandList = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { className?: string }
>(({ children, className, ...props }, ref) => (
  <div className={className} ref={ref} {...props} />
));
CommandList.displayName = 'CommandList';

const CommandEmpty = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { className?: string }
>(({ children, className, ...props }, ref) => (
  <div className={className} ref={ref} {...props} />
));
CommandEmpty.displayName = 'CommandEmpty';

interface QueryEditorProps {
  query: string;
  onChange: (query: string) => void;
  onExecute: () => void;
  disabled?: boolean;
}

const promQLFunctions = [
  { name: 'rate', description: 'Calculates per-second rate of increase of the series' },
  { name: 'irate', description: 'Calculates per-second rate of increase (instantaneous)' },
  { name: 'increase', description: 'Calculates the total increase over a range' },
  { name: 'sum', description: 'Sum of all values' },
  { name: 'avg', description: 'Average of all values' },
  { name: 'max', description: 'Maximum value' },
  { name: 'min', description: 'Minimum value' },
  { name: 'count', description: 'Count of values' },
  { name: 'histogram_quantile', description: 'Calculate quantiles from histogram buckets' },
  { name: 'label_replace', description: 'Replace values in labels' },
  { name: 'topk', description: 'Top K values by value' },
  { name: 'bottomk', description: 'Bottom K values by value' },
  { name: 'abs', description: 'Absolute value' },
  { name: 'round', description: 'Round to nearest integer' },
  { name: 'timestamp', description: 'Returns unix timestamp' },
  { name: 'vector', description: 'Return the scalar value' },
];

export default function QueryEditor({ query, onChange, onExecute, disabled }: QueryEditorProps) {
  const [showFunctions, setShowFunctions] = useState(false);
  const [searchFunction, setSearchFunction] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredFunctions = promQLFunctions.filter(fn =>
    fn.name.toLowerCase().includes(searchFunction.toLowerCase())
  );

  const insertFunction = (fnName: string) => {
    const insertText = `${fnName}()`;
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = query.substring(0, start) + insertText + query.substring(end);
      onChange(newValue);
      
      const newCursorPos = start + fnName.length + 1;
      setTimeout(() => {
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      }, 0);
    } else {
      onChange(query + insertText);
    }
    setShowFunctions(false);
    setSearchFunction('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      onExecute();
    }
  };

  const commonQueries = [
    { name: 'HTTP Request Rate', query: 'sum(rate(http_requests_total[5m]))' },
    { name: 'CPU Usage', query: '100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' },
    { name: 'Memory Usage', query: '(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100' },
    { name: 'Active GoGoroutines', query: 'sum(go_goroutines)' },
    { name: 'NATS Message Rate', query: 'sum(rate(nats_server_in_msgs_total[5m]))' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
          onClick={() => setShowFunctions(!showFunctions)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
          onClick={() => navigator.clipboard.writeText(query)}
        >
          <Copy className="h-3 w-3 mr-1" /> Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExecute}
          disabled={disabled}
          className="border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
        >
          <Play className="h-3 w-3 mr-1" /> Run
        </Button>
      </div>

      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter PromQL query..."
          className="bg-gray-800/50 border-gray-700 text-gray-200 font-mono text-sm resize-none"
          rows={3}
          disabled={disabled}
        />
        <kbd className="absolute top-2 right-2 px-1 py-0.5 bg-gray-700 rounded text-xs text-gray-500">
          Ctrl+Enter
        </kbd>
      </div>

      {showFunctions && (
        <Card className="bg-gray-800/50 border-gray-700">
          <CardContent className="p-3">
            <Command className="w-full">
              <CommandInput
                placeholder="Search functions..."
                className="border-gray-700 text-gray-300"
                value={searchFunction}
                onChange={(e) => setSearchFunction(e.target.value)}
              />
              <CommandList className="max-h-60">
                <CommandEmpty>No function found.</CommandEmpty>
                {filteredFunctions.map((fn) => (
                  <CommandItem
                    key={fn.name}
                    onSelect={() => insertFunction(fn.name)}
                    className="flex flex-col items-start py-2 cursor-pointer hover:bg-gray-700/50"
                  >
                    <div className="flex items-center justify-between w-full">
                      <code className="text-blue-400">{fn.name}()</code>
                      <Badge variant="secondary" className="text-xs">
                        function
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{fn.description}</p>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {commonQueries.map((q) => (
          <Button
            key={q.name}
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start text-left text-gray-300 hover:bg-gray-800/50"
            onClick={() => onChange(q.query)}
          >
            <div className="flex flex-col">
              <span>{q.name}</span>
              <code className="text-xs text-gray-500 truncate max-w-full">
                {q.query}
              </code>
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
