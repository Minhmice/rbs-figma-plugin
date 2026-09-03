/**
 * Vector/raster conversion — NO bitmap tracing.
 * - SVG → passthrough
 * - ZIP → extract best file (SVG > EPS > AI > raster)
 * - EPS / PS / AI → Ghostscript → PDF → pdftocairo / Inkscape / mutool → SVG
 * - JPG / PNG → image bytes
 *
 * Linux (preferred):  apt install ghostscript poppler-utils
 * Optional quality:   apt install inkscape   # or mupdf-tools
 * Windows:            Inkscape + Ghostscript under Program Files also detected
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { mkdtemp, writeFile, readFile as readFileFs, rm } from "node:fs/promises";
import JSZip from "jszip";

export type ConvertResult =
  | { kind: "svg"; svg: string; source: "svg" | "eps-converted" }
  | { kind: "image"; bytes: Buffer; mime: string };

function isSvg(bytes: Buffer, hint: string): boolean {
  const lower = hint.toLowerCase();
  if (lower.endsWith(".svg") || lower.includes("image/svg")) return true;
  const head = bytes.subarray(0, Math.min(bytes.length, 256)).toString("utf8");
  return /<svg[\s>]/i.test(head);
}

function isZip(bytes: Buffer, hint: string): boolean {
  const lower = hint.toLowerCase();
  if (lower.endsWith(".zip") || lower.includes("application/zip") || lower.includes("application/x-zip")) {
    return true;
  }
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** EPS, PostScript, or Illustrator (.ai — often PDF-based). */
function isVectorPostscript(bytes: Buffer, hint: string): boolean {
  const lower = hint.toLowerCase();
  if (
    lower.endsWith(".eps") ||
    lower.endsWith(".esp") ||
    lower.endsWith(".ps") ||
    lower.endsWith(".ai") ||
    lower.includes("postscript") ||
    lower.includes("illustrator")
  ) {
    return true;
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 32)).toString("latin1");
  if (head.startsWith("%!PS") || head.includes("EPSF")) return true;
  if (head.startsWith("%PDF") && (lower.endsWith(".ai") || lower.includes("illustrator"))) return true;
  return false;
}

