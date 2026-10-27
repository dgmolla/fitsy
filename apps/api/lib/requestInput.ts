import { NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';

/** Bound bytes before parsing, including chunked bodies and ignored extensions. */
export async function parseRequestInput<T extends z.ZodType>(
  request: NextRequest, schema: T, maxBytes: number, invalidMessage: string,
): Promise<z.output<T> | NextResponse<{ error: string }>> {
  if (Number(request.headers.get('content-length')) > maxBytes) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel().catch(() => {});
            return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  // Never return a Zod issue: it may contain personal values or unknown keys.
  return parsed.success ? parsed.data : NextResponse.json({ error: invalidMessage }, { status: 400 });
}
