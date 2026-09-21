#!/usr/bin/env node
/**
 * A fake api.muapi.ai for local UI work (dev tool, not part of the app).
 *
 * Why: egress-restricted environments (CI containers, sandboxes, corporate
 * networks) can run the app but cannot reach api.muapi.ai, so every studio
 * shows a proxy error and no UI work is possible. This server implements just
 * enough of the Muapi contract - submit, poll, balance, upload - for the
 * full flow to be exercised end to end.
 *
 *   node scripts/mock-muapi.js            # listens on 127.0.0.1:9099
 *   MUAPI_BASE_URL=http://127.0.0.1:9099 npm run dev
 *
 * Results are a self-describing SVG (a data: URL, so the app's CSP allows it and
 * no network is needed to render it). They are placeholders, not model output.
 *
 * For endpoints whose result is played in a <video> element, set MOCK_VIDEO_URL
 * to a public sample MP4 that the *browser* can reach; otherwise those studios
 * receive the SVG placeholder and show an empty player.
 */

const http = require('http');

const PORT = Number(process.env.MOCK_MUAPI_PORT || 9099);
const HOST = process.env.MOCK_MUAPI_HOST || '127.0.0.1';
const VIDEO_URL = process.env.MOCK_VIDEO_URL || null;

const VIDEO_ENDPOINT = /video|veo|kling|sora|seedance|wan|hunyuan|ltx|lipsync|talk/i;

let sequence = 0;
const jobs = new Map();

function escapeXml(value) {
    return String(value).replace(/[<>&'"]/g, (char) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
    }[char]));
}

/** Self-describing placeholder so a mock result is never mistaken for real output. */
function placeholderDataUrl({ endpoint, prompt, aspectRatio }) {
    const lines = [
        'MOCK OUTPUT - not a real generation',
        `endpoint: ${endpoint}`,
        prompt ? `prompt: ${prompt}` : 'prompt: (none supplied)',
        `time: ${new Date().toISOString()}`,
    ];

    const [width, height] = String(aspectRatio || '1:1').split(':').map(Number);
    const w = 1024;
    const h = Number.isFinite(width) && Number.isFinite(height) && width > 0
        ? Math.round((w * height) / width)
        : w;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#164e63"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="none" stroke="#22d3ee" stroke-width="3" stroke-dasharray="14 10" opacity="0.7"/>
  ${lines.map((line, index) => {
      const y = 130 + index * 58;
      const size = index === 0 ? 34 : 24;
      return `<text x="64" y="${y}" font-family="monospace" font-size="${size}" fill="${index === 0 ? '#22d3ee' : '#e2e8f0'}">${escapeXml(line)}</text>`;
  }).join('\n  ')}
</svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

/** Best-effort prompt extraction so the placeholder echoes what was asked for. */
function extractPrompt(raw, contentType) {
    if (!raw) return null;
    if (contentType.includes('json')) {
        try {
            const parsed = JSON.parse(raw);
            return parsed.prompt || parsed.text || parsed.query || null;
        } catch {
            return null;
        }
    }
    return null;
}

const server = http.createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const raw = await readBody(req);
    const auth = req.headers['x-api-key'] ? 'key-present' : 'NO-KEY';

    console.log(`${req.method} ${pathname} (${auth})`);

    // Poll for a submitted job.
    const pollMatch = /^\/api\/v1\/predictions\/([^/]+)\/result$/.exec(pathname);
    if (pollMatch) {
        const job = jobs.get(pollMatch[1]);
        if (!job) return sendJson(res, 404, { error: 'unknown request_id' });

        // Succeed on the first poll; real jobs take a while, but waiting only
        // slows down UI work.
        job.status = 'completed';
        const output = VIDEO_URL && VIDEO_ENDPOINT.test(job.endpoint)
            ? VIDEO_URL
            : job.placeholder;

        return sendJson(res, 200, {
            status: 'completed',
            outputs: [output],
            url: output,
            request_id: pollMatch[1],
        });
    }

    // Uploads: the client wants { url } back.
    if (/^\/api\/v1\/upload_file$/.test(pathname)) {
        return sendJson(res, 200, {
            url: placeholderDataUrl({ endpoint: 'upload_file', prompt: 'uploaded file' }),
        });
    }

    if (/^\/api\/v1\/account\/balance$/.test(pathname)) {
        return sendJson(res, 200, { balance: 1000 });
    }

    if (/^\/app\/get_file_upload_url$/.test(pathname)) {
        const fake = 'https://example.invalid/mock-upload';
        return sendJson(res, 200, { upload_url: fake, url: fake, file_url: fake });
    }

    // Everything the studios list on load: empty lists are all they need.
    if (/^\/(app\/(interests?|apps)|workflow\/(get-template-workflows|get-workflow-defs|get-published-workflows|node-schemas)|agents\/(templates\/agents|user\/agents|featured\/agents|user\/conversations))/.test(pathname)) {
        return sendJson(res, 200, []);
    }

    // Submit a generation: any other POST/DELETE under /api/v1 or the app proxy.
    if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT' || req.method === 'PATCH') {
        const endpoint = pathname.replace(/^\/api\/v1\//, '').replace(/^\/app\//, '');
        sequence += 1;
        const requestId = `mock-${Date.now()}-${sequence}`;

        jobs.set(requestId, {
            endpoint,
            placeholder: placeholderDataUrl({
                endpoint,
                prompt: extractPrompt(raw, req.headers['content-type'] || ''),
                aspectRatio: searchParams.get('aspect_ratio') || '1:1',
            }),
        });

        return sendJson(res, 200, { request_id: requestId, status: 'processing' });
    }

    return sendJson(res, 200, {});
});

server.listen(PORT, HOST, () => {
    console.log(`mock Muapi upstream on http://${HOST}:${PORT}`);
    console.log('  point the app at it:  MUAPI_BASE_URL=http://%s:%d npm run dev', HOST, PORT);
    console.log('  outputs are SVG placeholders%s', VIDEO_URL ? ` (video endpoints -> ${VIDEO_URL})` : '');
});
