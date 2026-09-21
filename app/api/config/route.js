import { NextResponse } from 'next/server';
import { hasServerApiKey } from '../../../src/lib/muapiKey';
import { getMuapiBaseUrl, isDefaultMuapiBaseUrl } from '../../../src/lib/muapiBase';

// Read at request time so the values reflect the running process environment
// rather than whatever was present during `next build`.
export const dynamic = 'force-dynamic';

/**
 * Reports how this deployment is configured. The API key itself is never sent -
 * only whether one exists, which is what the UI needs to decide between showing
 * the key prompt and going straight to the studio.
 *
 * `upstream` / `customUpstream` let a client tell whether results come from the
 * real API or from a stub/gateway (see components/CustomUpstreamBanner.js).
 */
export async function GET() {
    return NextResponse.json(
        {
            serverApiKey: hasServerApiKey(),
            upstream: getMuapiBaseUrl(),
            customUpstream: !isDefaultMuapiBaseUrl(),
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
