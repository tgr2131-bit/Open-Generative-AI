/**
 * Turns an upstream `fetch` failure into something an operator can act on.
 *
 * `fetch` reports almost every transport problem as a bare `TypeError: fetch
 * failed` and hides the real reason in `error.cause`. That single sentence is
 * all a caller sees otherwise: no indication whether it was DNS, a refused
 * connection, a reset by an egress firewall, or an untrusted certificate - four
 * problems with four different fixes.
 *
 * `describeUpstreamFailure` digs the cause chain out and returns a compact,
 * front-loaded message, so the leading words survive the callers that truncate
 * error text for display.
 *
 * Dependency-free (shared by route handlers and middleware) and safe to call
 * with anything, including non-Error values.
 */

// Cause codes worth naming explicitly, with the usual remedy. Kept short: these
// strings are embedded in API responses.
const CAUSE_HINTS = {
    ENOTFOUND: 'DNS lookup failed for the upstream host',
    EAI_AGAIN: 'DNS lookup timed out',
    ECONNREFUSED: 'the upstream refused the connection',
    ECONNRESET: 'the connection was reset before a response - an egress firewall or proxy is the usual cause',
    EPIPE: 'the connection closed mid-request',
    ETIMEDOUT: 'the connection timed out',
    EHOSTUNREACH: 'no route to the upstream host',
    ENETUNREACH: 'no route to the upstream network',
    UND_ERR_CONNECT_TIMEOUT: 'the upstream did not accept the connection in time',
    UND_ERR_SOCKET: 'the upstream socket closed unexpectedly',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'the upstream certificate is self-signed and not trusted',
    SELF_SIGNED_CERT_IN_CHAIN: 'the upstream certificate chain is not trusted',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the upstream certificate could not be verified - a TLS-intercepting proxy is the usual cause',
    CERT_HAS_EXPIRED: 'the upstream certificate has expired',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'the upstream certificate issuer is not trusted',
};

/**
 * Walks `error.cause` (and undici's AggregateError across resolved addresses)
 * to find the underlying reason.
 */
function findRootCause(error) {
    const seen = new Set();
    let current = error;

    // Bounded walk: the chain is 1-2 levels deep in practice.
    for (let depth = 0; depth < 4 && current; depth += 1) {
        if (typeof current !== 'object' || seen.has(current)) break;
        seen.add(current);

        // undici aggregates per-address attempts for a single hostname.
        if (Array.isArray(current.errors) && current.errors.length > 0) {
            const nested = current.errors.find((entry) => entry && (entry.code || entry.message));
            if (nested) {
                current = nested;
                continue;
            }
        }

        if (current.code && typeof current.code === 'string') return current;
        if (current.cause === current) break;
        if (!current.cause) break;
        current = current.cause;
    }

    return null;
}

// Messages that say "something went wrong" and nothing else. Echoing them in
// parentheses adds noise, so they are dropped whenever a cause code is known.
const UNINFORMATIVE_MESSAGES = new Set([
    'fetch failed',
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'The operation was aborted.',
]);

function safeHost(targetUrl) {
    if (typeof targetUrl !== 'string') return null;
    try {
        return new URL(targetUrl).host;
    } catch {
        return null;
    }
}

/**
 * Compact, human-readable reason. Example:
 *   "ECONNRESET reaching api.muapi.ai (connection reset - ...)"
 */
export function describeUpstreamFailure(error, targetUrl) {
    const host = safeHost(targetUrl);
    const root = findRootCause(error);

    const code = typeof root?.code === 'string' ? root.code : null;
    const detail = typeof root?.message === 'string' && root.message ? root.message : null;

    // `fetch failed` carries no information; prefer the root cause's own message.
    const outerMessage = typeof error?.message === 'string' && error.message ? error.message : null;
    const usefulOuter = outerMessage && !UNINFORMATIVE_MESSAGES.has(outerMessage) ? outerMessage : null;
    const reason = detail && detail !== outerMessage ? detail : usefulOuter || detail || outerMessage || 'unknown error';

    // With a code in hand, only the root cause's message is worth appending.
    const tail = code ? (detail && detail !== code ? detail : null) : null;
    const head = code ? `${code} reaching ${host || 'upstream'}` : `${reason} reaching ${host || 'upstream'}`;

    return tail ? `${head} (${tail})` : head;
}

/** Short remedy hint for the detected cause code, or null. */
export function upstreamFailureHint(error) {
    const root = findRootCause(error);
    const code = typeof root?.code === 'string' ? root.code : null;
    return code ? CAUSE_HINTS[code] || null : null;
}

/**
 * The JSON body returned when an upstream call fails. Field order matters: the
 * leading `error` text is what survives clients that truncate the body.
 */
export function upstreamFailureBody(error, targetUrl) {
    const body = { error: describeUpstreamFailure(error, targetUrl) };
    const root = findRootCause(error);

    if (typeof root?.code === 'string') body.code = root.code;
    const host = safeHost(targetUrl);
    if (host) body.host = host;

    const hint = upstreamFailureHint(error);
    if (hint) body.hint = hint;

    return body;
}

/**
 * Logs the failure with the full cause chain. The response body stays short, so
 * the detail an operator needs has to land in the server log instead.
 */
export function logUpstreamFailure(error, targetUrl) {
    const host = safeHost(targetUrl) || 'upstream';

    console.error(`[muapi] request to ${host} failed: ${describeUpstreamFailure(error, targetUrl)}`);

    let current = error;
    for (let depth = 0; depth < 4 && current; depth += 1) {
        const code = current.code ? ` code=${current.code}` : '';
        const message = current.message ? ` ${current.message}` : '';
        console.error(`[muapi]   cause[${depth}]${code}${message}`);
        current = current.cause;
    }
}
