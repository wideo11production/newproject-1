import { NextResponse } from "next/server";

const ANALYTICS_SERVICE_URL =
  process.env.ANALYTICS_INTERNAL_URL ?? "http://analytics-service:8086";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const qs = url.searchParams.toString();
    const res = await fetch(`${ANALYTICS_SERVICE_URL}/api/v1/ui-clicks${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: authHeader },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream_error", status: res.status }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
