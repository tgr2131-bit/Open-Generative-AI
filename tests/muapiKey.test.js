const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// src/lib/muapiKey.js is ESM consumed by Next.js; load it the way the bundler does.
let normalizeApiKey;
let getServerApiKey;
let hasServerApiKey;
let resolveApiKey;
let MUAPI_KEY_ENV;

const modulePath = path.join(__dirname, '..', 'src', 'lib', 'muapiKey.js');

function requestWith(headers = {}) {
    const lowercased = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    return { headers: { get: (name) => lowercased[name.toLowerCase()] ?? null } };
}

test.before(async () => {
    const mod = await import(modulePath);
    ({ normalizeApiKey, getServerApiKey, hasServerApiKey, resolveApiKey, MUAPI_KEY_ENV } = mod);
});

test('exports the documented env var name', () => {
    assert.equal(MUAPI_KEY_ENV, 'MUAPI_API_KEY');
});

test('normalizeApiKey trims a real key', () => {
    assert.equal(normalizeApiKey('  abc123  '), 'abc123');
});

test('normalizeApiKey rejects absent and non-string values', () => {
    for (const value of [null, undefined, '', '   ', 42, {}, []]) {
        assert.equal(normalizeApiKey(value), null, `expected null for ${JSON.stringify(value)}`);
    }
});

test('normalizeApiKey rejects the stringified null/undefined that Headers produces', () => {
    // new Headers({'x-api-key': null}).get('x-api-key') === 'null', so a client
    // sending a missing key must not be mistaken for a real one.
    for (const value of ['null', 'NULL', ' undefined ', 'Undefined']) {
        assert.equal(normalizeApiKey(value), null, `expected null for ${JSON.stringify(value)}`);
    }
});

test('getServerApiKey reads only the configured env var', () => {
    assert.equal(getServerApiKey({ MUAPI_API_KEY: ' server-key ' }), 'server-key');
    assert.equal(getServerApiKey({ API_KEY: 'other', MUAPI_KEY: 'nope' }), null);
    assert.equal(getServerApiKey({ MUAPI_API_KEY: '   ' }), null);
    assert.equal(getServerApiKey({}), null);
    assert.equal(getServerApiKey(undefined), null);
});

test('hasServerApiKey reflects whether a usable key is configured', () => {
    assert.equal(hasServerApiKey({ MUAPI_API_KEY: 'k' }), true);
    assert.equal(hasServerApiKey({ MUAPI_API_KEY: 'null' }), false);
    assert.equal(hasServerApiKey({}), false);
});

test('resolveApiKey prefers the caller-supplied x-api-key', () => {
    const request = requestWith({ 'x-api-key': 'visitor-key' });
    assert.equal(resolveApiKey(request, { MUAPI_API_KEY: 'deployment-key' }), 'visitor-key');
});

test('resolveApiKey accepts an Authorization bearer token', () => {
    const request = requestWith({ authorization: 'Bearer visitor-key' });
    assert.equal(resolveApiKey(request, { MUAPI_API_KEY: 'deployment-key' }), 'visitor-key');

    const lowercase = requestWith({ authorization: 'bearer visitor-key' });
    assert.equal(resolveApiKey(lowercase, { MUAPI_API_KEY: 'deployment-key' }), 'visitor-key');
});

test('resolveApiKey falls back to the deployment key when the client sends none', () => {
    assert.equal(resolveApiKey(requestWith(), { MUAPI_API_KEY: 'deployment-key' }), 'deployment-key');
});

test('resolveApiKey ignores stringified-null headers so the deployment key still applies', () => {
    // This is the regression that made a self-hosted key silently unusable when
    // a studio passed a null key through to fetch.
    const request = requestWith({ 'x-api-key': 'null' });
    assert.equal(resolveApiKey(request, { MUAPI_API_KEY: 'deployment-key' }), 'deployment-key');
});

test('resolveApiKey returns null when neither source has a key', () => {
    assert.equal(resolveApiKey(requestWith(), {}), null);
    assert.equal(resolveApiKey({ headers: null }, {}), null);
    assert.equal(resolveApiKey(null, {}), null);
});

test('resolveApiKey ignores a malformed Authorization header', () => {
    const request = requestWith({ authorization: 'Basic abc123', 'x-api-key': 'null' });
    assert.equal(resolveApiKey(request, { MUAPI_API_KEY: 'deployment-key' }), 'deployment-key');
});

test('client components never read the deployment key from the environment', () => {
    // The env var *name* may appear in operator-facing copy; what must never
    // happen is client code reading the value, which Next.js would inline into
    // the browser bundle.
    const clientFiles = [
        'components/ApiKeyModal.js',
        'components/StandaloneShell.js',
    ];

    for (const clientFile of clientFiles) {
        const source = fs.readFileSync(path.join(__dirname, '..', clientFile), 'utf8');

        assert.equal(
            /process\.env/.test(source),
            false,
            `${clientFile} must not read the environment - the key would ship to the browser`,
        );
        assert.equal(
            /\bMUAPI_KEY_ENV\b/.test(source),
            false,
            `${clientFile} must not import the server key constant`,
        );
    }
});

