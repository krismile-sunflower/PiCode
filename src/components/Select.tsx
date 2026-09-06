import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  /** Accessible name for the trigger. */
  ariaLabel: string;
  /** Trigger label when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /** 'field' matches form inputs; 'compact' fits table rows; 'ghost'/'glass' sit on toolbars. */
  variant?: 'field' | 'compact' | 'ghost' | 'glass';
  /** Popover alignment relative to the trigger. */
  align?: 'start' | 'end';
  /** Element rendered before the trigger label (e.g. an icon). */
  leading?: ReactNode;
  className?: string;
}

const TRIGGER_STYLES: Record<NonNullable<SelectProps['variant']>, string> = {
  field: 'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-muted px-2.5 text-left text-[12px] text-primary hover:border-line-hover',
  compact: 'flex h-7 w-full items-center justify-between gap-1.5 rounded-lg border border-line bg-muted px-2 text-left text-[11px] text-primary hover:border-line-hover',
  ghost: 'inline-flex h-[29px] items-center justify-between gap-1.5 rounded-md border border-transparent bg-transparent px-2 text-[10px] text-secondary hover:border-line hover:bg-glass-hover hover:text-primary',
  glass: 'inline-flex h-[30px] items-center justify-between gap-1.5 rounded-[7px] border border-transparent bg-glass px-2.5 text-[10px] text-secondary hover:border-line hover:bg-elevated hover:text-primary',
};

const MENU_MAX_HEIGHT = 280;

/**
 * The app's single dropdown: a styled trigger plus a portal-rendered listbox.
 * Replaces native <select>, which cannot match the design system and gets
 * clipped by overflow-hidden cards.
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  disabled,
  variant = 'field',
  align = 'start',
  leading,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !listRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Any scroll outside the menu would detach it from the trigger; closing is
    // simpler and safer than tracking repositioning. Scroll events from the
    // menu's own option list must be ignored, or long lists close themselves
    // the moment the user scrolls them.
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let initial = selectedIndex >= 0 ? selectedIndex : 0;
    for (let step = 0; step < options.length && options[initial]?.disabled; step += 1) {
      initial = (initial + 1) % options.length;
    }
    setActive(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  if (disabled) {
    return (
      <div className={`${TRIGGER_STYLES[variant]} opacity-50 cursor-not-allowed ${className || ''}`} aria-disabled="true">
        {leading}
        <span className="min-w-0 truncate">{selected?.label ?? placeholder ?? value}</span>
        <ChevronDown size={12} className="flex-none opacity-60" aria-hidden="true" />
      </div>
    );
  }

  const openMenu = () => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    if (triggerRect) {
      setRect({ left: triggerRect.left, top: triggerRect.top, bottom: triggerRect.bottom, width: triggerRect.width });
    }
    setOpen(true);
  };

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const move = (delta: number) => {
    setActive((current) => {
      let next = current;
      for (let step = 0; step < options.length; step += 1) {
        next = (next + delta + options.length) % options.length;
        if (!options[next]?.disabled) break;
      }
      return next;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[active];
      if (option && !option.disabled) commit(option.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  const menu =
    open && rect
      ? createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[500] max-h-[280px] overflow-auto rounded-lg border border-line bg-elevated p-1 shadow-lg"
            style={{
              top: rect.bottom + 4 + MENU_MAX_HEIGHT > window.innerHeight ? undefined : rect.bottom + 4,
              bottom:
                rect.bottom + 4 + MENU_MAX_HEIGHT > window.innerHeight ? window.innerHeight - rect.top + 4 : undefined,
              ...(align === 'end'
                ? { right: window.innerWidth - rect.left - rect.width }
                : { left: rect.left }),
              minWidth: rect.width,
            }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === active && !option.disabled;
              return (
                <button
                  className={`flex w-full items-center justify-between gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-[12px] ${
                    option.disabled
                      ? 'cursor-not-allowed opacity-40'
                      : isActive
                        ? 'bg-accent-subtle text-accent-text cursor-pointer'
                        : 'text-secondary hover:bg-glass-hover hover:text-primary cursor-pointer'
                  }`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-active={isActive}
                  key={option.value}
                  onMouseEnter={() => !option.disabled && setActive(index)}
                  onClick={() => !option.disabled && commit(option.value)}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {isSelected ? <Check size={12} className="flex-none text-accent-text" /> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={`relative ${className || ''}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        className={`${TRIGGER_STYLES[variant]}${open ? ' border-accent shadow-[0_0_0_2px_var(--accent-subtle)]' : ''}${selected ? '' : ' text-dim'}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {leading}
        <span className="min-w-0 truncate">{selected?.label ?? placeholder ?? value}</span>
        <ChevronDown
          size={variant === 'ghost' || variant === 'glass' ? 10 : 12}
          className={`flex-none opacity-70 transition-transform duration-[var(--duration-fast)]${open ? ' rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {menu}
    </div>
  );
}
