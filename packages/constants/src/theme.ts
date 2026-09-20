export const THEMES = {
  light: {
    name: "light",
    label: "Light",
    colors: {
      background: "#ffffff",
      foreground: "#0f172a",
      primary: "#2563eb",
      "primary-foreground": "#ffffff",
      secondary: "#f1f5f9",
      "secondary-foreground": "#0f172a",
      muted: "#f1f5f9",
      "muted-foreground": "#64748b",
      accent: "#f1f5f9",
      "accent-foreground": "#0f172a",
      destructive: "#ef4444",
      "destructive-foreground": "#ffffff",
      border: "#e2e8f0",
      input: "#e2e8f0",
      ring: "#2563eb",
      card: "#ffffff",
      "card-foreground": "#0f172a",
      popover: "#ffffff",
      "popover-foreground": "#0f172a",
    },
  },
  dark: {
    name: "dark",
    label: "Dark",
    colors: {
      background: "#0f172a",
      foreground: "#f8fafc",
      primary: "#3b82f6",
      "primary-foreground": "#ffffff",
      secondary: "#1e293b",
      "secondary-foreground": "#f8fafc",
      muted: "#1e293b",
      "muted-foreground": "#94a3b8",
      accent: "#1e293b",
      "accent-foreground": "#f8fafc",
      destructive: "#ef4444",
      "destructive-foreground": "#ffffff",
      border: "#334155",
      input: "#334155",
      ring: "#3b82f6",
      card: "#1e293b",
      "card-foreground": "#f8fafc",
      popover: "#1e293b",
      "popover-foreground": "#f8fafc",
    },
  },
  grafana: {
    name: "grafana",
    label: "Grafana Dark",
    colors: {
      background: "#1f1f1f",
      foreground: "#e0e0e0",
      primary: "#268bd2",
      "primary-foreground": "#ffffff",
      secondary: "#2d2d2d",
      "secondary-foreground": "#e0e0e0",
      muted: "#2d2d2d",
      "muted-foreground": "#9ca3af",
      accent: "#2d2d2d",
      "accent-foreground": "#e0e0e0",
      destructive: "#e74c3c",
      "destructive-foreground": "#ffffff",
      border: "#3a3a3a",
      input: "#3a3a3a",
      ring: "#268bd2",
      card: "#2d2d2d",
      "card-foreground": "#e0e0e0",
      popover: "#2d2d2d",
      "popover-foreground": "#e0e0e0",
    },
  },
} as const;

export type ThemeName = keyof typeof THEMES;
export type Theme = (typeof THEMES)[ThemeName];

export const DEFAULT_THEME: ThemeName = "dark";

export function getTheme(name: ThemeName): Theme {
  return THEMES[name];
}

export function getCSSVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors)) {
    vars[`--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`] = value;
  }
  return vars;
}