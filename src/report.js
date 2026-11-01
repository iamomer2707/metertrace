/** Standalone evidence reports and active-case exports. No browser or storage access. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const number = value => typeof value === 'number' && Number.isFinite(value);
const money = value => number(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : 'not determined';
const list = value => Array.isArray(value) ? value : [];
const present = value => value !== undefined && value !== null && value !== '';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function date(value) {
  if (!DATE.test(value || '')) return 'Date unknown';
  const stamp = Date.parse(value + 'T12:00:00Z');
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return 'Date unknown';
  return new Date(stamp).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' });
}
function snapshotDate(value) {
  const stamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(stamp) ? new Date(stamp).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' America/Chicago' : 'Not recorded';
}

// Two independent 64-bit FNV-1a passes produce a bounded review identifier.
// This is a deterministic change detector, not a cryptographic integrity signature.
function hash64(text, seed) {
  let hash = seed;
  for (let index = 0; index < text.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
export function findingFingerprint(finding = {}) {
  const sources = list(finding.sources).map(source => [source?.documentId ?? '', source?.page ?? null, source?.quote ?? '']).sort((a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; });
  const value = JSON.stringify([finding.category ?? '', finding.title ?? '', finding.detail ?? '', finding.calculation ?? null, Boolean(finding.requiresReview), sources]);
  return 'finding-v2:' + hash64(value, 0xcbf29ce484222325n) + hash64(value, 0x84222325cbf29ce4n);
}

const CASE_FIELDS = ['id', 'name', 'title', 'address', 'accountId', 'accountLast4', 'description', 'createdAt', 'updatedAt', 'notes'];
const DOCUMENT_FIELDS = ['id', 'name', 'type', 'mime', 'mimeType', 'size', 'sha256', 'isDemo', 'needsOCR', 'createdAt', 'uploadedAt', 'extractionMethod'];
const PAGE_FIELDS = ['pageNumber', 'text', 'originalText', 'manuallyTranscribed'];
const RECORD_FIELDS = ['id', 'kind', 'date', 'periodStart', 'periodEnd', 'readType', 'accountId', 'accountLast4', 'billId', 'meterId', 'newMeterId', 'previousReading', 'currentReading', 'usage', 'unit', 'readingUnit', 'readingMultiplier', 'rate', 'rateUnit', 'waterCharge', 'total', 'creditApplied', 'creditReference', 'amount', 'reference', 'status', 'orderId', 'action', 'oldClosingReading', 'newOpeningReading', 'confidence', 'extractionMethod'];
const primitive = value => value === null || typeof value === 'string' || typeof value === 'boolean' || number(value);
function pick(value, fields) {
  return Object.fromEntries(fields.filter(key => Object.hasOwn(value || {}, key) && primitive(value[key])).map(key => [key, value[key]]));
}

/** A backup contains active evidence only. Trash, undo state, Blobs, and stale review keys never leave here. */
export function serializeCaseData(caseData, analysis) {
  const keys = new Set(list(analysis?.findings).map(findingFingerprint));
  const selectedKeys = field => [...new Set(list(caseData?.[field]).filter(key => typeof key === 'string' && keys.has(key)))];
  return {
    ...pick(caseData, CASE_FIELDS),
    schemaVersion: 1,
    demo: Boolean(caseData?.demo ?? caseData?.isDemo),
    originalFilesIncluded: false,
    recoveryItemsIncluded: false,
    reviewedFindings: selectedKeys('reviewedFindings'),
    excludedQuestions: selectedKeys('excludedQuestions'),
    documents: list(caseData?.documents).map(document => ({
      ...pick(document, DOCUMENT_FIELDS),
      pages: list(document.pages).map(page => pick(page, PAGE_FIELDS)),
      records: list(document.records).map(record => ({
        ...pick(record, RECORD_FIELDS),
        ...(record?.source && typeof record.source === 'object' ? { source: pick(record.source, ['documentId', 'page', 'quote']) } : {}),
      })),
    })),
  };
}

