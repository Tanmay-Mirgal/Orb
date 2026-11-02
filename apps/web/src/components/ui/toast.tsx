"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const push = React.useCallback((kind: ToastKind, title: string, description?: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-3), { id, kind, title, description }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      success: (t, d) => push("success", t, d),
      error: (t, d) => push("error", t, d),
      info: (t, d) => push("info", t, d),
    }),
    [push],
  );

  const icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  const tone = { success: "text-success", error: "text-destructive", info: "text-info" };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite">
        {items.map((t) => {
          const Icon = icon[t.kind];
          return (
            <div key={t.id} className="animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-popover p-3.5 shadow-lg">
              <Icon className={cn("mt-0.5 size-4 shrink-0", tone[t.kind])} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{t.title}</p>
                {t.description && <p className="mt-0.5 break-words text-xs text-muted-foreground">{t.description}</p>}
              </div>
              <button className="text-muted-foreground hover:text-foreground" aria-label="Dismiss" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}>
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
