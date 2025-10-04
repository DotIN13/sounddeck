// --------------------------------------------------------------------
// file: app/api/media/route.ts (Generic proxy for arbitrary media URLs)
// --------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  try {
    const r = await fetch(target, { cache: "no-store" });
    const ct = r.headers.get("content-type") || "application/octet-stream";
    const body = await r.arrayBuffer();
    const res = new NextResponse(body, { status: r.status });
    res.headers.set("content-type", ct);
    res.headers.set("access-control-allow-origin", "*");
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Media proxy failed" },
      { status: 502 }
    );
  }
}
