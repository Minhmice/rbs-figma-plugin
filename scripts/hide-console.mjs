import { readFile, writeFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/hide-console.mjs <exe>");
const data = await readFile(path);
if (data.readUInt16LE(0) !== 0x5a4d) throw new Error("Not a Windows executable");
const peOffset = data.readUInt32LE(0x3c);
if (data.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
  throw new Error("Invalid PE header");
}
const optionalHeader = peOffset + 4 + 20;
const magic = data.readUInt16LE(optionalHeader);
if (magic !== 0x10b && magic !== 0x20b) throw new Error("Unsupported PE optional header");
const subsystem = optionalHeader + 68;
if (data.readUInt16LE(subsystem) !== 3) throw new Error("Expected console subsystem");
data.writeUInt16LE(2, subsystem);
await writeFile(path, data);
console.log(`Windows GUI subsystem set: ${path}`);