function isRaster(bytes: Buffer, hint: string): boolean {
  const lower = hint.toLowerCase();
  if (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.includes("image/jpeg") ||
    lower.includes("image/png") ||
    lower.includes("image/webp")
  ) {
    return true;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return true;
  return false;
}

function mimeFromBytes(bytes: Buffer, hint: string): string {
  const lower = hint.toLowerCase();
  if (lower.includes("image/png") || (bytes[0] === 0x89 && bytes[1] === 0x50)) return "image/png";
  if (lower.includes("image/webp") || lower.endsWith(".webp")) return "image/webp";
  if (
    lower.includes("image/jpeg") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    (bytes[0] === 0xff && bytes[1] === 0xd8)
  ) {
    return "image/jpeg";
  }
  return "image/png";
}

function scoreArchiveEntry(name: string): number {
  const n = name.toLowerCase().replace(/\\/g, "/");
  const base = n.split("/").pop() || n;
  if (base.startsWith(".__") || base.startsWith(".")) return -1;
  if (n.includes("__macosx/")) return -1;
  if (base.endsWith(".svg")) return 100;
  if (base.endsWith(".eps") || base.endsWith(".esp") || base.endsWith(".ps")) return 80;
  if (base.endsWith(".ai")) return 70;
  if (base.endsWith(".pdf")) return 50;
  if (base.endsWith(".png")) return 30;
  if (base.endsWith(".jpg") || base.endsWith(".jpeg") || base.endsWith(".webp")) return 20;
  return 0;
}

/** Pick best vector/raster file from a Magnific-style ZIP. */
export async function pickBestFromZip(
  zipBytes: Buffer
): Promise<{ name: string; bytes: Buffer }> {
  const zip = await JSZip.loadAsync(zipBytes);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const ranked = entries
    .map((f) => ({ f, s: scoreArchiveEntry(f.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name));
  if (!ranked.length) throw new Error("ZIP has no SVG / EPS / AI / image files");
  const best = ranked[0]!.f;
  const bytes = Buffer.from(await best.async("uint8array"));
  const name = best.name.replace(/\\/g, "/").split("/").pop() || best.name;
  return { name, bytes };
}

/** PATH-first, then Windows install dirs. Env overrides win. */
function inkscapeCandidates(): string[] {
  const home = homedir();
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(X86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
  return [
    process.env.INKSCAPE_PATH || "",
    "inkscape",
    "inkscape.com",
    join(pf, "Inkscape", "bin", "inkscape.exe"),
    join(pf, "Inkscape", "inkscape.exe"),
    join(pf86, "Inkscape", "bin", "inkscape.exe"),
    join(local, "Programs", "Inkscape", "bin", "inkscape.exe"),
  ].filter(Boolean);
}

function ghostscriptCandidates(): string[] {
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(X86)"] || "C:\\Program Files (x86)";
  // PATH names first (Linux `gs`, Windows shims)
  const out = [
    process.env.GS_PATH || "",
    "gs",
    "gswin64c",
    "gswin32c",
  ].filter(Boolean);
  for (const root of [pf, pf86]) {
    const gsRoot = join(root, "gs");
    if (!existsSync(gsRoot)) continue;
    try {
      for (const dir of readdirSync(gsRoot)) {
        const exe64 = join(gsRoot, dir, "bin", "gswin64c.exe");
        const exe32 = join(gsRoot, dir, "bin", "gswin32c.exe");
        if (existsSync(exe64)) out.push(exe64);
        if (existsSync(exe32)) out.push(exe32);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function pdftocairoCandidates(): string[] {
  return [process.env.PDFTOCAIRO_PATH || "", "pdftocairo"].filter(Boolean);
}

function mutoolCandidates(): string[] {
  return [process.env.MUTOOL_PATH || "", "mutool"].filter(Boolean);
}

async function runCmd(
  bin: string,
  args: string[],
  opts?: { cwd?: string }
): Promise<{ ok: boolean; code: number | null }> {
  if ((bin.includes("/") || bin.includes("\\")) && !existsSync(bin)) {
    return { ok: false, code: null };
  }
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: "ignore",
      shell: false,
      cwd: opts?.cwd,
      windowsHide: true,
    });
    child.on("error", () => resolve({ ok: false, code: null }));
    child.on("exit", (code) => resolve({ ok: code === 0, code }));
  });
}

async function readSvgIfExists(path: string): Promise<string | null> {
  try {
    const svg = await readFileFs(path, "utf8");
    return /<svg[\s>]/i.test(svg) ? svg : null;
  } catch {
    return null;
  }
}

function inputExtForHint(hint: string): string {
  const lower = hint.toLowerCase();
  if (lower.endsWith(".ai") || lower.includes("illustrator")) return ".ai";
  if (lower.endsWith(".ps")) return ".ps";
  if (lower.endsWith(".pdf")) return ".pdf";
  return ".eps";
}

function toolPresent(candidates: string[]): boolean {
  return candidates.some((b) => {
    if (b.includes("/") || b.includes("\\")) return existsSync(b);
    // PATH name — assume tryable (spawn will fail if missing)
    return true;
  });
}

async function pdfToSvgViaPdftocairo(pdfPath: string, outFile: string): Promise<string | null> {
  const base = outFile.replace(/\.svg$/i, "");
  for (const bin of pdftocairoCandidates()) {
    const { ok } = await runCmd(bin, ["-svg", pdfPath, base]);
    const svg =
      (await readSvgIfExists(outFile)) || (await readSvgIfExists(`${base}.svg`));
    if (ok && svg) return svg;
    // Some builds write even when exit code is non-zero
    if (svg) return svg;
  }
  return null;
}

async function pdfToSvgViaMutool(pdfPath: string, outFile: string): Promise<string | null> {
  for (const bin of mutoolCandidates()) {
    // mutool convert -o out.svg -F svg input.pdf
    const { ok } = await runCmd(bin, ["convert", "-o", outFile, "-F", "svg", pdfPath]);
    if (ok) {
      const svg = await readSvgIfExists(outFile);
      if (svg) return svg;
    }
    // Alternate: draw
    const { ok: ok2 } = await runCmd(bin, ["draw", "-o", outFile, "-F", "svg", pdfPath]);
    if (ok2) {
      const svg = await readSvgIfExists(outFile);
      if (svg) return svg;
    }
  }
  return null;
}

async function pdfToSvgViaInkscape(pdfPath: string, outFile: string): Promise<string | null> {
  for (const bin of inkscapeCandidates()) {
    const attempts = [
      ["--export-type=svg", `--export-filename=${outFile}`, "--export-plain-svg", pdfPath],
      ["--export-type=svg", `--export-filename=${outFile}`, pdfPath],
      [pdfPath, `--export-filename=${outFile}`, "--export-type=svg"],
    ];
    for (const args of attempts) {
      const { ok } = await runCmd(bin, args);
      if (!ok) continue;
      const svg = await readSvgIfExists(outFile);
      if (svg) return svg;
    }
  }
  return null;
}

/** PDF → SVG: pdftocairo (Linux default) → Inkscape → mutool */
async function pdfToSvg(pdfPath: string, outFile: string): Promise<string | null> {
  return (
    (await pdfToSvgViaPdftocairo(pdfPath, outFile)) ||
    (await pdfToSvgViaInkscape(pdfPath, outFile)) ||
    (await pdfToSvgViaMutool(pdfPath, outFile))
  );
}

async function epsToPdf(inFile: string, pdfFile: string): Promise<boolean> {
  for (const bin of ghostscriptCandidates()) {
    const { ok } = await runCmd(bin, [
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-dQUIET",
      "-dEPSCrop",
      "-sDEVICE=pdfwrite",
      `-sOutputFile=${pdfFile}`,
      inFile,
    ]);
    if (ok && existsSync(pdfFile)) return true;
  }
  return false;
}

async function epsToSvgDirect(inFile: string, outFile: string): Promise<string | null> {
  for (const bin of ghostscriptCandidates()) {
    const { ok } = await runCmd(bin, [
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-dQUIET",
      "-dEPSCrop",
      "-sDEVICE=svg",
      `-sOutputFile=${outFile}`,
      inFile,
    ]);
    if (ok) {
      const svg = await readSvgIfExists(outFile);
      if (svg) return svg;
    }
  }
  return null;
}

/**
 * Real vector convert. Never rasterizes + traces.
 *
 * Order (Linux-friendly):
 *   PDF/AI(PDF) → pdftocairo → Inkscape → mutool
 *   EPS/PS → Ghostscript pdfwrite → (same PDF→SVG chain) → else gs -sDEVICE=svg
 */
async function vectorBytesToSvg(bytes: Buffer, hint: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vec2svg-"));
  const ext = inputExtForHint(hint);
  const inFile = join(dir, `in${ext}`);
  const pdfFile = join(dir, "mid.pdf");
  const outFile = join(dir, "out.svg");
  try {
    await writeFile(inFile, bytes);
    const head = bytes.subarray(0, 8).toString("latin1");
    const isPdf = head.startsWith("%PDF");
    const isPs = head.startsWith("%!") || ext === ".eps" || ext === ".ps";

    // PDF-based AI / PDF → SVG converters directly
    if (isPdf) {
      const svg = await pdfToSvg(inFile, outFile);
      if (svg) return svg;
    }

    // EPS/PS/(PS-based AI) → PDF → SVG
    if (isPs || ext === ".ai" || ext === ".eps" || ext === ".ps") {
      let madePdf = isPdf ? inFile : "";
      if (!madePdf) {
        const ok = await epsToPdf(inFile, pdfFile);
        if (ok) madePdf = pdfFile;
      }
      if (madePdf) {
        const svg = await pdfToSvg(madePdf, outFile);
        if (svg) return svg;
      }

      // Last resort: Ghostscript cairo SVG device (common on Linux packages)
      const direct = await epsToSvgDirect(inFile, outFile);
      if (direct) return direct;
    }

    // Non-PS AI or leftover: try Inkscape / PDF chain on the raw file
    const fallback = await pdfToSvg(inFile, outFile);
    if (fallback) return fallback;

    const hasGs = toolPresent(ghostscriptCandidates());
    const hasCairo = toolPresent(pdftocairoCandidates());
    const hasInk = toolPresent(inkscapeCandidates());
    const hasMu = toolPresent(mutoolCandidates());
    throw new Error(
      `EPS/AI → SVG failed (gs ${hasGs ? "ok" : "missing"}, pdftocairo ${hasCairo ? "ok" : "missing"}, inkscape ${hasInk ? "ok" : "missing"}, mutool ${hasMu ? "ok" : "missing"}). ` +
        "Linux: sudo apt install ghostscript poppler-utils   # optional: inkscape mupdf-tools. " +
        "Windows: install Ghostscript + Inkscape, then restart the proxy."
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Serialize Ghostscript / Inkscape so parallel inserts don't pile up. */
let convertChain: Promise<unknown> = Promise.resolve();

export function withConvertLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = convertChain.then(fn, fn);
  convertChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function convertBytes(bytes: Buffer, filenameHint: string): Promise<ConvertResult> {
  if (isZip(bytes, filenameHint)) {
    const picked = await pickBestFromZip(bytes);
    return convertBytes(picked.bytes, picked.name);
  }

  if (isSvg(bytes, filenameHint)) {
    return { kind: "svg", svg: bytes.toString("utf8"), source: "svg" };
  }

  if (isVectorPostscript(bytes, filenameHint)) {
    const svg = await withConvertLock(() => vectorBytesToSvg(bytes, filenameHint));
    return { kind: "svg", svg, source: "eps-converted" };
  }

  if (isRaster(bytes, filenameHint)) {
    return { kind: "image", bytes, mime: mimeFromBytes(bytes, filenameHint) };
  }

  const head = bytes.subarray(0, 8).toString("latin1");
  if (head.startsWith("%!PS") || head.startsWith("%PDF")) {
    const svg = await withConvertLock(() =>
      vectorBytesToSvg(bytes, filenameHint || "in.pdf")
    );
    return { kind: "svg", svg, source: "eps-converted" };
  }

  throw new Error("Unsupported file — drop SVG, EPS, AI, ZIP, PNG, or JPG");
}
