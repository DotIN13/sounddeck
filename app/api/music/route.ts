// --------------------------------------------------------------------
// file: app/api/music/route.ts  (Proxy to GDStudio API)
// --------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
const API_BASE = "https://music-api.gdstudio.xyz/api.php";
export async function GET(req: NextRequest) {
  const url = new URL(API_BASE);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));
  const allowed = new Set(["search", "url", "pic", "lyric"]);
  const t = url.searchParams.get("types");
  if (!t || !allowed.has(t))
    return NextResponse.json(
      { error: "Invalid or missing 'types'" },
      { status: 400 }
    );
  try {
    const r = await fetch(url.toString(), { cache: "no-store" });
    const ct = r.headers.get("content-type") || "application/json";
    const body = await r.arrayBuffer();
    const res = new NextResponse(body, { status: r.status });
    res.headers.set("content-type", ct);
    res.headers.set("access-control-allow-origin", "*");
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Proxy failed" },
      { status: 502 }
    );
  }
}
