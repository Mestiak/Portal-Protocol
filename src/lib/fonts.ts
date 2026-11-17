// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

// Single source of truth for the UI font list. The Settings dropdown, the
// applied CSS stack, and the Google Fonts request are all derived from this
// array — adding a font is one entry here.

export interface FontOption {
  /** Persisted in config.app_font. */
  id: string;
  /** Label shown in the Settings dropdown. */
  label: string;
  /** CSS font-family stack applied to `--font`. */
  stack: string;
  /** Google Fonts family spec (without the leading "family="). */
  google?: string;
}

export const APP_FONTS: FontOption[] = [
  {
    id: "outfit",
    label: "Outfit (Default)",
    stack: "'Outfit', system-ui, -apple-system, sans-serif",
    google: "Outfit:wght@400;500;600;700",
  },
  {
    id: "inter",
    label: "Inter (Sleek Sans)",
    stack: "'Inter', system-ui, -apple-system, sans-serif",
    google: "Inter:wght@400;500;600;700",
  },
  {
    id: "dm-sans",
    label: "DM Sans (Compact Modern)",
    stack: "'DM Sans', system-ui, -apple-system, sans-serif",
    google: "DM+Sans:wght@400;500;600;700",
  },
  {
    id: "manrope",
    label: "Manrope (Clean Geometric)",
    stack: "'Manrope', system-ui, -apple-system, sans-serif",
    google: "Manrope:wght@400;500;600;700",
  },
  {
    id: "space-grotesk",
    label: "Space Grotesk (Techy)",
    stack: "'Space Grotesk', system-ui, -apple-system, sans-serif",
    google: "Space+Grotesk:wght@400;500;600;700",
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono (Terminal)",
    stack: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
    google: "JetBrains+Mono:wght@400;500;600;700",
  },
  {
    id: "system",
    label: "System UI (Native)",
    stack: "system-ui, -apple-system, sans-serif",
  },
];

export const DEFAULT_FONT_ID = "outfit";

/** CSS stack for a font id; unknown ids fall back to the default. */
export function fontStack(id: string): string {
  return (
    APP_FONTS.find((f) => f.id === id)?.stack ??
    APP_FONTS.find((f) => f.id === DEFAULT_FONT_ID)!.stack
  );
}

/** Combined Google Fonts css2 URL built from every font that needs loading. */
export function googleFontsHref(): string {
  const families = APP_FONTS.map((f) => f.google).filter((g): g is string => !!g);
  return `https://fonts.googleapis.com/css2?${families.map((g) => `family=${g}`).join("&")}&display=swap`;
}

/** Inject the Google Fonts stylesheet once, built from the same font list. */
export function ensureGoogleFontsLink(): void {
  if (typeof document === "undefined") return;
  let link = document.getElementById("app-google-fonts") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = "app-google-fonts";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = googleFontsHref();
}
