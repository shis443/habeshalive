import { readPwaIcon } from "@/lib/pwaIcon";

export function GET() {
  return new Response(readPwaIcon(192), { headers: { "Content-Type": "image/png" } });
}
