import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { LuX } from 'react-icons/lu';
import type { ComponentProps } from 'react';
import { cn } from '@/shared/class-names.ts';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = ({
  className,
  side = 'left',
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup> & { side?: 'left' | 'right' }) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-slate-950/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
    <DialogPrimitive.Popup
      className={(state) =>
        cn(
          'fixed inset-y-0 z-50 w-[min(88vw,20rem)] overscroll-contain overflow-y-auto border-border bg-panel px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-foreground shadow-xl transition-transform duration-200 motion-reduce:transition-none',
          side === 'left'
            ? 'left-0 border-r data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full'
            : 'right-0 border-l data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <LuX size={16} aria-hidden="true" />
        <span className="sr-only">Close panel</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Popup>
  </DialogPrimitive.Portal>
);

export const SheetTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={(state) =>
      cn('mb-4 text-sm font-semibold', typeof className === 'function' ? className(state) : className)
    }
    {...props}
  />
);
