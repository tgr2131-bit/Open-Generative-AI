import { NextResponse } from 'next/server';
import { getMuapiBaseUrl } from '../../../../src/lib/muapiBase';
import { resolveApiKey } from '../../../../src/lib/muapiKey';

const MUAPI_BASE = getMuapiBaseUrl();


function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie');
    return headers;
}

export async function GET(request) {
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/app/get_file_upload_url${search}`;

    const headers = cleanHeaders(request);
    const apiKey = resolveApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, {
            headers,
            method: 'GET',
        });

        const data = await response.json();

        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
