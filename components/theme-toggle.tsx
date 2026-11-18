"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Theme = "light" | "dark" | "system";
const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

// Same key the no-flash script in app/layout.tsx reads.
const read = (): Theme => {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read);

  // Apply the class; in "system" mode, follow OS changes live.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const choose = (t: Theme) => {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {}
  };

  const Current = OPTIONS.find((o) => o.value === theme)!.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Theme" className="border text-muted-foreground" />}>
        <Current />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onClick={() => choose(value)} className={theme === value ? "font-semibold" : ""}>
            <Icon /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
