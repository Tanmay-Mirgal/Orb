"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Lightweight popover menu: closes on outside click, ESC and item activation. */
export function Dropdown({
  trigger,
  children,
  align = "start",
  className,
  panelClassName,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = React.useCallback(() => setOpen(false), []);
  return (
    <div ref={root} className={cn("relative", className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={cn(
            "animate-pop absolute top-full z-50 mt-1.5 min-w-56 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

const itemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground/90 transition-colors hover:bg-secondary [&_svg]:size-4 [&_svg]:text-muted-foreground";

export function DropdownItem({
  href,
  onClick,
  children,
  destructive,
}: {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  const cls = cn(itemClass, destructive && "text-destructive hover:bg-destructive/10 [&_svg]:text-destructive");
  if (href) {
    return (
      <Link role="menuitem" href={href} className={cls} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <button role="menuitem" type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</div>;
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
