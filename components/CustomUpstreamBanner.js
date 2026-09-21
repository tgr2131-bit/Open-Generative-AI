import { getMuapiBaseUrl, isDefaultMuapiBaseUrl } from '@/src/lib/muapiBase';

/**
 * Server-rendered warning shown whenever MUAPI_BASE_URL points somewhere other
 * than the public API.
 *
 * The reason this exists: the bundled mock (`npm run mock:muapi`) returns
 * placeholders, and pointing the app at it is invisible from the UI - a
 * placeholder image looks exactly like a real result in the canvas. The
 * warning is rendered on the server so it is present in the initial HTML and
 * cannot be lost to a client-side failure.
 *
 * Rendered below the key prompt and settings dialog (z-40 vs z-50/z-[200]) so
 * it never covers them.
 */
export default function CustomUpstreamBanner() {
    if (isDefaultMuapiBaseUrl()) return null;

    const upstream = getMuapiBaseUrl();
    let host = upstream;
    try {
        host = new URL(upstream).host;
    } catch {
        // Non-URL values are shown verbatim rather than breaking the banner.
    }

    return (
        <div className="fixed bottom-3 left-3 right-3 z-40 sm:right-auto sm:max-w-md pointer-events-none">
            <div className="pointer-events-auto rounded-lg border border-amber-400/30 bg-amber-950/90 px-4 py-3 backdrop-blur-md shadow-2xl">
                <div className="flex items-start gap-3">
                    <span
                        aria-hidden="true"
                        className="mt-[3px] shrink-0 text-amber-300 text-sm leading-none"
                    >
                        &#9888;
                    </span>
                    <div className="min-w-0">
                        <p className="text-[12px] font-bold tracking-wide text-amber-200">
                            Custom API upstream: {host}
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
                            Requests are not going to api.muapi.ai. If this is the bundled mock
                            (<code className="text-amber-200/90">npm run mock:muapi</code>), every
                            result is a placeholder, not a real generation. Unset{' '}
                            <code className="text-amber-200/90">MUAPI_BASE_URL</code> to use the
                            real API.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
