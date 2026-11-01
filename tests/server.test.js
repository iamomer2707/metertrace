import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, validateExtractedRecord, extractionSchema } from '../src/server.js';

const accessToken = 'test-only-extraction-token-0123456789abcdef';
const enabledEnv = { OPENAI_API_KEY: 'private-test-key', METERTRACE_API_TOKEN: accessToken };
let sequence = 0;
const payload = { documentId: 'doc-1', pages: [{ pageNumber: 1, text: 'Credit approved: $286.40 on 2026-04-16. Reference CR-42.' }] };
const record = {
  ...Object.fromEntries(Object.keys(extractionSchema.properties.records.items.properties).map(key => [key, null])),
  kind: 'credit', amount: 286.40, date: '2026-04-16', reference: 'CR-42', status: 'promised',
  source: { documentId: 'doc-1', page: 1, quote: 'Credit approved: $286.40 on 2026-04-16.' },
};
function request(body = payload, headers = {}) {
  return new Request('https://metertrace.example/api/extract', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://metertrace.example', 'x-metertrace-token': accessToken, 'cf-connecting-ip': `test-${++sequence}`, ...headers }, body: JSON.stringify(body),
  });
}

test('health distinguishes configured AI and access-token requirements without exposing secrets', async () => {
  const response = await handleApi(new Request('https://metertrace.example/api/health'), enabledEnv);
  assert.deepEqual(await response.json(), { ok: true, aiEnabled: true, tokenRequired: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('local-only deployments return actionable AI unavailable status', async () => {
  const result = await handleApi(request());
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /Local text extraction/);
});

test('rejects cross-origin requests before sending text to AI', async () => {
  const result = await handleApi(request(payload, { origin: 'https://unrelated.example' }), enabledEnv);
  assert.equal(result.status, 403);
});

test('extraction access token is mandatory', async () => {
  const result = await handleApi(request(payload, { 'x-metertrace-token': '' }), enabledEnv);
  assert.equal(result.status, 401);
});

test('rejects repeated page numbers and oversized text before upstream calls', async () => {
  const duplicate = await handleApi(request({ ...payload, pages: [payload.pages[0], payload.pages[0]] }), enabledEnv);
  assert.equal(duplicate.status, 400);
  const tooLarge = await handleApi(request({ ...payload, pages: [{ pageNumber: 1, text: 'a'.repeat(81_000) }] }), enabledEnv);
  assert.equal(tooLarge.status, 400);
});

test('unverifiable source pages, quotes, document IDs, and invalid numbers are rejected', () => {
  assert.equal(validateExtractedRecord(record, payload), true);
  for (const source of [
    { ...record.source, page: 2 },
    { ...record.source, documentId: 'other-document' },
    { ...record.source, quote: 'A made-up assertion.' },
    { ...record.source, quote: '' },
  ]) assert.equal(validateExtractedRecord({ ...record, source }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, amount: -286.4 }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, amount: '286.40' }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, date: '2026-02-30' }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, date: 20260416 }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, rateUnit: 'cubic metres' }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, oldClosingReading: -1 }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, newOpeningReading: '00000' }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, accountLast4: 'masked 1234' }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, accountId: 123456 }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, creditReference: {} }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, accountId: '000123456', accountLast4: '3456', creditReference: 'CR-42', rateUnit: 'CCF', oldClosingReading: 600, newOpeningReading: 0 }, payload), true);
});

test('AI uses strict structured output, disables stored response, and preserves only source-grounded records', async () => {
  const original = globalThis.fetch;
  let upstreamBody;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    upstreamBody = JSON.parse(options.body);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ records: [record, { ...record, source: { ...record.source, quote: 'Invented quote' } }] }) }] }] });
  };
  try {
    const result = await handleApi(request(), enabledEnv);
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.records.length, 1);
    assert.equal(data.records[0].confidence, 'needs-review');
    assert.equal(data.reviewRequired, true);
    assert.equal(data.warnings.length, 1);
    assert.equal(upstreamBody.store, false);
    assert.equal(upstreamBody.text.format.strict, true);
    assert.equal(upstreamBody.text.format.type, 'json_schema');
  } finally { globalThis.fetch = original; }
});

test('upstream errors do not expose the provider body or credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('internal secret diagnostic', { status: 401 });
  try {
    const result = await handleApi(request(), enabledEnv);
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /secret|private|diagnostic/);
  } finally { globalThis.fetch = original; }
});

test('non-API paths defer to the asset handler', async () => {
  assert.equal(await handleApi(new Request('https://metertrace.example/')), null);
});

test('a provider key alone or a weak access token never enables a public AI endpoint', async () => {
  for (const env of [{ OPENAI_API_KEY: 'private' }, { OPENAI_API_KEY: 'private', METERTRACE_API_TOKEN: 'short' }, { OPENAI_API_KEY: 'private', METERTRACE_API_TOKEN: ' '.repeat(32) }, { METERTRACE_API_TOKEN: accessToken }, { OPENAI_API_KEY: 'private', METERTRACE_API_TOKEN: 'a'.repeat(257) }]) {
    const health = await handleApi(new Request('https://metertrace.example/api/health'), env);
    assert.deepEqual(await health.json(), { ok: true, aiEnabled: false, tokenRequired: false });
    assert.equal((await handleApi(request(), env)).status, 503);
  }
});

