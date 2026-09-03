import { dirname, join } from "node:path";

export function appRoot(): string {
  if (process.env.RBS_PLUGIN_ROOT) return process.env.RBS_PLUGIN_ROOT;
  if ((process as NodeJS.Process & { pkg?: unknown }).pkg) return dirname(process.execPath);
  return process.cwd();
}

export function appDataPath(...parts: string[]): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || appRoot();
  return join(base, "MagnificStock", ...parts);
}

export function appPath(...parts: string[]): string {
  return join(appRoot(), ...parts);
}
