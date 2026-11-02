import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    variant: {
      neutral: "border-border bg-secondary text-muted-foreground",
      outline: "border-border bg-transparent text-muted-foreground",
      success: "border-success/25 bg-success/10 text-success",
      warning: "border-warning/30 bg-warning/10 text-warning",
      danger: "border-destructive/25 bg-destructive/10 text-destructive",
      info: "border-info/25 bg-info/10 text-info",
      accent: "border-accent/25 bg-accent-soft text-accent",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
  pulse?: boolean;
}

export function Badge({ className, variant, dot, pulse, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

/** Deployment lifecycle → badge. One place so every screen shows identical colours and wording. */
const STATUS: Record<string, { label: string; variant: BadgeProps["variant"]; pulse?: boolean }> = {
  READY: { label: "Ready", variant: "success" },
  QUEUED: { label: "Queued", variant: "warning", pulse: true },
  BUILDING: { label: "Building", variant: "warning", pulse: true },
  DEPLOYING: { label: "Deploying", variant: "info", pulse: true },
  FAILED: { label: "Failed", variant: "danger" },
  CANCELED: { label: "Canceled", variant: "neutral" },
  ARCHIVED: { label: "Archived", variant: "neutral" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, variant: "neutral" as const };
  return (
    <Badge variant={s.variant} dot pulse={s.pulse} className={className}>
      {s.label}
    </Badge>
  );
}

export { badgeVariants };
