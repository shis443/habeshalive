"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "birq-theme";

// Mirrors what layout.tsx's inline blocking script already applied before
// hydration — reading the DOM attribute here (not localStorage directly)
// means this can never disagree with what's actually on screen.
function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<"light" | "dark">("dark");

  // Reads the real DOM state on mount instead of trusting a hardcoded
  // initial value — avoids a server/client mismatch, since the server has
  // no way to know the visitor's stored preference.
  useEffect(() => {
    setThemeState(currentTheme());
  }, []);

  function toggleTheme() {
    const next = currentTheme() === "light" ? "dark" : "light";
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  return { theme, toggleTheme };
}
