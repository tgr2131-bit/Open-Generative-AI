import { NextResponse } from 'next/server';
import { resolveApiKey } from './src/lib/muapiKey';
import { getMuapiBaseUrl } from './src/lib/muapiBase';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Frame embedding policy (CWE-1021 clickjacking protection).
// Production keeps the strict default: nothing may frame the app.
// Development servers are routinely embedded in preview panes / IDE browsers,
// where `DENY` renders a blank "refused to connect" frame, so development
// defaults to allowing embedding. Override either default explicitly with
// OGA_FRAME_ANCESTORS (e.g. OGA_FRAME_ANCESTORS="'self'" or a host list).
const FRAME_ANCESTORS = process.env.OGA_FRAME_ANCESTORS || (IS_PRODUCTION ? "'none'" : '*');

function addSecurityHeaders(response) {
    // Prevent MIME type sniffing (CWE-693)
    response.headers.set('X-Content-Type-Options', 'nosniff');
    // Prevent clickjacking (CWE-1021). Only emitted when framing is restricted -
    // X-Frame-Options has no "allow any" value, so the permissive dev case relies
    // on the CSP frame-ancestors directive below.
    if (FRAME_ANCESTORS !== '*') {
        response.headers.set('X-Frame-Options', FRAME_ANCESTORS === "'none'" ? 'DENY' : 'SAMEORIGIN');
    }
    // Enable XSS filter in legacy browsers
    response.headers.set('X-XSS-Protection', '1; mode=block');
    // Referrer policy
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Content Security Policy - restricts script sources to prevent XSS (CWE-79).
    // connect-src covers *.muapi.ai (not just api.muapi.ai) because generated
    // media, model thumbnails, and other assets are served from cdn.muapi.ai
    // and other muapi subdomains that the renderer fetches directly.
    response.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https://muapi.ai https://*.muapi.ai; font-src 'self' data:; " +
        `frame-ancestors ${FRAME_ANCESTORS};`
    );
    return response;
}

export function middleware(request) {
    const url = request.nextUrl;

    // Catch requests to /api/workflow, /api/app, and /api/v1
    const isMuApi = url.pathname.startsWith('/api/workflow') ||
                    url.pathname.startsWith('/api/app') ||
                    url.pathname.startsWith('/api/v1');

    if (isMuApi) {
        // Exclude paths that have their own dedicated route handlers with custom logic
        const isHandledByRoute = url.pathname.startsWith('/api/v1/creative-agent') ||
                                url.pathname.startsWith('/api/v1/get_upload_url') ||
                                url.pathname.startsWith('/api/v1/upload-binary');

        if (url.pathname.startsWith('/api/v1') && !isHandledByRoute) {
            const targetUrl = new URL(url.pathname + url.search, getMuapiBaseUrl());

            // Forward the caller's headers, adding the deployment's key when the
            // client did not bring one. Without this, a self-hosted instance with
            // MUAPI_API_KEY set would still fail on this rewritten path.
            // Verified to take effect in both `next dev` and `next start`, with
            // the key supplied to the server process at runtime.
            const headers = new Headers(request.headers);
            const apiKey = resolveApiKey(request);
            if (apiKey) headers.set('x-api-key', apiKey);

            const rewriteResponse = NextResponse.rewrite(targetUrl, { request: { headers } });
            return addSecurityHeaders(rewriteResponse);
        }
    }

    // Add security headers to all responses
    return addSecurityHeaders(NextResponse.next());
}

// Match all paths for security headers. Exclude Next.js internal paths.
export const config = {
    matcher: [
        '/api/:path*',
        '/((?!_next/static|_next/image|favicon.ico|__nextjs_original-stack-frame).*)',
    ],
};
