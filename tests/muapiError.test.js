const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// src/lib/muapiError.js is ESM consumed by Next.js; load it the way the bundler does.
let describeUpstreamFailure;
let upstreamFailureHint;
let upstreamFailureBody;

const modulePath = path.join(__dirname, '..', 'src', 'lib', 'muapiError.js');
const TARGET = 'https://api.muapi.ai/api/v1/account/balance';

test.before(async () => {
    ({ describeUpstreamFailure, upstreamFailureHint, upstreamFailureBody } =
        await import(modulePath));
});

/** The shape undici actually produces: a generic TypeError wrapping the real one. */
function fetchFailure(cause) {
    const error = new TypeError('fetch failed');
    if (cause !== undefined) error.cause = cause;
    return error;
}

function coded(code, message) {
    const error = new Error(message || '');
    error.code = code;
    return error;
}

test('names the cause code and host instead of a bare "fetch failed"', () => {
    // The exact case reported from a sandboxed deploy: egress reset the TLS
    // connection, and all the caller saw was {"error":"fetch failed"}.
    const description = describeUpstreamFailure(fetchFailure(coded('ECONNRESET')), TARGET);

    assert.equal(description, 'ECONNRESET reaching api.muapi.ai');
    assert.equal(/fetch failed/.test(description), false);
});

test('appends the root cause message when it adds information', () => {
    const description = describeUpstreamFailure(
        fetchFailure(coded('ECONNRESET', 'socket hang up')),
        TARGET,
    );

    assert.equal(description, 'ECONNRESET reaching api.muapi.ai (socket hang up)');
});

test('drops the root cause message when it merely repeats the code', () => {
    const description = describeUpstreamFailure(
        fetchFailure(coded('ENOTFOUND', 'ENOTFOUND')),
        TARGET,
    );

    assert.equal(description, 'ENOTFOUND reaching api.muapi.ai');
});

test('explains each common transport failure', () => {
    const cases = [
        ['ENOTFOUND', 'DNS lookup failed'],
        ['ECONNREFUSED', 'refused the connection'],
        ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS-intercepting proxy'],
        ['UND_ERR_CONNECT_TIMEOUT', 'did not accept the connection in time'],
    ];

    for (const [code, expected] of cases) {
        const hint = upstreamFailureHint(fetchFailure(coded(code)));
        assert.ok(hint, `expected a hint for ${code}`);
        assert.match(hint, new RegExp(expected, 'i'), `hint for ${code} should mention "${expected}"`);
    }
});

test('walks undici AggregateError to the first per-address cause', () => {
    const aggregate = new Error('all attempts failed');
    aggregate.errors = [coded('ECONNREFUSED'), coded('ETIMEDOUT')];

    assert.equal(
        describeUpstreamFailure(fetchFailure(aggregate), TARGET),
        'ECONNREFUSED reaching api.muapi.ai',
    );
});

test('walks a multi-level cause chain', () => {
    const deep = fetchFailure({ cause: { cause: coded('EPIPE') } });
    assert.equal(describeUpstreamFailure(deep, TARGET), 'EPIPE reaching api.muapi.ai');
});

test('survives a cause chain that refers back to itself', () => {
    const looped = new TypeError('fetch failed');
    looped.cause = looped;

    // Must terminate and still say something useful.
    assert.equal(describeUpstreamFailure(looped, TARGET), 'fetch failed reaching api.muapi.ai');
});

test('falls back gracefully when there is no cause at all', () => {
    assert.equal(describeUpstreamFailure(fetchFailure(), TARGET), 'fetch failed reaching api.muapi.ai');
    assert.equal(describeUpstreamFailure(new Error('Invalid URL'), TARGET), 'Invalid URL reaching api.muapi.ai');
});

test('tolerates non-Error and missing inputs', () => {
    assert.equal(describeUpstreamFailure(null, TARGET), 'unknown error reaching api.muapi.ai');
    assert.equal(describeUpstreamFailure(undefined, undefined), 'unknown error reaching upstream');
    assert.equal(describeUpstreamFailure('boom', 'not a url'), 'unknown error reaching upstream');
    assert.equal(upstreamFailureHint(null), null);
});

test('body front-loads the error text so truncating clients keep the essentials', () => {
    const body = upstreamFailureBody(fetchFailure(coded('ECONNRESET')), TARGET);
    const serialized = JSON.stringify(body);

    assert.deepEqual(Object.keys(body), ['error', 'code', 'host', 'hint']);
    assert.equal(body.code, 'ECONNRESET');
    assert.equal(body.host, 'api.muapi.ai');

    // The studio truncates the response body to 100 characters before showing
    // it, so the cause code and host must appear inside that window.
    assert.match(serialized.slice(0, 100), /ECONNRESET/);
    assert.match(serialized.slice(0, 100), /api\.muapi\.ai/);
});

test('body omits fields it cannot determine', () => {
    const body = upstreamFailureBody(new Error('boom'), undefined);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(body.error, 'boom reaching upstream');
});

test('every route handler reports upstream failures through the shared helper', () => {
    const routeFiles = [
        'app/api/api/v1/[[...path]]/route.js',
        'app/api/app/[[...path]]/route.js',
        'app/api/workflow/[[...path]]/route.js',
        'app/api/agents/[[...path]]/route.js',
        'app/api/v1/creative-agent/[[...path]]/route.js',
        'app/api/v1/get_upload_url/route.js',
    ];

    for (const routeFile of routeFiles) {
        const source = fs.readFileSync(path.join(__dirname, '..', routeFile), 'utf8');

        assert.match(
            source,
            /import \{ logUpstreamFailure, upstreamFailureBody \}/,
            `${routeFile} should import the shared failure helpers`,
        );
        assert.equal(
            /error\.message \}, \{ status: 500 \}/.test(source),
            false,
            `${routeFile} still returns a bare error.message`,
        );
    }
});
