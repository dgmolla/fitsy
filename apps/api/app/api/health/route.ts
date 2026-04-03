import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("Restaurant").select("id").limit(1);
    if (error) throw new Error(error.message);
    return NextResponse.json({
      status: "ok",
      db: "connected",
      version: process.env["npm_package_version"] ?? "unknown",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "error", db: "unreachable", error: message },
      { status: 503 },
    );
  }
}
