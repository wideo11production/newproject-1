// ============================================================================
// TEXTAREA - Borderless UI Component (@wideo11/ui/textarea)
// ============================================================================
//
// Hinglish: Ye borderless textarea component hai jo Grafana Dark Charcoal
// theme (#161616) ke saath matching hai. 10px icon/text sizing ka use karta
// hai jisse movavi-style interface ban sake. Focus ring #ff6500 (orange) hai.
//
// Design: rounded-md, border-0, bg-background (transparent/dark mode se inherit)
//
// Export: @wideo11/ui/textarea se direct import karo -> import { Textarea } from '@wideo11/ui/textarea';
//
// ============================================================================
import * as React from "react";
import { cn } from "./lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border-0 bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };