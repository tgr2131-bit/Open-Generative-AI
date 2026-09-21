import { NextResponse } from 'next/server';
import { hasServerApiKey } from '../../../src/lib/muapiKey';

// Read at request time so the value reflects the running process environment
// rather than whatever was present during `next build`.
export const dynamic = 'force-dynamic';

/**
 * Tells the browser whether this deployment supplies the Muapi key server-side
 * (MUAPI_API_KEY). The key itself is never sent - only whether one exists, which
 * is what the UI needs to decide between showing the key prompt and going
 * straight to the studio.
 */
export async function GET() {
    return NextResponse.json(
        { serverApiKey: hasServerApiKey() },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