const labels = {
  id: 'Record identifier', kind: 'Record type', date: 'Date', periodStart: 'Period start', periodEnd: 'Period end', readType: 'Reading type',
  accountId: 'Full account identifier', accountLast4: 'Account last four digits', billId: 'Bill identifier', meterId: 'Meter identifier', newMeterId: 'New meter identifier',
  previousReading: 'Previous meter reading', currentReading: 'Current meter reading', readingUnit: 'Meter reading unit', readingMultiplier: 'Documented reading multiplier',
  usage: 'Billed usage', unit: 'Usage unit', rate: 'Stated rate ($ per unit)', rateUnit: 'Rate denominator', waterCharge: 'Water-only charge ($)', total: 'Total due ($)',
  creditApplied: 'Credit applied ($)', creditReference: 'Applied credit reference', amount: 'Credit notice amount ($)', reference: 'Notice reference', status: 'Documented status',
  orderId: 'Service order', action: 'Service action', oldClosingReading: 'Removed-meter closing reading', newOpeningReading: 'New-meter opening reading',
};
const CSS = `body{font:14px/1.7 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 25px;color:#20313c}h1{font-size:36px;line-height:1.2;overflow-wrap:anywhere}h2{margin-top:40px;border-top:2px solid #2f7772;padding-top:20px}h3{font-size:17px;overflow-wrap:anywhere}h4{font-size:13px}a{color:#216a68;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccd8dd;padding:10px;overflow-wrap:anywhere}.table-scroll{overflow:auto}.field-table{table-layout:fixed}.field-table th{width:44%;font-weight:500}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f5;padding:20px;font:12px/1.7 monospace}.formula{background:#e7f0ed;padding:15px;font-family:monospace;white-space:pre-wrap;overflow-wrap:anywhere}article{margin:25px 0}.label{font:11px monospace;color:#377b72}.warning{border-left:3px solid #b48a3f;padding:12px 18px;background:#faf5e9}.page{break-before:page}small{color:#657880}blockquote{white-space:pre-wrap;border-left:2px solid #adbdc4;margin:15px 0;padding:0 15px;font-size:12px;overflow-wrap:anywhere}.record{padding-top:10px;margin-top:20px;border-top:1px solid #d4dfe1}.source-page{scroll-margin-top:20px}@media(max-width:540px){body{margin:25px auto;padding:0 18px}h1{font-size:29px}th,td{padding:8px;font-size:11px}}@media print{body{margin:0;font-size:11px}a{color:inherit}h1{font-size:28px}h2{font-size:18px}pre{font-size:9px}.table-scroll{overflow:visible}tr{break-inside:avoid}.formula{break-inside:avoid}nav{display:none}}`;

