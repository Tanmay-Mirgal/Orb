"use client";

import * as React from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { Button } from "@/components/ui/button";
import { THEME_COOKIE } from "@/lib/theme-cookie";

export type ThemeChoice = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
}
const ThemeContext = React.createContext<ThemeContextValue>({ theme: "system", setTheme: () => undefined });

function apply(theme: ThemeChoice) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (theme !== "system") root.classList.add(theme);
}

export function ThemeProvider({ initial, children }: { initial: ThemeChoice; children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemeChoice>(initial);

  const setTheme = React.useCallback((t: ThemeChoice) => {
    setThemeState(t);
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
    apply(t);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => React.useContext(ThemeContext);

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Laptop;
  return (
    <Dropdown
      align="end"
      panelClassName="min-w-40"
      trigger={({ toggle }) => (
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Change theme">
          <Icon />
        </Button>
      )}
    >
      {(close) => (
        <>
          {(
            [
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
              ["system", "System", Laptop],
            ] as const
          ).map(([id, label, I]) => (
            <DropdownItem
              key={id}
              onClick={() => {
                setTheme(id);
                close();
              }}
            >
              <I /> {label}
              {theme === id && <span className="ml-auto size-1.5 rounded-full bg-accent" />}
            </DropdownItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}
