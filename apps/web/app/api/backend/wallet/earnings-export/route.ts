import { NextResponse } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { getSessionToken } from "@/lib/session";

// Dedicated route, not routed through the generic [...path] proxy — that
// proxy hardcodes "Content-Type: application/json" on every response
// (fine for its many JSON callers, but it would silently mislabel this
// CSV download and drop the Content-Disposition header a browser needs to
// actually save it as a file instead of trying to render it inline).
export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const res = await fetch(`${API_INTERNAL_URL}/wallet/earnings-export`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to generate report" }, { status: res.status });
  }

  const csv = await res.text();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="birq-earnings.csv"',
    },
  });
}
