import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { LuX } from 'react-icons/lu';
import type { ComponentProps } from 'react';
import { cn } from '@/shared/class-names.ts';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = ({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Popup>) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[1px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
    <DialogPrimitive.Popup
      className={(state) =>
        cn(
          'fixed left-1/2 top-1/2 z-50 grid max-h-[min(85vh,44rem)] w-[min(calc(100vw-2rem),32rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl transition data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <LuX size={16} aria-hidden="true" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Popup>
  </DialogPrimitive.Portal>
);

export const DialogTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={(state) =>
      cn('text-sm font-semibold text-foreground', typeof className === 'function' ? className(state) : className)
    }
    {...props}
  />
);

export const DialogDescription = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={(state) =>
      cn('text-[13px] text-muted-foreground', typeof className === 'function' ? className(state) : className)
    }
    {...props}
  />
);
