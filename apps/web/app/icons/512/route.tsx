import { readPwaIcon } from "@/lib/pwaIcon";

export function GET() {
  return new Response(readPwaIcon(512), { headers: { "Content-Type": "image/png" } });
}
