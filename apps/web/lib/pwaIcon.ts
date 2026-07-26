import { readFileSync } from "node:fs";
import { join } from "node:path";

// Shared by app/icons/192/route.tsx and app/icons/512/route.tsx — Next.js's
// special-file icon convention (icon.png) only supports one size, PWA
// manifests need several, hence plain route handlers instead. Each route
// serves a pre-generated static PNG from public/icons/ rather than
// rendering one on the fly, since these are now real brand assets rather
// than a generated placeholder.
export function readPwaIcon(size: 192 | 512): ArrayBuffer {
  // Response's BodyInit type doesn't structurally accept Node's
  // Buffer/Uint8Array here (TS 5.7's generic typed arrays vs lib.dom's
  // BufferSource — see https://github.com/microsoft/TypeScript/issues/59417),
  // so this copies out a plain ArrayBuffer instead of returning the Buffer
  // read from disk directly.
  const buffer = readFileSync(join(process.cwd(), "public", "icons", `pwa-${size}.png`));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