test('wrong tokens and cross-site fetch metadata are rejected before reading document text', async () => {
  assert.equal((await handleApi(request(payload, { 'x-metertrace-token': 'incorrect-token' }), enabledEnv)).status, 401);
  assert.equal((await handleApi(request(payload, { 'sec-fetch-site': 'cross-site' }), enabledEnv)).status, 403);
  const noOrigin = request();
  noOrigin.headers.delete('origin');
  noOrigin.headers.delete('x-metertrace-token');
  assert.equal((await handleApi(noOrigin, enabledEnv)).status, 401);
});

test('chunked bodies are cancelled as soon as the byte limit is crossed', async () => {
  let cancelled = false, upstreamCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { upstreamCalled = true; throw new Error('unexpected'); };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(210_000).fill(32));
      controller.enqueue(new Uint8Array(210_000).fill(32));
    }, cancel() { cancelled = true; },
  });
  try {
    const incoming = new Request('https://metertrace.example/api/extract', { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/json', origin: 'https://metertrace.example', 'x-metertrace-token': accessToken, 'cf-connecting-ip': `stream-${++sequence}` }, body: stream });
    const result = await handleApi(incoming, enabledEnv);
    assert.equal(result.status, 413);
    assert.equal(cancelled, true);
    assert.equal(upstreamCalled, false);
  } finally { globalThis.fetch = original; }
});

test('request limits count UTF-8 bytes rather than JavaScript characters', async () => {
  const oversized = { ...payload, pages: [{ pageNumber: 1, text: '水'.repeat(79_000) }, { pageNumber: 2, text: '水'.repeat(79_000) }] };
  const result = await handleApi(request(oversized), enabledEnv);
  assert.equal(result.status, 413);
});

test('invalid content types, malformed JSON and invalid UTF-8 are rejected', async () => {
  assert.equal((await handleApi(request(payload, { 'content-type': 'application/json-malicious' }), enabledEnv)).status, 415);
  const headers = { 'content-type': 'application/json', origin: 'https://metertrace.example', 'x-metertrace-token': accessToken };
  for (const body of ['{invalid', new Uint8Array([0xff])]) {
    const result = await handleApi(new Request('https://metertrace.example/api/extract', { method: 'POST', headers, body }), enabledEnv);
    assert.equal(result.status, 400);
  }
});

test('impossible periods, unsafe monetary magnitudes and unsupported credit statuses are not accepted', () => {
  assert.equal(validateExtractedRecord({ ...record, amount: Number.MAX_VALUE }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, periodStart: '2026-07-01', periodEnd: '2026-06-01' }, payload), false);
  assert.equal(validateExtractedRecord({ ...record, status: 'approved-without-status-mapping' }, payload), false);
});

test('provider fields are projected to the supported schema rather than persisted verbatim', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ records: [{ ...record, unexpected: 'not evidence', source: { ...record.source, surprise: 'not evidence' } }] }) }] }] });
  try {
    const result = await handleApi(request(), enabledEnv);
    const body = await result.json();
    assert.equal(result.status, 200);
    assert.equal(body.records[0].unexpected, undefined);
    assert.equal(body.records[0].source.surprise, undefined);
  } finally { globalThis.fetch = original; }
});

test('oversized provider responses fail without exposing their body', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('sensitive-upstream-content'.repeat(20_000));
  try {
    const result = await handleApi(request(), enabledEnv);
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /sensitive-upstream-content/);
  } finally { globalThis.fetch = original; }
});

test('per-isolate burst guard rejects repeated authenticated extraction requests', async () => {
  const headers = { 'cf-connecting-ip': 'same-test-client' };
  for (let i = 0; i < 12; i++) assert.equal((await handleApi(request({ ...payload, pages: [] }, headers), enabledEnv)).status, 400);
  assert.equal((await handleApi(request(payload, headers), enabledEnv)).status, 429);
});

test('reading multipliers are explicitly nullable and must be positive safe numbers', () => {
  assert.deepEqual(extractionSchema.properties.records.items.properties.readingMultiplier, { type: ['number', 'null'] });
  assert.equal(validateExtractedRecord({ ...record, readingMultiplier: null }, payload), true);
  assert.equal(validateExtractedRecord({ ...record, readingMultiplier: 1 }, payload), true);
  assert.equal(validateExtractedRecord({ ...record, readingMultiplier: 1000 }, payload), true);
  for (const readingMultiplier of [0, -1, '1', Number.MAX_VALUE, Infinity]) {
    assert.equal(validateExtractedRecord({ ...record, readingMultiplier }, payload), false);
  }
});
