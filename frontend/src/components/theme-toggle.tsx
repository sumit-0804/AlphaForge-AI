"use client";

import { useTheme } from "next-themes";
import { SunIcon, MoonIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

// Flip between light and dark. The two icons are both rendered and CSS shows the
// right one for the active theme — no mounted-state flag, so no hydration flash.
export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon size={16} className="hidden dark:block" />
      <MoonIcon size={16} className="block dark:hidden" />
    </Button>
  );
}
