// ============================================================================
// FIELD - Borderless Form Field (@wideo11/ui/field)
// ============================================================================
//
// Hinglish: Ye borderless field component hai jo form labels aur hints ke liye
// use hota hai. rounded-md border-0 design ke saath, Grafana panel background
// (#1e1e1e Grayish-Black Slate) se match karta hai.
//
// Features:
//   - label prop: field ka label render karta hai
//   - hint prop: inline help text dikhata hai
//   - htmlFor prop: label ko input se associate karta hai
//
// Export: @wideo11/ui/field se direct import karo -> import { Field } from '@wideo11/ui/field';
//
// ============================================================================
import * as React from "react";
import { cn } from "./lib/utils";

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  htmlFor?: string;
  hint?: string;
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, label, htmlFor, hint, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col space-y-2 rounded-md border-0 bg-transparent p-0",
          className
        )}
        {...props}
      >
        {label && (
          <label
            htmlFor={htmlFor}
            className="text-sm font-medium leading-none text-muted-foreground"
          >
            {label}
          </label>
        )}
        {hint && (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
        {children}
      </div>
    );
  }
);
Field.displayName = "Field";

export { Field };