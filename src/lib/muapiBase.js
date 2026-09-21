/**
 * Upstream base URL for every server-side call to Muapi.
 *
 * Defaults to the public API. Self-hosters can point it at a Muapi-compatible
 * gateway (corporate egress proxy, regional mirror, staging endpoint) with
 * MUAPI_BASE_URL. Set it before starting the server: the value is read when the
 * route modules are loaded.
 *
 * Shared by route handlers and middleware, so it must stay dependency-free.
 */

export const MUAPI_BASE_ENV = 'MUAPI_BASE_URL';

export const DEFAULT_MUAPI_BASE_URL = 'https://api.muapi.ai';

export function getMuapiBaseUrl(env = process.env) {
    const configured = env?.[MUAPI_BASE_ENV];

    if (typeof configured !== 'string') return DEFAULT_MUAPI_BASE_URL;

    const trimmed = configured.trim().replace(/\/+$/, '');
    return trimmed || DEFAULT_MUAPI_BASE_URL;
}