/** Render a deterministic snapshot from supplied case data; no network, clock, or DOM side effects. */
export function renderCasePacket(caseData = {}, analysis = {}) {
  const documents = list(caseData.documents), findings = list(analysis.findings), timeline = list(analysis.timeline), records = list(analysis.records);
  const metrics = analysis.metrics || {};
  const index = new Map(documents.map((document, position) => [document.id, position]));
  const docLabel = id => index.has(id) ? `DOC ${String(index.get(id) + 1).padStart(2, '0')}` : 'Source unavailable';
  const anchor = source => {
    const position = index.get(source?.documentId);
    return position !== undefined && documents[position].pages?.some(page => page.pageNumber === source?.page) ? `src-${position}-${source.page}` : null;
  };
  const sourceLink = source => {
    const target = anchor(source);
    return target ? `<a href="#${esc(target)}">${esc(docLabel(source.documentId))} · page ${esc(source.page)}</a>` : '<span>Source page unavailable</span>';
  };
  const reviewed = new Set(list(caseData.reviewedFindings));
  const excluded = new Set(list(caseData.excludedQuestions));
  const questions = findings.filter(finding => !excluded.has(findingFingerprint(finding)));
  const unreviewed = records.filter(record => record.confidence !== 'reviewed').length;
  const recordHTML = (record, position) => `<section class="record"><h4>Extracted record ${position + 1} — ${esc(record.kind)}</h4><p><strong>${record.confidence === 'reviewed' ? 'Checked by resident' : 'Needs resident review'}</strong>${record.extractionMethod === 'ai' ? ' · AI suggestion' : record.extractionMethod === 'manual-transcript' ? ' · From a manual transcript' : ''}. Fields not listed are not documented.</p><table class="field-table"><tbody>${RECORD_FIELDS.filter(key => labels[key] && present(record[key])).map(key => `<tr><th>${labels[key]}</th><td>${esc(record[key])}</td></tr>`).join('')}</tbody></table>${record.source ? `<p>Supporting page: ${sourceLink(record.source)}</p><blockquote>${esc(record.source.quote)}</blockquote>` : '<p>No supporting source excerpt attached. This record must not be used without source verification.</p>'}</section>`;
  const pageHTML = (page, position) => `<section class="source-page" id="src-${position}-${esc(page.pageNumber)}"><h4>Page ${esc(page.pageNumber)}${page.manuallyTranscribed ? ' — manual transcript; compare with original file' : ' — extracted page text'}</h4><pre>${esc(page.text || '[No machine-readable text. Original file required.]')}</pre>${page.manuallyTranscribed && Object.hasOwn(page, 'originalText') ? `<h4>Original extracted text before manual transcription</h4><p><small>This preserves the earlier text extraction. It is not a substitute for the original PDF or image.</small></p><pre>${esc(page.originalText || '[No machine-readable text was available before transcription.]')}</pre>` : ''}</section>`;
  const demo = Boolean(caseData.demo ?? caseData.isDemo);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>MeterTrace — ${esc(caseData.name)}</title><style>${CSS}</style></head><body>
<div class="label">METERTRACE / EVIDENCE PACKET / ${demo ? 'FICTIONAL DEMO' : 'DRAFT FOR REVIEW'}</div><h1>${esc(caseData.name)}</h1><p>Evidence snapshot as of ${esc(snapshotDate(caseData.exportedAt || caseData.updatedAt || caseData.createdAt))}<br>${documents.length} documents · ${number(metrics.periodCount) ? metrics.periodCount : 0} billing periods · ${findings.length} findings</p>
<div class="warning">${demo ? 'All names, amounts, identifiers and documents in this case are fictional. ' : ''}This report identifies questions from the available records. It does not establish an amount legally owed, an incorrect bill, or a refund. ${unreviewed} extracted records have not been reviewed. Original uploaded files and Trash/recovery items are not embedded; attach originals separately.</div>
<h2>1. Case summary</h2><p>${number(metrics.estimatedCount) ? metrics.estimatedCount : 0} available periods are marked estimated. Numeric credit reconciliation includes ${money(metrics.creditPromised)} in promises and ${money(metrics.creditPosted)} in explicitly matching postings. The untraced total is ${money(metrics.unreconciledCredit)}, calculated separately for each reference. Excess postings do not offset another reference’s gap. ${metrics.creditNeedsReviewCount ? `${esc(metrics.creditNeedsReviewCount)} credit group(s) were excluded from numeric totals pending clarification. ` : ''}The available document set may be incomplete.</p>
${caseData.notes ? `<h3>Resident notes — personal context, not source-verified</h3><p style="white-space:pre-wrap">${esc(caseData.notes)}</p>` : ''}
<h2>2. Chronology</h2><div class="table-scroll"><table><thead><tr><th>Date</th><th>Event</th><th>Details</th><th>Source</th></tr></thead><tbody>${timeline.map(event => `<tr><td>${esc(date(event.date))}</td><td>${esc(event.title)}</td><td>${esc(event.detail)}</td><td>${sourceLink(event.source)}</td></tr>`).join('')}</tbody></table></div>
<h2>3. Findings and calculations</h2>${findings.map((finding, position) => `<article><h3>${position + 1}. ${esc(finding.title)}</h3><small>${reviewed.has(findingFingerprint(finding)) ? 'Examined by resident' : 'Not yet examined by resident'}${finding.requiresReview ? ' · Contains unreviewed fields' : ''}</small><p>${esc(finding.detail)}</p>${finding.calculation ? `<div class="formula">${esc(finding.calculation)}</div>` : ''}${list(finding.sources).length ? list(finding.sources).map(source => `<p>${sourceLink(source)}</p><blockquote>${esc(source.quote)}</blockquote>`).join('') : '<p>No verified source page is attached to this finding. Resolve that gap before using it as evidence.</p>'}</article>`).join('')}
<h2>4. Questions for clarification</h2>${questions.length ? `<ol>${questions.map(finding => `<li>${esc(finding.question)}</li>`).join('')}</ol>` : '<p>No clarification questions selected.</p>'}
<h2>5. Calculation and extraction method</h2><p>Records come from supplied pages and resident-reviewed fields. A source excerpt must appear on its numbered page before a record can be used in reconciliation. A manual transcript is identified as such and needs comparison with the original file. Credit checks require an explicit full-account identity and matching adjustment reference; ambiguous or conflicting statements are excluded from numeric totals. Repeated records are counted once. Arithmetic uses integer cents. Rates come from documents, not an official rate table. Reading-difference checks require explicit matching reading and usage units and do not subtract readings across a documented meter change. Unreviewed suggestions may appear and must be checked.</p><p>Estimated bills and possible service-order overlaps prompt clarification; they do not prove an error. The Chicago OIG’s <a href="https://igchicago.org/publications/water-billing-audit/" rel="noopener noreferrer">May 6, 2026 audit</a> supplies general context, not evidence about this account. MeterTrace is independent of the City.</p>
<h2 class="page">6. Source inventory and page appendix</h2>${documents.map((document, position) => `<article><h3>${docLabel(document.id)} — ${esc(document.name)}</h3><p>Type: ${esc(document.type)} · ${list(document.pages).length} pages · ${list(document.records).length} records · ${list(document.records).filter(record => record.confidence !== 'reviewed').length} unreviewed</p>${list(document.records).map(recordHTML).join('')}${list(document.pages).map(page => pageHTML(page, position)).join('')}</article>`).join('')}
<p><small>Exported from MeterTrace. Original PDFs and images remain on the resident’s device. Keep originals with this report. This packet includes active documents only; removed evidence in Trash is excluded.</small></p></body></html>`;
}
