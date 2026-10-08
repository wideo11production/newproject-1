import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "./lib/utils";

const Accordion = AccordionPrimitive.Root;

/**
 * AccordionItem - ek collapsible item ka wrapper (borders + styling)
 *
 * ---- BUG FIX (critically broken pehle) ----
 * Ye component PEHLE ye render karta tha:
 *
 *     <AccordionPrimitive.Item {...props}>
 *       <Header><Trigger /></Header>     <-- apna KHUD ka trigger
 *     </AccordionPrimitive.Item>
 *
 * `...props` me `children` jaata tha, matlab consumer ka
 * `<AccordionTrigger>` + `<AccordionContent>` bhi `Item` ke children ban
 * jaate the. Radix `Item` ko exactly `[Header, Content]` chahiye - extra
 * children milne par wo unhe DISCARD kar deta hai.
 *
 * Net result: consumer ka trigger + content kabhi DOM me nahi pahunchte.
 * Sirf ek KHALI trigger (sirf chevron icon, koi text nahi) render hota tha.
 * Iska matlab: koi bhi standard shadcn usage
 * (`<AccordionItem><AccordionTrigger>Q</AccordionTrigger><AccordionContent>A</AccordionContent></AccordionItem>`)
 * silently ek KHAALI, text-less accordion de raha tha - jo screen readers
 * ke liye bekaar thi (accessible name zero).
 *
 * NOTE: ye tab tak unnoticed raha kyunki build/TS kuch nahi todta - sirf
 * runtime DOM galat banta hai. Isliye is type ke bugs ke liye rendered
 * HTML verify karna zaroori hai, typecheck kaafi nahi.
 *
 * THE FIX: `AccordionItem` ab pure pass-through wrapper hai (shadcn ka
 * canonical behaviour). Consumer apna `AccordionTrigger` + `AccordionContent`
 * children ke roop me deta hai, aur Radix unhe sahi jagah mount karta hai
 * ([Header, Content]) - jisse aria-expanded, aria-controls, keyboard nav
 * sab sahi se kaam karte hain.
 *
 * NOTE (breaking change surface): repo me is component ka sirf ek consumer
 * tha (`apps/web/src/components/landing/faq-portal.tsx`), aur wo already
 * standard shadcn API use kar raha tha - isliye ye fix usko theek karta
 * hai, kisi aur ko toota nahi. (Verified: full-repo grep)
 */
const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn("border-b border-muted/20", className)}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
      className
    )}
    {...props}
  >
    {children}
    <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground transition-transform duration-150" />
  </AccordionPrimitive.Trigger>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className="overflow-hidden text-sm transition-all data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-up-2 data-[state=open]:slide-down-2"
    {...props}
  >
    <div className={cn("pb-4", className)}>{children}</div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };