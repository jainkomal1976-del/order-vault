export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  surface: string;
  onSurface: string;
  surfaceSecondary: string;
  onSurfaceSecondary: string;
  surfaceTertiary: string;
  onSurfaceTertiary: string;
  brandPrimary: string;
  onBrandPrimary: string;
  brandTertiary: string;
  onBrandTertiary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  border: string;
  borderStrong: string;
  divider: string;
  muted: string;
}

const light: ThemeColors = {
  surface: "#F2F2F7",
  onSurface: "#1C1C1E",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1C1C1E",
  surfaceTertiary: "#E5E5EA",
  onSurfaceTertiary: "#1C1C1E",
  brandPrimary: "#000000",
  onBrandPrimary: "#FFFFFF",
  brandTertiary: "#E5E5EA",
  onBrandTertiary: "#000000",
  success: "#34C759",
  warning: "#FF9500",
  error: "#FF3B30",
  info: "#8E8E93",
  border: "#C6C6C8",
  borderStrong: "#8E8E93",
  divider: "#C6C6C8",
  muted: "#6E6E73",
};

const dark: ThemeColors = {
  surface: "#000000",
  onSurface: "#F2F2F7",
  surfaceSecondary: "#1C1C1E",
  onSurfaceSecondary: "#F2F2F7",
  surfaceTertiary: "#2C2C2E",
  onSurfaceTertiary: "#F2F2F7",
  brandPrimary: "#FFFFFF",
  onBrandPrimary: "#000000",
  brandTertiary: "#2C2C2E",
  onBrandTertiary: "#FFFFFF",
  success: "#30D158",
  warning: "#FF9F0A",
  error: "#FF453A",
  info: "#98989D",
  border: "#38383A",
  borderStrong: "#636366",
  divider: "#38383A",
  muted: "#A1A1A6",
};

export const themes: Record<ThemeMode, ThemeColors> = { light, dark };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};
