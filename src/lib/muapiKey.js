/**
 * Where the Muapi API key comes from, for every server-side call to api.muapi.ai.
 *
 * Two sources, in priority order:
 *
 *   1. `x-api-key` (or `Authorization: Bearer`) sent by the client — the key a
 *      user pasted into the app, kept in their own browser.
 *   2. `MUAPI_API_KEY` in the server environment — lets a self-hosted deployment
 *      supply one key for everybody, so no key ever reaches the browser.
 *
 * The header wins so a user can still override the deployment's key with their
 * own. Set no env var and behaviour is exactly as before: the client must send
 * a key.
 *
 * This module is imported by route handlers (Node runtime) and by middleware
 * (Edge runtime), so it must stay dependency-free and free of Node built-ins.
 */

export const MUAPI_KEY_ENV = 'MUAPI_API_KEY';

// `fetch`'s Headers constructor stringifies whatever it is given, so a client
// that passes a missing key ends up sending the literal string "null" or
// "undefined" rather than nothing at all. Treat those as absent, otherwise a
// bogus client value would shadow a perfectly good server key.
const ABSENT_LITERALS = new Set(['null', 'undefined']);

/**
 * Trims a candidate key and rejects common "not actually a key" values.
 * @returns {string|null} the usable key, or null when there isn't one
 */
export function normalizeApiKey(value) {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed || ABSENT_LITERALS.has(trimmed.toLowerCase())) return null;

    return trimmed;
}

/** The deployment-wide key from the environment, if one is configured. */
export function getServerApiKey(env = process.env) {
    return normalizeApiKey(env?.[MUAPI_KEY_ENV]);
}

/** True when this deployment has a server-side key configured. */
export function hasServerApiKey(env = process.env) {
    return getServerApiKey(env) !== null;
}

/**
 * The key to use for one request: whatever the client sent, else the
 * deployment's key, else null (the caller then forwards no key and upstream
 * answers 401/403).
 */
export function resolveApiKey(request, env = process.env) {
    const headers = request?.headers;

    if (headers?.get) {
        const direct = normalizeApiKey(headers.get('x-api-key'));
        if (direct) return direct;

        const authorization = headers.get('authorization') || '';
        const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization.trim());
        const bearer = normalizeApiKey(bearerMatch?.[1]);
        if (bearer) return bearer;
    }

    return getServerApiKey(env);
}