test('getMuapiBaseUrl defaults to the public API and honours the override', async () => {
    const { getMuapiBaseUrl, MUAPI_BASE_ENV, DEFAULT_MUAPI_BASE_URL } =
        await import(path.join(__dirname, '..', 'src', 'lib', 'muapiBase.js'));

    assert.equal(MUAPI_BASE_ENV, 'MUAPI_BASE_URL');
    assert.equal(DEFAULT_MUAPI_BASE_URL, 'https://api.muapi.ai');

    assert.equal(getMuapiBaseUrl({}), DEFAULT_MUAPI_BASE_URL);
    assert.equal(getMuapiBaseUrl({ MUAPI_BASE_URL: '   ' }), DEFAULT_MUAPI_BASE_URL);
    assert.equal(getMuapiBaseUrl({ MUAPI_BASE_URL: 'https://gateway.internal/' }), 'https://gateway.internal');
    assert.equal(getMuapiBaseUrl({ MUAPI_BASE_URL: ' http://127.0.0.1:9099 ' }), 'http://127.0.0.1:9099');
});

test('middleware forwards the resolved key and the configured base URL', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'middleware.js'), 'utf8');

    assert.match(source, /import \{ resolveApiKey \} from '\.\/src\/lib\/muapiKey'/);
    assert.match(source, /import \{ getMuapiBaseUrl \} from '\.\/src\/lib\/muapiBase'/);

    // The rewritten path must carry the key, or a self-hosted deployment's key
    // would never apply to /api/v1/* traffic.
    assert.match(source, /headers\.set\('x-api-key', apiKey\)/);
    assert.match(source, /NextResponse\.rewrite\(targetUrl, \{ request: \{ headers \} \}\)/);
    assert.match(source, /new URL\(url\.pathname \+ url\.search, getMuapiBaseUrl\(\)\)/);
});

test('every route handler resolves keys through the shared helper', () => {
    const routeFiles = [
        'app/api/api/v1/[[...path]]/route.js',
        'app/api/app/[[...path]]/route.js',
        'app/api/workflow/[[...path]]/route.js',
        'app/api/agents/[[...path]]/route.js',
        'app/api/v1/creative-agent/[[...path]]/route.js',
        'app/api/v1/get_upload_url/route.js',
    ];

    for (const routeFile of routeFiles) {
        const absolute = path.join(__dirname, '..', routeFile);
        const source = fs.readFileSync(absolute, 'utf8');

        assert.match(
            source,
            /import \{ resolveApiKey \} from '[^']*src\/lib\/muapiKey'/,
            `${routeFile} should import the shared resolver`,
        );
        assert.equal(
            /function getApiKey/.test(source),
            false,
            `${routeFile} should not define its own key helper any more`,
        );

        // Whatever relative specifier it uses has to actually resolve.
        const specifier = /from '(\.[^']*muapiKey)'/.exec(source)[1];
        assert.ok(
            fs.existsSync(path.resolve(path.dirname(absolute), `${specifier}.js`)),
            `${routeFile} has an unresolvable import: ${specifier}`,
        );
    }
});

test('isDefaultMuapiBaseUrl distinguishes the real API from a stub or gateway', async () => {
    const { isDefaultMuapiBaseUrl, getMuapiBaseUrl } =
        await import(path.join(__dirname, '..', 'src', 'lib', 'muapiBase.js'));

    assert.equal(isDefaultMuapiBaseUrl({}), true);
    assert.equal(isDefaultMuapiBaseUrl({ MUAPI_BASE_URL: '   ' }), true);

    // The bundled mock and any gateway/mirror must be flagged so the UI can warn.
    assert.equal(isDefaultMuapiBaseUrl({ MUAPI_BASE_URL: 'http://127.0.0.1:9099' }), false);
    assert.equal(isDefaultMuapiBaseUrl({ MUAPI_BASE_URL: 'https://gateway.internal' }), false);

    // Trailing slashes must not defeat the comparison.
    assert.equal(isDefaultMuapiBaseUrl({ MUAPI_BASE_URL: 'https://api.muapi.ai/' }), true);
    assert.equal(getMuapiBaseUrl({ MUAPI_BASE_URL: 'https://api.muapi.ai///' }), 'https://api.muapi.ai');
});

test('the mock upstream is never the default, so it cannot be mistaken for real', () => {
    const mockSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'mock-muapi.js'), 'utf8');

    // The mock must never bind the real host, and must say its output is fake.
    assert.equal(/api\.muapi\.ai/.test(mockSource.split('\n').filter((l) => l.includes('listen') || l.includes('HOST =')).join('\n')), false);
    assert.match(mockSource, /not a real generation/);
});

test('the studio page renders the custom-upstream warning on the server', () => {
    const pageSource = fs.readFileSync(
        path.join(__dirname, '..', 'app', 'studio', '[[...slug]]', 'page.js'),
        'utf8',
    );
    const bannerSource = fs.readFileSync(
        path.join(__dirname, '..', 'components', 'CustomUpstreamBanner.js'),
        'utf8',
    );

    // Server-rendered: no 'use client', so the warning is in the initial HTML.
    assert.equal(/'use client'/.test(bannerSource), false);
    assert.match(pageSource, /CustomUpstreamBanner/);
    assert.match(bannerSource, /isDefaultMuapiBaseUrl/);
    // It must state plainly that output is not real.
    assert.match(bannerSource, /not a real generation/);
});
