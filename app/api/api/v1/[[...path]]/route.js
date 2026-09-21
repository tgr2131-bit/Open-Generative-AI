import { NextResponse } from 'next/server';
import { getMuapiBaseUrl } from '../../../../../src/lib/muapiBase';
import { resolveApiKey } from '../../../../../src/lib/muapiKey';

const MUAPI_BASE = getMuapiBaseUrl();


function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie');
    return headers;
}

// Proxies /api/api/v1/* -> https://api.muapi.ai/api/v1/*
// This is required because the AiAgent library hardcodes a double /api/api
export async function GET(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/api/v1/${path}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = resolveApiKey(request);

    // NOTE: credential logging removed for security (CWE-200)
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, { headers, method: 'GET' });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/api/v1/${path}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = resolveApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const body = await request.arrayBuffer();
        const response = await fetch(targetUrl, { method: 'POST', headers, body });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
