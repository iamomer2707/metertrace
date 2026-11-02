import { deriveCase, extractRecords } from "./engine.js";
import { createDemoDocuments, demoCaseMeta } from "./demo.js";
import { extractFile } from "./documents.js";
import { loadCase, saveCase, deleteCase, readRawSavedCase, readPreviousCase } from "./storage.js";
import { assertImportCapacity, findDuplicateDocument, moveDocumentToTrash, restoreDocument, moveRecordToTrash, restoreRecord, reattachOriginal, createImportOperation } from "./case-state.js";
import { findingFingerprint, serializeCaseData, renderCasePacket } from "./report.js";
import { validateCaseImport } from "./case-data.js";
const paths = { trace: "M3 16V8l5 4 4-9 4 18 5-10", grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z", file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5", timeline: "M4 4v16 M4 7h5 M4 17h5 M12 4h8v6h-8z M12 14h8v6h-8z", scan: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M3 16v5h5 M8 8h8v8H8z", packet: "M9 4H5v18h14V4h-4 M9 2h6v5H9z M8 12h8 M8 16h5", upload: "M12 16V3 M7 8l5-5 5 5 M3 15v6h18v-6", download: "M12 3v13 M7 11l5 5 5-5 M3 16v5h18v-5", arrow: "M5 12h14 M14 7l5 5-5 5", chevron: "M9 5l7 7-7 7", down: "M6 9l6 6 6-6", plus: "M12 5v14 M5 12h14", search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0", shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6", close: "M6 6l12 12 M6 18L18 6", check: "M5 12l4 4L19 6", alert: "M12 3L2 21h20z M12 9v5 M12 17v1", info: "M12 8v1 M12 12v5 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", link: "M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-3 3 M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l3-3", bolt: "M13 2L3 14h8l-1 8 11-13h-8z", meter: "M3 17a10 10 0 1 1 18 0 M12 13l5-5 M9 20h6 M5 8l2 2 M12 3v3", credit: "M3 5h18v14H3z M3 10h18 M7 15h3", building: "M4 22V8l8-5 8 5v14 M8 11v2 M12 11v2 M16 11v2 M8 16v2 M12 16v2 M16 16v2", settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2", external: "M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7", trash: "M3 6h18 M8 6V3h8v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7", edit: "M16 3l5 5-13 13H3v-5z M14 5l5 5", menu: "M3 6h18 M3 12h18 M3 18h18", clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0", refresh: "M20 7V2l-3 3a9 9 0 1 0 3 12 M20 7h-5" };
const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v ?? 0);
const date = (v) => v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? (/* @__PURE__ */ new Date(v + "T12:00:00Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "Date unknown";
const shortDate = (v) => v ? (/* @__PURE__ */ new Date(v + "T12:00:00Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "Unknown";
const $ = (s) => document.querySelector(s);
const actions = {};
const staticDeployment = document.querySelector('meta[name="metertrace-deployment"]')?.content === 'static';
let active = "overview", filter = "all", query = "", mobileOpen = false, caseData, analysis, health = { aiEnabled: false }, currentModal = null, focusBefore, toastTimer, persistQueue = Promise.resolve(), storageOK = true;
const tabs = [["overview", "grid", "Overview"], ["documents", "file", "Documents"], ["timeline", "timeline", "Billing timeline"], ["findings", "scan", "Findings"], ["packet", "packet", "Case packet"]];
const newDemo = () => ({ ...demoCaseMeta, demo: true, documents: createDemoDocuments(), createdAt: (/* @__PURE__ */ new Date()).toISOString(), reviewedFindings: [], excludedQuestions: [], notes: "" });
const emptyCase = (name = "My water billing case") => ({ id: crypto.randomUUID(), name, demo: false, documents: [], createdAt: (/* @__PURE__ */ new Date()).toISOString(), reviewedFindings: [], excludedQuestions: [], notes: "" });
const isReviewed = (f) => (caseData.reviewedFindings || []).includes(findingKey(f));
const findingKey = findingFingerprint;
const unreviewed = () => analysis.records.filter((r) => r.confidence !== "reviewed").length;
let activeOperation = null, recoveryBlocked = false, notesDraft = null, notesTimer;
const documentDrafts = new Map();
const transcriptDrafts = new Map();
async function updateCase(mutator, {signal, expectedCaseId} = {}) {
  const operation = persistQueue.then(async () => {
    if (recoveryBlocked) throw new Error('Recover or explicitly clear the saved workspace before editing.');
    if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
    if (expectedCaseId && caseData.id !== expectedCaseId) throw new DOMException('The case changed. No documents were added.', 'AbortError');
    const draft = structuredClone(caseData);
    const next = mutator(draft) || draft;
    next.updatedAt = new Date().toISOString();
    const validKeys = new Set(deriveCase(next.documents).findings.map(findingKey));
    next.reviewedFindings = (next.reviewedFindings || []).filter(k => validKeys.has(k));
    next.excludedQuestions = (next.excludedQuestions || []).filter(k => validKeys.has(k));
    await saveCase(next, {signal});
    caseData = next;
    storageOK = true;
    return next;
  });
  persistQueue = operation.catch(() => {});
  try { return await operation; } catch (error) { if (error.name !== 'AbortError') storageOK = false; throw error; }
}
function captureDraft() {
  captureTranscript();
  const editor = document.querySelector('.modal[data-editor-doc]');
  if (!editor?.dataset.editorDoc) return;
  const doc = caseData.documents.find(d => d.id === editor.dataset.editorDoc);
  if (!doc) return;
  const values = {};
  for (const card of editor.querySelectorAll('[data-record-index]')) {
    const record = doc.records.find(r => r.id === card.dataset.recordId);
    if (!record) continue;
    values[record.id] = Object.fromEntries([...card.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el.type === 'checkbox' ? el.checked : el.value]));
  }
  if (JSON.stringify(values) !== editor.dataset.initialValues) documentDrafts.set(doc.id, values);
  else documentDrafts.delete(doc.id);
}
function captureTranscript() {
  const editor=document.querySelector('.modal[data-transcript-doc]');
  if(!editor?.dataset.transcriptDoc)return;
  const key=editor.dataset.transcriptDoc+':'+editor.dataset.transcriptPage;
  const value=editor.querySelector('#transcript-text')?.value;
  if(value!==undefined&&value!==editor.dataset.transcriptInitial)transcriptDrafts.set(key,value);
  else transcriptDrafts.delete(key);
}
function clearTranscript(docId,page){transcriptDrafts.delete(docId+':'+page);const editor=document.querySelector('.modal[data-transcript-doc]');if(editor?.dataset.transcriptDoc===docId)delete editor.dataset.transcriptDoc;}
function clearDraft(id) {
  documentDrafts.delete(id);
  const editor = document.querySelector('.modal[data-editor-doc]');
  if (editor?.dataset.editorDoc === id) delete editor.dataset.editorDoc;
}
function initializeEditor(doc) {
  const editor = document.querySelector('.modal');
  editor.dataset.editorDoc = doc.id;
  const baseline = {};
  for (const card of editor.querySelectorAll('[data-record-index]')) {
    const record = doc.records.find(r => r.id === card.dataset.recordId);
    baseline[record.id] = Object.fromEntries([...card.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el.type === 'checkbox' ? el.checked : el.value]));
  }
  editor.dataset.initialValues = JSON.stringify(baseline);
  const draft = documentDrafts.get(doc.id);
  if (draft) for (const card of editor.querySelectorAll('[data-record-index]')) {
    const record = doc.records.find(r => r.id === card.dataset.recordId);
    for (const el of card.querySelectorAll('[data-field]')) {
      const value = draft[record.id]?.[el.dataset.field];
      if (value === undefined) continue;
      if (el.type === 'checkbox') el.checked = value; else el.value = value;
    }
  }
}
async function flushNotes() {
  clearTimeout(notesTimer);
  if (!notesDraft) return;
  const draft = notesDraft;
  if (draft.caseId !== caseData.id) { notesDraft = null; return; }
  await updateCase(next => { next.notes = draft.value; }, {expectedCaseId:draft.caseId});
  if (notesDraft === draft) notesDraft = null;
}
function cancelOperation() {
  if (!activeOperation) return;
  activeOperation.cancel(); activeOperation = null;
  toast('Cancelled. No new document changes were saved.');
}

function toast(message, error = false, undo = null) {
  const el = $("#toast");
  el.textContent = message;
  if (undo) { const button = document.createElement('button'); button.className='toast-action'; button.textContent='Undo'; button.dataset.action=undo.action; if(undo.doc) button.dataset.doc=undo.doc; if(undo.id) button.dataset.id=undo.id; el.append(' ', button); }
  el.style.background = error ? "#482a30" : "#204039";
  el.style.borderColor = error ? "#80505a" : "#467267";
  el.inert = false;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove("show"); el.inert = true; }, 5500);
}
function go(tab) {
  active = tab;
  filter = "all";
  query = "";
  mobileOpen = false;
  history.replaceState(null, "", "#" + tab);
  render();
  window.scrollTo(0, 0);
  $("#main")?.focus({ preventScroll: true });
}
function sourceBtn(source, label) {
  if (!source) return "";
  return `<button class="source-link" data-action="source" data-doc="${esc(source.documentId)}" data-page="${source.page}">${icon("link")}${esc(label || docLabel(source.documentId))} \xB7 p.${source.page}</button>`;
}
function docLabel(id) {
  const i = caseData.documents.findIndex((d) => d.id === id);
  return i >= 0 ? `DOC ${String(i + 1).padStart(2, "0")}` : "Source";
}
const navCount = (id) => id === "documents" ? analysis.metrics.documentCount : id === "findings" ? analysis.findings.length : null;
function render() {
  if (!caseData) return;
  analysis = deriveCase(caseData.documents);
  const title = tabs.find((t) => t[0] === active)?.[2] || "Method & privacy";
  $("#app").innerHTML = `${mobileOpen ? '<div class="sidebar-scrim" data-action="menu"></div>' : ""}<aside id="workspace-nav" class="sidebar ${mobileOpen ? "open" : ""}" aria-label="Main navigation" ${matchMedia("(max-width:720px)").matches && !mobileOpen ? 'inert aria-hidden="true"' : ""}><a href="#overview" class="logo" data-action="nav" data-tab="overview"><span class="logo-symbol">${icon("trace")}</span><div>Meter<span>Trace</span></div></a><button class="case-selector" data-action="switch-case"><span class="case-mark">${icon("building")}</span><span><span class="case-title">${esc(caseData.demo ? "Chicago sample case" : caseData.name.slice(0, 22))}</span><small>${caseData.demo ? "FICTIONAL \xB7 EXPLORER MODE" : "PRIVATE \xB7 THIS BROWSER"}</small></span>${icon("down")}</button><div class="nav-label mono">CASE WORKSPACE</div><nav class="nav">${tabs.map(([id, ic, label]) => `<button data-action="nav" data-tab="${id}" class="${active === id ? "active" : ""}" ${active === id ? 'aria-current="page"' : ""}>${icon(ic)}${label}${navCount(id) !== null ? `<span class="nav-count ${id === "findings" ? "warn" : ""}">${navCount(id)}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="help-box">${icon("shield")}<strong>Your evidence. Your control.</strong><p>Documents stay in this browser.<br>Every finding has a paper trail.</p><button class="text-button" data-action="nav" data-tab="method">How MeterTrace works ${icon("arrow")}</button></div><div class="sidebar-footer"><span class="side-city">${icon("building")} CHICAGO, IL</span><span><i class="online-dot"></i> V1.0</span></div></div></aside><div class="shell"><header class="topbar"><div class="breadcrumbs"><button class="mobile-menu" data-action="menu" aria-label="Toggle navigation" aria-expanded="${mobileOpen}" aria-controls="workspace-nav">${icon("menu")}</button><span class="root-crumb">Workspace</span><span class="root-crumb">/</span><span>${esc(title)}</span></div><div class="top-actions"><button class="search-btn" data-action="search" aria-label="Search your case">${icon("search")}<span>Search your case</span><kbd class="key">\u2318 K</kbd></button><span class="privacy">${icon("shield")} LOCAL-FIRST WORKSPACE</span><span class="divider"></span><button class="avatar" data-action="nav" data-tab="method" aria-label="Workspace privacy and settings">${caseData.demo ? "MT" : "ME"}</button></div></header><main id="main" tabindex="-1" class="view-enter">${({ overview, documents, timeline, findings, packet, method }[active] || overview)()}<footer class="footer-note"><span>${icon("shield")} Built for clarity. Findings are questions to verify, not determinations of what the City owes.</span><span>${storageOK ? "Saved in this browser" : "Storage unavailable \xB7 export before closing"} <span class="dot-sep">\xB7</span> <button class="text-button" data-action="nav" data-tab="method">Method & privacy</button></span></footer></main></div>`;
}
function heroArt() {
  return `<div class="hero-art" aria-hidden="true"><svg viewBox="0 0 300 190"><defs><radialGradient id="orb"><stop stop-color="#76f2db" stop-opacity=".12"/><stop offset="1" stop-color="#76f2db" stop-opacity="0"/></radialGradient></defs><circle cx="165" cy="96" r="90" fill="url(#orb)"/><ellipse cx="165" cy="96" rx="81" ry="48" transform="rotate(-27 165 96)" fill="none" stroke="#34525b" stroke-width=".8"/><ellipse cx="165" cy="96" rx="81" ry="48" transform="rotate(37 165 96)" fill="none" stroke="#34525b" stroke-width=".8"/><circle cx="165" cy="96" r="58" fill="none" stroke="#36545c" stroke-width=".7" stroke-dasharray="2 6"/><path class="trace-path" d="M28 140h55l42-44h47l29-43h68" stroke="#66c7ba" fill="none" stroke-width="1.4"/><path d="M149 73h29l10 10v38h-39z M178 73v10h10 M157 91h22 M157 98h22 M157 105h12" fill="#112a30" stroke="#76f2db" stroke-width="1.3"/><circle class="art-dot" cx="84" cy="139" r="3.5" fill="#76f2db"/><circle class="art-dot" cx="201" cy="53" r="3.5" fill="#76f2db"/><circle cx="245" cy="107" r="4" fill="#0e1a26" stroke="#e6bc79"/><text x="16" y="166" fill="#617f90" font-size="7" font-family="monospace" letter-spacing="1">SOURCE \u2192 TRACE \u2192 VERIFY</text><text x="205" y="34" fill="#72b5ad" font-size="7" font-family="monospace">EVIDENCE LINKED</text><path d="M30 45v-9h9 M274 151v9h-9" fill="none" stroke="#527879"/></svg></div>`;
}
function overview() {
  const m = analysis.metrics;
  const sorted = [...analysis.findings].sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1));
  const pending = analysis.findings.filter((f) => !isReviewed(f)).length;
  return `<div class="page-kicker mono"><span class="online-dot"></span> WATER BILLING, DECODED <span class="tag">${caseData.demo ? "FICTIONAL SAMPLE CASE" : "YOUR PRIVATE CASE"}</span></div><section class="hero"><div><h1>Make every charge<br><em>accountable.</em></h1><p>Your bills tell a story. Connect the records, trace the credits,<br class="hide-mobile"> and turn unanswered questions into a clearer case.</p><div class="hero-buttons"><button class="btn btn-primary" data-action="upload">${icon("plus")} Add documents</button><button class="btn btn-ghost" data-action="nav" data-tab="packet">${icon("packet")} Build case packet</button></div></div>${heroArt()}</section><div class="case-strip"><span><strong>${esc(caseData.name)}</strong><span class="dot-sep">/</span>${caseData.demo ? "Account \u2022\u2022\u2022\u2022 4821" : "CASE " + esc(caseData.id.slice(0, 8).toUpperCase())}<span class="dot-sep">\xB7</span>${caseData.demo ? "All sample data is fictional" : "Documents remain on this device"}</span><span class="time-meta">${icon("clock")} ${caseData.demo ? "JAN \u2014 JUN 2026" : "LOCAL WORKSPACE"}</span></div><section class="stats" aria-label="Case at a glance">${stat("DOCUMENTS IN CASE", m.documentCount, "file", `${m.recordCount} extracted records`)}${stat("BILLING PERIODS", String(m.periodCount).padStart(2, "0"), "timeline", `${m.actualCount} actual \xB7 ${m.estimatedCount} estimated`)}${stat("FINDINGS TO REVIEW", String(m.findingCount).padStart(2, "0"), "scan", `${pending} still need your review`)}${stat("CREDIT TO CLARIFY", money(m.unreconciledCredit), "credit", m.creditNeedsReviewCount?`${m.creditNeedsReviewCount} references need manual matching`:"Not a confirmed refund amount", true)}</section><div class="grid-overview"><section class="panel"><div class="panel-header"><div><div class="panel-heading">${icon("timeline")}<h2>The billing trail</h2></div><div class="panel-sub">Water use across your available statements</div></div><button class="panel-link" data-action="nav" data-tab="timeline">Explore timeline ${icon("arrow")}</button></div><div class="chart-legend"><span><i class="legend-dot"></i>ACTUAL READING</span><span><i class="legend-dot estimated"></i>ESTIMATED</span><span style="margin-left:auto">${esc(m.usageUnit || "MIXED / UNKNOWN UNITS")}</span></div>${chart()}<div class="chart-note">${icon("info")} ${m.estimatedCount ? `${m.estimatedCount} of ${m.periodCount} available periods are estimated. Ask how they were reconciled.` : "Import statements to compare actual and estimated readings."}</div></section><section class="panel readiness"><div class="readiness-head"><h2>Your path to clarity</h2><div class="ring"><span>${m.recordCount ? Math.round(((caseData.documents.length ? 1 : 0) + (unreviewed() === 0 ? 1 : 0) + (pending === 0 ? 1 : 0)) / 3 * 100) : 0}%</span></div></div>${step(1, "Gather the evidence", `${m.documentCount} documents in your case`, m.documentCount > 0)}${step(2, "Verify the details", unreviewed() ? `${unreviewed()} extracted records need review` : "Check source pages and extracted fields", m.recordCount > 0 && unreviewed() === 0)}${step(3, "Review your findings", `${pending} questions to work through`, m.findingCount > 0 && pending === 0, true)}<button class="btn btn-ghost btn-small" data-action="nav" data-tab="findings">Review findings ${icon("arrow")}</button></section></div><section><div class="section-header"><div><h2>Follow these threads <span>${m.findingCount} findings</span></h2><p>Potential gaps and contradictions, linked to the evidence.</p></div><button class="panel-link" data-action="nav" data-tab="findings">View all ${icon("arrow")}</button></div><div class="panel">${sorted.length ? sorted.slice(0, 3).map((f) => findingRow(f)).join("") : empty("scan", "A clean starting point", "Add documents to reconstruct the billing trail. No findings means no issues were detected in the available records; it does not certify a bill.", "Add documents", "upload")}</div></section>${communityInvitation()}<div class="audit-banner">${icon("building")}<div><strong>Inspired by Chicago\u2019s call for better billing records.</strong><p>The May 6, 2026 OIG audit identified administrative billing failures. A finding in this workspace still needs evidence from your account.</p></div><a href="https://igchicago.org/publications/water-billing-audit/" target="_blank" rel="noopener noreferrer">Read the official audit ${icon("external")}</a></div>`;
}
function communityInvitation() {
  return `<section class="panel community-invitation" aria-labelledby="community-title"><div><span class="eyebrow">BUILT IN PUBLIC / BETTER WITH FEEDBACK</span><h2 id="community-title">Help shape MeterTrace.</h2><p>Tried the sample? Tell us what felt clear, confusing, or missing. Your impressions help guide the next improvements.</p></div><div class="community-actions"><a class="btn btn-primary" href="https://github.com/iamomer2707/metertrace/issues/new?title=Feedback%3A%20my%20MeterTrace%20impressions" target="_blank" rel="noopener noreferrer">Share your impressions ${icon("external")}</a><a class="btn btn-ghost" href="https://github.com/iamomer2707/metertrace" target="_blank" rel="noopener noreferrer">Star on GitHub ${icon("external")}</a><a class="btn btn-ghost" href="https://github.com/iamomer2707/metertrace/fork" target="_blank" rel="noopener noreferrer">Fork the project ${icon("external")}</a></div><p class="community-note">Found it useful? A star helps others discover it; a fork lets you build on it. Feedback opens a public GitHub issue and requires a GitHub account. Use fictional examples—never post bills, account numbers, addresses, or private correspondence.</p></section>`;
}
function stat(label, value, ic, detail, highlight = false) {
  return `<article class="stat ${highlight ? "highlight" : ""}"><div class="stat-top"><span class="stat-label">${label}</span>${icon(ic)}</div><div class="stat-number">${esc(value)}</div><p>${esc(detail)}</p></article>`;
}
function step(n, title, detail, done, act = false) {
  return `<div class="step"><span class="step-no ${done ? "done" : act ? "active" : ""}">${done ? "\u2713" : String(n).padStart(2, "0")}</span><div><strong>${title}</strong><p>${esc(detail)}</p></div></div>`;
}
function chart() {
  const periods = analysis.periods.filter((p) => p.usage !== null);
  if (!periods.length) return `<div class="empty" style="padding:35px">${icon("timeline")}<p>Your billing trail will appear here.</p></div>`;
  const units = [...new Set(periods.map((p) => p.unit))];
  if (units.length !== 1 || !units[0]) return `<div class="empty" style="padding:35px"><p>Usage uses different or unknown units. Review each period below; a combined chart would be misleading.</p></div>`;
  const accounts = new Set(analysis.records.filter((r) => r.kind === "bill").map((r) => r.accountId || r.accountLast4 || "unknown"));
  if (accounts.size > 1 || accounts.has("unknown") && periods.length > 1) return '<div class="empty" style="padding:35px"><p>Multiple account identifiers are present. Review each event separately; usage is not combined in this chart.</p></div>';
  const w = 600, h = 180, left = 43, right = 24, top = 22, bottom = 36;
  const max = Math.max(...periods.map((p) => p.usage), 1) * 1.17;
  const point = (p, i) => [left + (w - left - right) * (periods.length === 1 ? 0.5 : i / (periods.length - 1)), top + (h - top - bottom) * (1 - p.usage / max)];
  const points = periods.map(point);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Billed usage by period in ${esc(units[0])}. ${esc(periods.map((p) => `${shortDate(p.periodStart)}: ${p.usage} ${p.unit}, ${p.readType}`).join("; "))}"><defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#76f2db" stop-opacity=".13"/><stop offset="1" stop-color="#76f2db" stop-opacity="0"/></linearGradient></defs>${[0, 1, 2, 3].map((i) => {
    const y = top + (h - top - bottom) * i / 3;
    return `<line class="grid-line" x1="${left}" x2="${w - right}" y1="${y}" y2="${y}"/><text x="${left - 9}" y="${y + 3}" text-anchor="end">${Math.round(max * (1 - i / 3))}</text>`;
  }).join("")}<path class="area" d="M${points[0][0]} ${h - bottom} L${points.map((p) => p.join(" ")).join(" L")} L${points.at(-1)[0]} ${h - bottom} Z"/>${points.slice(1).map((p, i) => `<path class="${periods[i].readType === "estimated" || periods[i + 1].readType === "estimated" ? "estimated-line" : periods[i].readType !== "actual" || periods[i + 1].readType !== "actual" ? "unknown-line" : "actual-line"}" d="M${points[i].join(" ")} L${p.join(" ")}"/>`).join("")}${points.map((p, i) => `<circle class="${periods[i].readType === "estimated" ? "est-point" : periods[i].readType === "actual" ? "point" : "unknown-point"}" cx="${p[0]}" cy="${p[1]}" r="4"/><text x="${p[0]}" y="${p[1] - 11}" text-anchor="middle" style="fill:${periods[i].readType === "estimated" ? "#d3b27b" : "#83cebf"}">${periods[i].usage}</text><text x="${p[0]}" y="${h - 12}" text-anchor="middle">${esc(shortDate(periods[i].periodStart))}\u2013${esc(shortDate(periods[i].periodEnd))}</text>`).join("")}</svg>`;
}
function empty(ic, title, detail, btn, action) {
  return `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3><p>${esc(detail)}</p>${btn ? `<button class="btn btn-primary" data-action="${action}">${esc(btn)} ${icon("arrow")}</button>` : ""}</div>`;
}
function findingRow(f) {
  const cat = { credits: "credit", meter: "meter", service: "settings", estimates: "timeline", calculation: "scan", documents: "file", account: "shield" };
  return `<article class="finding ${isReviewed(f) ? "dismissed" : ""}"><div class="finding-icon ${f.severity}">${icon(cat[f.category] || "info")}</div><div><h3><button style="background:none;padding:0;text-align:left;color:inherit;font:inherit" data-action="finding" data-id="${esc(f.id)}">${esc(f.title)}</button></h3><p>${esc(f.detail.length > 155 ? f.detail.slice(0, 152) + "\u2026" : f.detail)}</p><div class="finding-meta"><span class="badge ${isReviewed(f) ? "cyan" : f.severity === "high" ? "" : "gray"}">${isReviewed(f) ? "REVIEWED" : f.severity === "high" ? "NEEDS CLARIFICATION" : "REVIEW PROMPT"}</span><span>${f.sources.length} source${f.sources.length === 1 ? "" : "s"} linked</span>${f.requiresReview ? '<span class="hide-mobile">\xB7 fields need review</span>' : ""}</div></div><button class="finding-action" data-action="finding" data-id="${esc(f.id)}" aria-label="Review ${esc(f.title)}">${icon("chevron")}</button></article>`;
}
function pageHead(kicker, title, description, buttons = "") {
  return `<div class="page-head"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></div>${buttons ? `<div class="hero-buttons" style="margin-top:4px">${buttons}</div>` : ""}</div>`;
}
function documents() {
  const docs = caseData.documents.filter((d) => (filter === "all" || filter === "review" ? filter === "all" || d.records.some((r) => r.confidence !== "reviewed") || !d.records.length : d.type === filter) && (!query || d.name.toLowerCase().includes(query.toLowerCase())));
  return `${pageHead("01 / THE EVIDENCE LOCKER", "Every document. One clear trail.", "Bring together bills, meter notices, credit approvals, and correspondence. Open any document to verify its extracted details.", `<button class="btn btn-primary" data-action="upload">${icon("plus")} Add documents</button>`)}${caseData.demo ? `<div class="notice amber">${icon("info")} This is a fictional sample. Start your own case before adding personal documents.<button class="text-button" style="margin-left:auto;white-space:nowrap" data-action="new-case">Start my case ${icon("arrow")}</button></div>` : ""}<div class="row-between"><button class="text-button" data-action="trash">${icon("trash")} Trash & recovery (${(caseData.trashDocuments||[]).length+(caseData.trashRecords||[]).length})</button><span class="mono muted" style="font-size:9px">100 MB / 200 DOCUMENT LIMIT</span></div><div class="toolbar"><div class="filters">${[["all", "All documents"], ["bill", "Bills"], ["service", "Service orders"], ["credit", "Credits"], ["review", "Needs review"]].map(([v, t]) => `<button class="filter ${filter === v ? "active" : ""}" data-action="filter" data-filter="${v}">${t}</button>`).join("")}</div><input class="search-input" data-search="documents" placeholder="Find a document\u2026" aria-label="Filter documents" value="${esc(query)}"></div><div class="panel" style="overflow:auto"><table class="doc-table"><thead><tr><th>DOCUMENT</th><th class="hide-mobile">TYPE</th><th class="hide-tablet">PAGES</th><th>REVIEW STATUS</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${docs.map((d) => `<tr><td><button class="doc-name" style="background:none;text-align:left;padding:0" data-action="document" data-doc="${esc(d.id)}">${icon(d.type === "credit" ? "credit" : d.type === "service" ? "settings" : "file")}<span><strong>${esc(d.name)}</strong><small>${docLabel(d.id)} \xB7 ${d.records.length} record${d.records.length !== 1 ? "s" : ""}${d.isDemo ? " \xB7 fictional" : ""}</small></span></button></td><td class="hide-mobile">${esc(d.type)}</td><td class="hide-tablet">${d.pages.length}</td><td><span class="badge ${d.records.length && d.records.every((r) => r.confidence === "reviewed") ? "cyan" : "gray"}">${d.needsOCR ? "TRANSCRIBE" : d.records.length && d.records.every((r) => r.confidence === "reviewed") ? "REVIEWED" : "NEEDS REVIEW"}</span></td><td><button class="icon-btn" data-action="document" data-doc="${esc(d.id)}" aria-label="Review ${esc(d.name)}">${icon("chevron")}</button></td></tr>`).join("")}</tbody></table>${!docs.length ? empty("file", "No documents here yet", "Add a bill or notice to begin. You can review all fields before using a finding.") : ""}</div><div class="dropzone" data-dropzone style="margin-top:22px">${icon("upload")}<div><strong>Drop your documents here</strong><p>PDF, text, PNG, JPG & WebP \xB7 up to 20 MB per file \xB7 50 PDF pages</p></div><button class="btn btn-ghost btn-small" data-action="upload">Browse files ${icon("plus")}</button></div><div class="notice">${icon("shield")} Files and extracted text are stored only in this browser. Scanned pages need a manual transcript. Optional AI sends page text only after your approval.</div>`;
}
function timeline() {
  return `${pageHead("02 / FOLLOW THE SEQUENCE", "The story between statements.", "See billing periods, meter events, and credit notices in order. An estimated period is a question to investigate, not evidence of an incorrect charge.")}<section class="panel standalone-chart"><div class="panel-header"><div><h2>Billed water use</h2><div class="panel-sub">Each point is the usage stated on one available bill.</div></div><span class="badge gray">${esc(analysis.metrics.usageUnit || "UNITS VARY")}</span></div><div class="chart-legend"><span><i class="legend-dot"></i>ACTUAL</span><span><i class="legend-dot estimated"></i>ESTIMATED</span></div>${chart()}</section><div class="toolbar"><div class="filters">${[["all", "All events"], ["bill", "Bills"], ["service", "Meter & service"], ["credit", "Credits"]].map(([v, t]) => `<button class="filter ${filter === v ? "active" : ""}" data-action="filter" data-filter="${v}">${t}</button>`).join("")}</div><span class="mono muted" style="font-size:9px">${analysis.timeline.length} SOURCE-LINKED EVENTS</span></div><section class="panel"><div class="timeline">${analysis.timeline.filter((e) => filter === "all" || e.kind === filter).map((e) => `<article class="timeline-item"><div class="timeline-date">${esc(date(e.date))}</div><div class="timeline-node ${e.title.startsWith("estimated") ? "estimated" : ""}"></div><div><h3>${esc(e.title.replace(/^./, (c) => c.toUpperCase()))}</h3><p>${esc(e.detail)}</p>${sourceBtn(e.source)}</div></article>`).join("") || empty("timeline", "Your timeline starts with a document", "Import bills and notices to reconstruct the available history.", "Add documents", "upload")}</div></section>`;
}
function findings() {
  const list = analysis.findings.filter((f) => filter === "all" || filter === "reviewed" && isReviewed(f) || filter === "open" && !isReviewed(f) || filter === f.category);
  return `${pageHead("03 / THE THREADS WORTH PULLING", "Questions, backed by evidence.", "Each finding shows the records behind it, any calculation, and a precise question. Review the source before treating an extracted fact as reliable.", `<button class="btn btn-ghost" data-action="nav" data-tab="packet">${icon("packet")} Build packet</button>`)}${unreviewed() ? `<div class="notice amber">${icon("alert")} ${unreviewed()} extracted records still need review. Findings based on those records are provisional.<button class="text-button" data-action="nav" data-tab="documents" style="margin-left:auto;white-space:nowrap">Review fields ${icon("arrow")}</button></div>` : ""}<div class="toolbar"><div class="filters">${[["all", "All findings"], ["open", "To review"], ["credits", "Credits"], ["meter", "Meters"], ["service", "Service orders"], ["reviewed", "Reviewed"]].map(([v, t]) => `<button class="filter ${filter === v ? "active" : ""}" data-action="filter" data-filter="${v}">${t}</button>`).join("")}</div><span class="mono muted" style="font-size:9px">${list.length} FINDINGS</span></div><div class="panel">${list.map(findingRow).join("") || empty("scan", "No findings in this view", "Findings depend on the available records. A quiet view does not certify an account or determine a refund.")}</div><div class="notice">${icon("info")} Reviewing a finding records that you have examined it. It does not mean the City has resolved the issue or accepted the calculation.</div>`;
}
function packet() {
  const included = analysis.findings.filter((f) => !(caseData.excludedQuestions || []).includes(findingKey(f)));
  return `${pageHead("04 / READY FOR A REAL CONVERSATION", "A case you can explain.", "Package the chronology, calculations, supporting excerpts, and specific questions. Export a self-contained report to share or print.")}${analysis.metrics.creditNeedsReviewCount?`<div class="notice amber">${icon("alert")} ${analysis.metrics.creditNeedsReviewCount} credit references or notices are excluded from numeric totals because identity, dates, or postings remain ambiguous. Review those findings separately.</div>`:""}<div class="packet-grid"><div><article class="packet-preview"><div class="row-between"><span class="eyebrow">METERTRACE / EVIDENCE PACKET</span><span class="badge">${caseData.demo ? "FICTIONAL DEMO" : "DRAFT FOR REVIEW"}</span></div><h2>${esc(caseData.name)}</h2><p>Chicago water-billing reconciliation<br>${analysis.metrics.documentCount} documents \xB7 ${analysis.metrics.periodCount} billing periods \xB7 ${analysis.findings.length} findings<br>Prepared ${(/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { timeZone: "America/Chicago", dateStyle: "long" })}</p><h3>01 \u2014 Case summary</h3><p>${analysis.metrics.estimatedCount} available billing periods are marked estimated. ${analysis.metrics.creditPromised ? `Credit notices state ${money(analysis.metrics.creditPromised)}; matching bills show ${money(analysis.metrics.creditPosted)} applied.` : "Credit reconciliation requires notices and bills with matching account and adjustment references."} Findings identify what to clarify from the available evidence.</p>${analysis.metrics.creditPromised ? `<div class="formula">${money(analysis.metrics.creditPromised)} in promises \xB7 ${money(analysis.metrics.creditPosted)} in matching postings<br>Untraced across individual references: ${money(analysis.metrics.unreconciledCredit)}<br>Each reference is reconciled separately; over-postings do not offset gaps.</div>` : ""}<h3>02 \u2014 Questions for clarification</h3>${included.length ? `<ol>${included.map((f) => `<li>${esc(f.question)}</li>`).join("")}</ol>` : "<p>No questions selected. Add and review evidence to generate specific questions.</p>"}<h3>03 \u2014 Source appendix</h3><p>Export includes a document inventory, source page text, exact excerpts, field-review status, and formulas. Original PDF/image files remain in this browser and must be attached separately.</p>${unreviewed() ? `<p><strong>${unreviewed()} records have not been reviewed. Verify them before sharing.</strong></p>` : ""}<p style="font-size:9px;margin-top:25px">MeterTrace is an independent tool. It is not affiliated with the City of Chicago. This report does not determine legal rights or amounts owed.</p></article><section class="panel" style="padding:22px;margin-top:22px"><h3>Choose your clarification questions</h3>${analysis.findings.map((f) => `<div class="question-item"><label><input type="checkbox" data-question="${esc(f.id)}" ${!(caseData.excludedQuestions || []).includes(findingKey(f)) ? "checked" : ""}><span>${esc(f.question)}</span></label></div>`).join("") || '<p class="detail-copy">Questions will appear after reconciliation.</p>'}<div class="field" style="margin-top:20px"><label for="case-notes">Your context or additional questions</label><textarea id="case-notes" placeholder="For example: I called about this credit on June 12\u2026">${esc(notesDraft?.caseId === caseData.id ? notesDraft.value : caseData.notes || "")}</textarea><small>Label personal recollections separately from documented facts.</small></div><button class="btn btn-ghost btn-small" data-action="save-notes">Save notes ${icon("check")}</button></section></div><aside><section class="panel packet-controls"><span class="eyebrow">TAKE THE EVIDENCE WITH YOU</span><h3 style="margin-top:15px">Your reviewable case packet</h3><p>A standalone HTML report with page links and a print layout. Open it in any browser and choose Print \u2192 Save as PDF.</p><button class="btn btn-primary" data-action="export-packet">${icon("download")} Download evidence packet</button><button class="btn btn-ghost" data-action="export-json">${icon("download")} Export case data (JSON)</button><p style="font-size:10px;margin-top:18px">Exports contain document text and account details. Original files, Trash, and unsaved field drafts are excluded. Review what you share.</p></section><div class="notice amber">${icon("info")} ${caseData.demo ? "This packet uses fabricated sample records. Start your own case for a resident report." : `${unreviewed()} unreviewed records. An export is a snapshot of the current evidence, not a verified account statement.`}</div></aside></div>`;
}
function method() {
  return `${pageHead("TRANSPARENCY / BY DESIGN", "Trust the trail. Check the work.", "A resident-centered evidence workspace, independent of the City of Chicago. Built to make records easier to inspect and questions easier to ask.")}<div class="settings-grid"><section class="panel"><h2>${icon("scan")} How findings are made</h2><p>PDF and text extraction runs locally. Label-based extraction suggests records; you review their fields against the page. Optional AI extraction can organize page text when enabled.</p><ul><li>Every usable record needs an exact excerpt on a numbered source page.</li><li>Credits match by account and explicit adjustment reference. Repeated bill records are counted once.</li><li>Calculations use integer cents. Usage arithmetic requires matching units; readings are not subtracted across a documented meter replacement.</li><li>Missing records generate questions, not assumed charges or refunds.</li></ul><p>Reading types, usage, and rates come from your documents. MeterTrace does not maintain an official City rate table.</p></section><section class="panel"><h2>${icon("shield")} Your documents and privacy</h2><p>Documents and case data are stored in this browser using IndexedDB. There is no cloud document account or document sync. The last replaced resident case is kept as one local recovery copy. Removed evidence stays in Trash until you permanently empty it. Anyone with access to this browser profile may be able to read the case.</p><p>MeterTrace does not encrypt saved case data. ${staticDeployment ? "This GitHub Pages address shares browser storage access with other sites hosted at iamomer2707.github.io. Use a trusted browser profile and keep exported backups private." : "Use a trusted browser profile and keep exported backups private."}</p><p>Browser storage can be cleared or evicted. Export your case data and keep the originals. Exports include source text and may contain sensitive information.</p><div class="status-line"><span class="online-dot"></span> AI extraction ${staticDeployment ? "unavailable \xB7 local review available" : health.aiEnabled ? "available \xB7 opt-in per document" : "not configured \xB7 local extraction available"}</div><p>When enabled, AI sends the selected document\u2019s page text to OpenAI through this site\u2019s server. The key stays on the server. The API request uses store:false; provider data-retention policies still apply.</p><button class="btn btn-ghost btn-small" data-action="export-json">Export case data</button> <button class="btn btn-danger btn-small" data-action="delete-case">Clear this browser\u2019s case</button></section><section class="panel"><h2>${icon("building")} Why Chicago?</h2><div class="audit-quote"><p>Better questions start with the administrative record.</p></div><p>The Office of Inspector General\u2019s May 6, 2026 audit identified errors involving estimates, credits, service orders, and communication. It found the meters typically installed in small residential buildings generally accurate.</p><p>This context motivates the workflow. It is not evidence of an error in your individual account.</p><a href="https://igchicago.org/publications/water-billing-audit/" target="_blank" rel="noopener noreferrer">Read the official audit ${icon("external")}</a></section><section class="panel"><h2>${icon("info")} What a finding means</h2><p>\u201CUntraced credit\u201D means a promised amount is not fully matched in the uploaded records. Another bill, revised notice, or ledger entry may explain the difference.</p><p>\u201COrders may overlap\u201D means the records describe similar work. Separate visits can be legitimate. Ask for completion notes.</p><p>\u201CReviewed\u201D means you examined the source and fields. It does not mark a dispute resolved. There is no automatic submission to the City.</p><button class="text-button" data-action="switch-case">${caseData.demo ? "Start your own case" : "Manage this case"} ${icon("arrow")}</button></section></div>`;
}
function openModal(content, drawer = false) {
  captureDraft();
  focusBefore = document.activeElement;
  $("#overlay").innerHTML = `<div class="modal-backdrop ${drawer ? "drawer-backdrop" : ""}" data-backdrop><section class="modal ${drawer ? "drawer" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">${content}</section></div>`;
  document.body.style.overflow = "hidden";
  $("#app").inert=true;
  requestAnimationFrame(() => $("#overlay button, #overlay input")?.focus());
}
const modalTop = (kicker) => `<div class="modal-top"><span class="eyebrow">${kicker}</span><button class="icon-btn" data-action="close" aria-label="Close dialog">${icon("close")}</button></div>`;
function closeModal() {
  captureDraft();
  cancelOperation();
  currentModal = null;
  $("#overlay").innerHTML = "";
  document.body.style.overflow = "";
  $("#app").inert=false;
  focusBefore?.isConnected && focusBefore.focus();
}
function showFinding(id) {
  const f = analysis.findings.find((f2) => f2.id === id);
  if (!f) return;
  currentModal = { type: "finding", id };
  openModal(`${modalTop("FINDING / " + esc(f.category.toUpperCase()))}<h2 id="modal-title">${esc(f.title)}</h2><span class="badge ${isReviewed(f) ? "cyan" : "gray"}">${isReviewed(f) ? "REVIEWED BY YOU" : "QUESTION TO VERIFY"}</span>${f.requiresReview ? '<div class="notice amber">' + icon("alert") + "Some source fields still need review. Check the extracted records before relying on this finding.</div>" : ""}<p class="detail-copy">${esc(f.detail)}</p>${f.calculation ? `<div class="drawer-section"><h3>Explicit calculation</h3><div class="formula">${esc(f.calculation)}</div></div>` : ""}<div class="drawer-section"><h3>Follow the sources</h3>${f.sources.map((s) => `<div class="record-card"><div class="row-between"><span class="mono muted" style="font-size:9px">${esc(docLabel(s.documentId))} \xB7 PAGE ${s.page}</span>${sourceBtn(s, "Open page")}</div><p style="font-size:11px;line-height:1.8;white-space:pre-wrap">${esc(s.quote.length > 550 ? s.quote.slice(0, 550) + "\u2026" : s.quote)}</p></div>`).join("") || "<p>No verified page is attached. Fix the record\u2019s source before using it.</p>"}</div><div class="drawer-section"><h3>A precise clarification question</h3><div class="notice">${icon("info")}<span>${esc(f.question)}</span></div><button class="btn btn-ghost btn-small" data-action="copy-question" data-id="${f.id}">${icon("file")} Copy question</button></div><div class="modal-actions"><button class="btn btn-ghost" data-action="close">Close</button><button class="btn btn-primary" data-action="review-finding" data-id="${f.id}">${icon("check")} ${isReviewed(f) ? "Mark as to review" : "Mark reviewed"}</button></div><p style="font-size:10px">Reviewed means you examined the evidence; it does not mark the issue resolved.</p>`, true);
}
function showSource(docId, page = 1) {
  const doc = caseData.documents.find((d) => d.id === docId);
  if (!doc) return;
  const p = doc.pages.find((p2) => p2.pageNumber === Number(page)) || doc.pages[0];
  currentModal = { type: "source", docId, page: p.pageNumber };
  openModal(`${modalTop("SOURCE / " + docLabel(doc.id))}<h2 id="modal-title">${esc(doc.name)}</h2><div class="source-controls"><label class="muted" style="font-size:11px">Page <select id="source-page-select" data-source-doc="${esc(doc.id)}" aria-label="Select source page">${doc.pages.map((pg) => `<option value="${pg.pageNumber}" ${p.pageNumber === pg.pageNumber ? "selected" : ""}>${pg.pageNumber} of ${doc.pages.length}</option>`).join("")}</select></label>${doc.blob ? `<button class="btn btn-ghost btn-small" data-action="original" data-doc="${esc(doc.id)}" data-page="${p.pageNumber}">${icon("external")} Open original</button>` : `<span class="badge gray">${doc.isDemo?"FICTIONAL TEXT SOURCE":"ORIGINAL NOT ATTACHED"}</span>`}</div>${p.manuallyTranscribed ? '<div class="notice amber">' + icon("info") + "This page was manually transcribed. Compare it with the original file.</div>" : ""}<div class="source-page">${esc(p.text || "No machine-readable text on this page. Open the original and add a manual transcript in document review.")}</div><div class="modal-actions"><button class="btn btn-ghost" data-action="document" data-doc="${esc(doc.id)}">${icon("edit")} Review extracted records</button><button class="btn btn-primary" data-action="close">Done</button></div>`, true);
}
const fieldSets = { bill: [["date", "Bill date", "date"], ["accountId", "Full account ID", "text"], ["accountLast4", "Account last 4 digits", "text"], ["meterId", "Meter ID", "text"], ["periodStart", "Period start", "date"], ["periodEnd", "Period end", "date"], ["readType", "Reading type", "select", "unknown,actual,estimated"], ["unit", "Usage unit", "select", ",CCF,gallons"], ["readingUnit", "Meter reading unit", "select", ",CCF,gallons"], ["readingMultiplier", "Meter reading multiplier", "number"], ["previousReading", "Previous reading", "number"], ["currentReading", "Current reading", "number"], ["usage", "Billed usage", "number"], ["rate", "Rate per unit ($)", "number"], ["rateUnit", "Rate denominator", "select", ",CCF,gallons"], ["waterCharge", "Water-only charge ($)", "number"], ["total", "Total due ($)", "number"], ["creditApplied", "Credit applied ($)", "number"], ["creditReference", "Credit reference", "text"]], credit: [["date", "Notice date", "date"], ["accountId", "Full account ID", "text"], ["accountLast4", "Account last 4 digits", "text"], ["reference", "Credit reference", "text"], ["amount", "Credit amount ($)", "number"], ["status", "Credit status", "select", ",promised,posted"]], service: [["date", "Service date", "date"], ["accountId", "Full account ID", "text"], ["accountLast4", "Account last 4 digits", "text"], ["orderId", "Service order ID", "text"], ["action", "Action described", "text"], ["status", "Order status", "text"], ["meterId", "Old / current meter ID", "text"], ["newMeterId", "New meter ID", "text"], ["oldClosingReading", "Old meter closing reading", "number"], ["newOpeningReading", "New meter opening reading", "number"]] };
function recordFields(record, index) {
  return (fieldSets[record.kind] || []).map(([key, label, type, opts]) => `<div class="field"><label for="r-${index}-${key}">${label}</label>${type === "select" ? `<select id="r-${index}-${key}" data-field="${key}">${opts.split(",").map((v) => `<option value="${v}" ${(record[key] ?? "") === v ? "selected" : ""}>${v || "Unknown / not documented"}</option>`).join("")}</select>` : `<input id="r-${index}-${key}" data-field="${key}" type="${type}" ${type === "number" ? 'step="any" min="0"' : ""} value="${esc(record[key])}" placeholder="Unknown">`}</div>`).join("");
}
function showDocument(id) {
  const doc = caseData.documents.find((d) => d.id === id);
  if (!doc) return;
  currentModal = { type: "document", docId: id };
  openModal(`${modalTop("DOCUMENT REVIEW / " + docLabel(id))}<h2 id="modal-title">${esc(doc.name)}</h2><p>Verify these fields against the source. Leave unknown values blank. ${doc.isDemo ? "These records are fictional demonstration data." : "Changes remain in this browser."}</p><p class="draft-note">Edits stay in this tab while you read sources. Save to keep them after reload.</p><div class="row-between"><button class="btn btn-ghost btn-small" data-action="source" data-doc="${esc(id)}" data-page="1">${icon("file")} Read source pages</button><button class="btn btn-ghost btn-small" data-action="ai" data-doc="${esc(id)}">${icon("bolt")} AI extraction ${staticDeployment ? "\xB7 unavailable" : health.aiEnabled ? "" : "\xB7 setup needed"}</button></div>${!doc.records.length ? `<div class="notice amber">${icon("info")} No structured records detected. Repeated labels, multiple bills on one page, or unfamiliar layouts need manual separation. Add a record manually, or transcribe a scanned page first.</div>` : ""}${doc.records.map((r, i) => `<section class="record-card" data-record-index="${i}" data-record-id="${esc(r.id)}"><div class="record-card-head"><h3>${icon(r.kind === "bill" ? "file" : r.kind === "credit" ? "credit" : "settings")} ${esc(r.kind.toUpperCase())} \xB7 RECORD ${i + 1}</h3><button class="icon-btn" data-action="remove-record" data-doc="${esc(id)}" data-index="${i}" aria-label="Remove record ${i + 1}">${icon("trash")}</button></div><div class="fields-grid">${recordFields(r, i)}</div><div class="field" style="margin-top:20px"><label for="r-${i}-page">Source page number</label><select id="r-${i}-page" data-field="sourcePage">${doc.pages.map((p) => `<option value="${p.pageNumber}" ${r.source?.page === p.pageNumber ? "selected" : ""}>Page ${p.pageNumber}</option>`).join("")}</select></div><div class="field"><label for="r-${i}-quote">Exact source excerpt</label><textarea id="r-${i}-quote" data-field="sourceQuote" rows="3">${esc(r.source?.quote || "")}</textarea><small>The excerpt must appear on the selected page. Keep the original words, including punctuation.</small></div><label class="record-review"><input type="checkbox" data-field="reviewed" ${r.confidence === "reviewed" ? "checked" : ""}> I checked these fields against the source.</label></section>`).join("")}<div class="drawer-section"><h3>Add evidence</h3><div class="row-between"><select id="new-record-kind" class="search-input" aria-label="New record type"><option value="bill">Billing period</option><option value="credit">Credit notice</option><option value="service">Service order / meter change</option></select><button class="btn btn-ghost btn-small" data-action="add-record" data-doc="${esc(id)}">${icon("plus")} Add record</button></div><button class="text-button" style="margin-top:17px" data-action="transcribe" data-doc="${esc(id)}">${icon("edit")} Add or review a manual page transcript</button></div><div class="modal-actions"><button class="btn btn-ghost" data-action="discard-document" data-doc="${esc(id)}">Discard draft</button><button class="btn btn-primary" data-action="save-records" data-doc="${esc(id)}">${icon("check")} Save reviewed records</button></div><div style="border-top:1px solid var(--line);margin-top:22px;padding-top:15px"><button class="text-button" style="color:var(--red);font-size:10px" data-action="remove-doc-confirm" data-doc="${esc(id)}">Remove this document from the case</button></div>`, true);
  initializeEditor(doc);
}
function collectRecords(doc) {
  return [...$("#overlay").querySelectorAll("[data-record-index]")].map((card) => {
    const i = Number(card.dataset.recordIndex);
    const r = { ...doc.records[i] };
    card.querySelectorAll("[data-field]").forEach((el) => {
      const key = el.dataset.field;
      if (["sourcePage", "sourceQuote", "reviewed"].includes(key)) return;
      if (el.type === "number") {
        if (el.value.trim() === "") delete r[key];
        else {
          const v = Number(el.value);
          if (!Number.isFinite(v) || v < 0 || v > 1e10) throw new Error("Amounts and readings must be nonnegative and no larger than 10 billion.");
          r[key] = v;
        }
      } else {
        if (el.value === "") delete r[key];
        else r[key] = el.value.trim();
      }
    });
    const p = Number(card.querySelector('[data-field="sourcePage"]').value);
    const quote = card.querySelector('[data-field="sourceQuote"]').value;
    const page = doc.pages.find((x) => x.pageNumber === p);
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    if (card.querySelector('[data-field="reviewed"]').checked && (!quote.trim() || !norm(page?.text || "").includes(norm(quote)))) throw new Error(`Record ${i + 1}: select an exact excerpt from its source page.`);
    if (r.kind === "bill" && r.periodStart && r.periodEnd && r.periodStart > r.periodEnd) throw new Error(`Record ${i + 1}: the period end must follow the start.`);
    if (r.accountLast4 && !/^\d{4}$/.test(r.accountLast4)) throw new Error(`Record ${i + 1}: account last four must be four digits.`);
    r.source = { documentId: doc.id, page: p, quote };
    r.confidence = card.querySelector('[data-field="reviewed"]').checked ? "reviewed" : "needs-review";
    r.id = r.id || crypto.randomUUID();
    return r;
  });
}
function showUpload() {
  if (caseData.demo) {
    showStart();
    return;
  }
  currentModal = { type: "upload" };
  openModal(`${modalTop("ADD TO YOUR EVIDENCE LOCKER")}<h2 id="modal-title">Start with the paper trail.</h2><p>Bills, credit notices, service orders, and correspondence work together. Import original files and review what MeterTrace finds.</p><div class="dropzone" data-dropzone>${icon("upload")}<div><strong>Drop files here, or browse</strong><p>20 MB per file \xB7 PDF up to 50 pages</p></div><button class="btn btn-primary" data-action="browse">Choose files ${icon("plus")}</button></div><input id="file-input" class="sr-only" type="file" multiple accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"><div class="notice">${icon("shield")} Files are read and saved locally. No document is sent to an AI service during import.</div><p style="font-size:10px">Scanned PDFs and images need a manual transcript. Password-protected PDFs must be unlocked before import. PDFs with unusual layouts may need manual fields.</p><div class="modal-actions"><button class="btn btn-ghost" data-action="close">Done</button></div>`);
}
function showStart() {
  currentModal = { type: "new" };
  openModal(`${modalTop("A CLEARER CASE STARTS HERE")}<h2 id="modal-title">Make room for your evidence.</h2><p>${caseData.demo ? "The sample case uses entirely fictional documents. Start a fresh workspace for your own records." : "Starting a case replaces this workspace. Your most recent resident case stays recoverable under Manage case; keep a separate export and originals."}</p><div class="field"><label for="new-case-name">Case name</label><input id="new-case-name" maxlength="80" placeholder="e.g. My 2026 water billing review" value="My water billing case"></div><div class="modal-actions"><button class="btn btn-ghost" data-action="close">Keep current case</button><button class="btn btn-primary" data-action="create-case">Create my case ${icon("arrow")}</button></div>`);
}
function showSwitch() {
  openModal(`${modalTop("YOUR WORKSPACE")}<h2 id="modal-title">Follow a different trail.</h2><p>One active case and the most recent replaced resident case are kept in this browser. Export case data and keep originals before switching.</p><div class="case-options"><button class="option-card" data-action="new-case">${icon("plus")}<strong>Start my case</strong><p>A fresh workspace for your documents.</p></button><button class="option-card" data-action="demo-confirm">${icon("eye")}<strong>Explore the sample</strong><p>Six fictional documents. Four evidence threads.</p></button></div><button class="btn btn-ghost btn-small" data-action="export-json">${icon("download")} Export current case data</button><button class="btn btn-ghost btn-small" style="margin-left:8px" data-action="restore">${icon("upload")} Restore case data</button><button class="btn btn-ghost btn-small" style="margin-top:12px" data-action="recover-previous">${icon("refresh")} Recover previous case</button><input type="file" id="restore-file" accept="application/json,.json" class="sr-only">`);
}
async function importFiles(files) {
  if(caseData.demo){showStart();return;}
  const list=[...files]; if(!list.length)return;
  try{if(list.length>20)throw new Error('Import up to 20 files at a time.');if(list.reduce((n,f)=>n+f.size,0)>100*1024*1024)throw new Error('Keep each import batch at or below 100 MB.');}catch(e){toast(e.message,true);return;}
  cancelOperation();
  const operation=createImportOperation(caseData.id); activeOperation=operation;
  openModal(`${modalTop('LOCAL EXTRACTION')}<h2 id="modal-title">Connecting the paper trail.</h2><p id="import-status">Reading on this device…</p><div class="progress-bar"><span></span></div><p>Nothing is added until the batch is finished. Cancel to keep the case unchanged.</p><button class="btn btn-ghost" data-action="close">Cancel import</button>`);
  const staged=[],attachments=[],errors=[],duplicates=[];
  try{
    const known=structuredClone(caseData);
    for(const document of [...known.documents,...(known.trashDocuments||[]).map(t=>t.document)]){
      if(!document.sha256&&document.blob){operation.assertCurrent(caseData.id);document.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await document.blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');}
    }
    for(const file of list){
      operation.assertCurrent(caseData.id);
      if($('#import-status'))$('#import-status').textContent=`Reading ${file.name}…`;
      try{
        const doc=await extractFile(file,{signal:operation.signal});operation.assertCurrent(caseData.id);
        const duplicate=findDuplicateDocument({...known,documents:[...known.documents,...staged]},doc.sha256);
        if(duplicate){if(duplicate.location==='active'&&!duplicate.document.blob){attachments.push({id:duplicate.document.id,blob:doc.blob,mime:doc.mime,size:doc.size,sha256:doc.sha256});duplicate.document.blob=doc.blob;}else duplicates.push(`${file.name}: already ${duplicate.location==='trash'?'in Trash; restore it there':'in this case'}.`);continue;}
        doc.records=extractRecords(doc.pages,doc.id).map(r=>({...r,id:crypto.randomUUID()}));
        assertImportCapacity({...known,documents:[...known.documents,...staged]},[doc]);staged.push(doc);
      }catch(e){if(e.name==='AbortError')throw e;errors.push(e.message);}
    }
    operation.assertCurrent(caseData.id);
    if(staged.length||attachments.length)await updateCase(next=>{operation.assertCurrent(next.id);for(const doc of staged){if(!findDuplicateDocument(next,doc.sha256))next.documents.push(doc);}for(const item of attachments)next=reattachOriginal(next,item.id,item);return next;},{signal:operation.signal,expectedCaseId:operation.caseId});
    if(activeOperation===operation)activeOperation=null;
    closeModal();go('documents');
    const results=[...errors,...duplicates];
    toast(`${staged.length} document(s) added. ${attachments.length} original(s) reattached. ${duplicates.length} duplicate(s) skipped.`,errors.length>0);
    if(results.length)openModal(`${modalTop('IMPORT RESULTS')}<h2 id="modal-title">${staged.length} added. ${results.length} not added.</h2>${results.map(t=>`<p>${esc(t)}</p>`).join('')}<div class="modal-actions"><button class="btn btn-ghost" data-action="trash">Open Trash</button><button class="btn btn-primary" data-action="close">Review documents</button></div>`);
  }catch(e){if(activeOperation===operation)activeOperation=null;if(e.name!=='AbortError'){closeModal();render();toast(e.message,true);}}
}

function showTranscribe(id, pageNum = 1) {
  const doc = caseData.documents.find((d) => d.id === id), page = doc?.pages.find((p) => p.pageNumber === Number(pageNum));
  if (!doc || !page) return;
  openModal(`${modalTop("MANUAL TRANSCRIPTION")}<h2 id="modal-title">Bring the source into view.</h2><p>Drafts stay in this tab while you change pages. Save to keep a transcript after reload. Type the text exactly as it appears. This is a manual transcript, not automatic OCR. The original file remains unchanged.</p><div class="source-controls"><select id="transcript-page" data-doc="${esc(id)}" aria-label="Transcript page">${doc.pages.map((p) => `<option value="${p.pageNumber}" ${p.pageNumber === page.pageNumber ? "selected" : ""}>Page ${p.pageNumber}</option>`).join("")}</select>${doc.blob ? `<button class="btn btn-ghost btn-small" data-action="original" data-doc="${esc(id)}" data-page="${page.pageNumber}">${icon("external")} Open original</button>` : ""}</div><div class="field"><label for="transcript-text">Verbatim page transcript</label><textarea id="transcript-text" rows="14">${esc(page.text)}</textarea><small>Use one labelled field per line where possible. Example: Credit reference: CR-123. Existing records are preserved; changing a transcript can invalidate old excerpts.</small></div><div class="modal-actions"><button class="btn btn-ghost" data-action="discard-transcript" data-doc="${esc(id)}" data-page="${page.pageNumber}">Discard transcript draft</button><button class="btn btn-primary" data-action="save-transcript" data-doc="${esc(id)}" data-page="${page.pageNumber}">Save transcript ${icon("check")}</button></div>`, true);
  const editor=document.querySelector('.modal');editor.dataset.transcriptDoc=id;editor.dataset.transcriptPage=page.pageNumber;editor.dataset.transcriptInitial=page.text;
  const draft=transcriptDrafts.get(id+':'+page.pageNumber);if(draft!==undefined)$('#transcript-text').value=draft;
}
function showAI(id) {
  if (staticDeployment) {
    openModal(`${modalTop('LOCAL DOCUMENT REVIEW')}<h2 id="modal-title">Review the evidence locally.</h2><p>This website extracts text on your device. AI extraction is unavailable here, and page text is not sent to an AI service.</p><div class="notice">${icon('info')}Check extracted fields against their source pages, or add a manual transcript for a scanned document.</div><div class="modal-actions"><button class="btn btn-primary" data-action="document" data-doc="${esc(id)}">Continue document review ${icon('arrow')}</button></div>`);
    return;
  }
  const doc = caseData.documents.find((d) => d.id === id);
  if (!doc) return;
  openModal(`${modalTop("OPTIONAL AI EXTRACTION")}<h2 id="modal-title">${health.aiEnabled ? "Organize text with AI." : "AI is ready for configuration."}</h2>${health.aiEnabled ? `<p>This sends the text of all ${doc.pages.length} pages of <strong>${esc(doc.name)}</strong> through this site\u2019s server to OpenAI for structured extraction. Account details and other sensitive information in the text will be included. Original file bytes stay here.</p><p>New suggestions replace this document\u2019s extracted records. You will need to check them against the source. AI does not perform the reconciliation arithmetic.</p>${health.tokenRequired ? '<div class="field"><label for="ai-token">Extraction access token from the deployer</label><input id="ai-token" type="password" autocomplete="off"></div>' : ""}<label class="record-review"><input type="checkbox" id="ai-consent"> I want to send this document\u2019s page text for AI extraction.</label><div class="modal-actions"><button class="btn btn-ghost" data-action="document" data-doc="${esc(id)}">Keep local review</button><button class="btn btn-primary" data-action="run-ai" data-doc="${esc(id)}">${icon("bolt")} Send page text</button></div>` : `<p>The deployer must configure a server-side AI key and extraction access token, then redeploy to enable this optional feature. No provider key is stored in this browser.</p><div class="notice">${icon("info")} Local text extraction, field review, manual transcripts, and reconciliation are available now.</div><div class="modal-actions"><button class="btn btn-primary" data-action="document" data-doc="${esc(id)}">Continue document review ${icon("arrow")}</button></div>`}`);
}
function showSearch() {
  cancelOperation();
  openModal(`${modalTop("SEARCH YOUR EVIDENCE")}<h2 id="modal-title">Find a thread.</h2><input id="global-search" class="search-input w100" type="search" placeholder="Search documents, page text, or findings\u2026" aria-label="Search your evidence"><div class="search-results" id="search-results"><p>Try \u201Ccredit\u201D, a meter number, or an order reference.</p></div>`);
  requestAnimationFrame(() => $("#global-search").focus());
}
function searchAll(q) {
  const out = $("#search-results");
  if (!out) return;
  if (q.length < 2) {
    out.innerHTML = "<p>Enter at least two characters.</p>";
    return;
  }
  const needle = q.toLowerCase();
  const docs = caseData.documents.filter((d) => (d.name + " " + d.pages.map((p) => p.text).join(" ")).toLowerCase().includes(needle));
  const fs = analysis.findings.filter((f) => (f.title + " " + f.detail).toLowerCase().includes(needle));
  out.innerHTML = [...docs.slice(0, 6).map((d) => `<button data-action="document" data-doc="${esc(d.id)}">${icon("file")} ${esc(d.name)}<small>${docLabel(d.id)} \xB7 ${d.pages.length} page(s)</small></button>`), ...fs.slice(0, 6).map((f) => `<button data-action="finding" data-id="${f.id}">${icon("scan")} ${esc(f.title)}<small>Finding \xB7 ${f.sources.length} sources</small></button>`)].join("") || "<p>No matching evidence. Try a different term.</p>";
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3e4);
}
function exportJSON() {
  const data=serializeCaseData({...caseData,notes:notesDraft?.caseId===caseData.id?notesDraft.value:caseData.notes},deriveCase(caseData.documents));
  download('metertrace-case-data.json',JSON.stringify(data,null,2),'application/json');
  toast('Active case data exported. Trash and original files are excluded.');
}
function packetHTML(){return renderCasePacket(caseData,deriveCase(caseData.documents));}

async function restoreCase(file) {
  if (!file) return;
  if (file.size > 30*1024*1024) throw new Error('Case data must be smaller than 30 MB.');
  const imported=validateCaseImport(JSON.parse(await file.text()));
  const data={...imported,id:crypto.randomUUID(),restoredFromId:imported.id};
  openModal(`${modalTop('RESTORE CASE DATA')}<h2 id="modal-title">Restore this case?</h2><p>${esc(data.name)} contains ${data.documents.length} active documents. It opens as a new local copy; your current resident workspace stays recoverable under Manage case. Original files are not in a case-data export. Reimport matching original files to reattach them without changing reviewed fields.</p><div class="modal-actions"><button class="btn btn-ghost" data-action="close">Keep current case</button><button class="btn btn-primary" id="confirm-restore">Restore case</button></div>`);
  $('#confirm-restore').addEventListener('click',async()=>{try{await flushNotes();await updateCase(()=>data);documentDrafts.clear();transcriptDrafts.clear();notesDraft=null;closeModal();go('documents');toast('Case data restored. Keep originals separately.');}catch(e){toast(e.message,true);}});
}
function showTrash() {
  const docs=caseData.trashDocuments||[], records=caseData.trashRecords||[];
  openModal(`${modalTop('LOCAL RECOVERY')}<h2 id="modal-title">Trash & recovery</h2><p>Removed evidence is excluded from findings and exports. Restore it here, or permanently empty Trash. Original files remain local until permanently removed.</p>${docs.map(entry=>`<div class="record-card row-between"><div><strong>${esc(entry.document.name)}</strong><p>${entry.document.pages.length} source pages</p></div><button class="btn btn-ghost btn-small" data-action="restore-doc" data-doc="${esc(entry.document.id)}">Restore document</button></div>`).join('')}${records.map(entry=>`<div class="record-card row-between"><div><strong>${esc(entry.record.kind)} record</strong><p>${esc(caseData.documents.find(d=>d.id===entry.documentId)?.name||'Restore its document first')}</p></div><button class="btn btn-ghost btn-small" data-action="restore-record" data-id="${esc(entry.id)}" ${caseData.documents.some(d=>d.id===entry.documentId)?'':'disabled'}>Restore record</button></div>`).join('')}${!docs.length&&!records.length?'<div class="empty"><p>Trash is empty.</p></div>':''}<div class="modal-actions"><button class="btn btn-ghost" data-action="close">Done</button>${docs.length||records.length?'<button class="btn btn-danger" data-action="empty-trash-confirm">Empty Trash permanently</button>':''}</div>`);
}

Object.assign(actions, {
  nav:el=>{closeModal();go(el.dataset.tab);},
  menu:()=>{mobileOpen=!mobileOpen;render();},close:closeModal, search:showSearch,
  'switch-case':showSwitch,'new-case':showStart,upload:showUpload,
  browse:()=>$('#file-input')?.click(),
  filter:el=>{filter=el.dataset.filter;render();},
  finding:el=>showFinding(el.dataset.id),source:el=>showSource(el.dataset.doc,el.dataset.page),
  document:el=>showDocument(el.dataset.doc),transcribe:el=>showTranscribe(el.dataset.doc),ai:el=>showAI(el.dataset.doc),
  trash:showTrash,
  'create-case':async()=>{const name=$('#new-case-name').value.trim()||'My water billing case';cancelOperation();await flushNotes();await updateCase(()=>emptyCase(name));documentDrafts.clear();transcriptDrafts.clear();notesDraft=null;closeModal();go('documents');showUpload();},
  'demo-confirm':()=>{if(caseData.demo){closeModal();go('overview');return;}openModal(`${modalTop('SWITCH WORKSPACE')}<h2 id="modal-title">Open the fictional sample?</h2><p>The current resident case will be kept as your previous recoverable workspace. Keep a separate data export and the originals.</p><div class="modal-actions"><button class="btn btn-ghost" data-action="export-json">Export case data</button><button class="btn btn-primary" data-action="load-demo">Open sample</button></div>`);},
  'load-demo':async()=>{cancelOperation();await flushNotes();await updateCase(()=>newDemo());documentDrafts.clear();transcriptDrafts.clear();notesDraft=null;closeModal();go('overview');},
  'save-records':async el=>{const id=el.dataset.doc, doc=caseData.documents.find(d=>d.id===id);const records=collectRecords(doc);await updateCase(next=>{next.documents.find(d=>d.id===id).records=records;});clearDraft(id);closeModal();render();toast('Records saved. Findings recalculated from current evidence.');},
  'discard-document':el=>{const id=el.dataset.doc;clearDraft(id);closeModal();toast('Unsaved field draft discarded. Saved records are unchanged.');},
  'add-record':async el=>{const id=el.dataset.doc,doc=caseData.documents.find(d=>d.id===id);const records=collectRecords(doc);const kind=$('#new-record-kind').value;records.push({id:crypto.randomUUID(),kind,...(kind==='bill'?{readType:'unknown'}:{}),confidence:'needs-review',source:{documentId:id,page:doc.pages[0].pageNumber,quote:doc.pages[0].text}});await updateCase(next=>{next.documents.find(d=>d.id===id).records=records;});clearDraft(id);render();showDocument(id);toast('Record added. Leave undocumented fields blank.');},
  'remove-record':async el=>{const id=el.dataset.doc,doc=caseData.documents.find(d=>d.id===id);const record=doc.records[Number(el.dataset.index)];await updateCase(next=>moveRecordToTrash(next,id,record.id));const trashed=caseData.trashRecords.at(-1);const editor=document.querySelector('.modal[data-editor-doc]');if(editor)delete editor.dataset.editorDoc;render();showDocument(id);toast('Record moved to Trash.',false,{action:'restore-record',id:trashed.id});},
  'restore-record':async el=>{await updateCase(next=>restoreRecord(next,el.dataset.id));render();showTrash();toast('Record restored. Findings recalculated.');},
  'discard-transcript':el=>{clearTranscript(el.dataset.doc,el.dataset.page);showDocument(el.dataset.doc);toast('Unsaved transcript draft discarded.');},
  'save-transcript':async el=>{const id=el.dataset.doc,pageNumber=Number(el.dataset.page),text=$('#transcript-text').value;if(text.length>80000)throw new Error('Keep each transcript below 80,000 characters.');await updateCase(next=>{const doc=next.documents.find(d=>d.id===id),page=doc.pages.find(p=>p.pageNumber===pageNumber);page.originalText??=page.text;page.text=text;page.manuallyTranscribed=true;doc.needsOCR=doc.pages.every(p=>!p.text.trim());if(!doc.records.length)doc.records=extractRecords(doc.pages,id).map(r=>({...r,id:crypto.randomUUID(),extractionMethod:'manual-transcript'}));else doc.records=doc.records.map(r=>r.source?.page===pageNumber?{...r,confidence:'needs-review'}:r);});clearTranscript(id,pageNumber);const draft=documentDrafts.get(id);if(draft)for(const value of Object.values(draft))value.reviewed=false;render();showDocument(id);toast('Transcript saved. Recheck fields and excerpts against the original.');},
  original:el=>{const doc=caseData.documents.find(d=>d.id===el.dataset.doc);if(!doc?.blob)throw new Error('Original file is not available. Case-data exports do not include originals.');const url=URL.createObjectURL(doc.blob);window.open(url+'#page='+(el.dataset.page||1),'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),120000);},
  'copy-question':async el=>{const f=analysis.findings.find(f=>f.id===el.dataset.id);try{await navigator.clipboard.writeText(f.question);toast('Clarification question copied.');}catch{openModal(`${modalTop('COPY QUESTION')}<h2 id="modal-title">Copy this question.</h2><div class="field"><textarea rows="6" readonly>${esc(f.question)}</textarea></div><button class="btn btn-ghost" data-action="close">Done</button>`);}},
  'review-finding':async el=>{const f=analysis.findings.find(f=>f.id===el.dataset.id),key=findingKey(f);await updateCase(next=>{const keys=next.reviewedFindings||[];next.reviewedFindings=keys.includes(key)?keys.filter(k=>k!==key):[...keys,key];});render();showFinding(f.id);},
  'save-notes':async()=>{notesDraft={caseId:caseData.id,value:$('#case-notes').value};await flushNotes();toast('Case notes saved.');},
  'export-json':exportJSON,
  'export-packet':async()=>{await flushNotes();download('metertrace-evidence-packet.html',packetHTML(),'text/html');toast('Evidence packet downloaded. Field drafts and Trash are excluded.');},
  restore:()=>{const input=$('#restore-file');input.value='';input.click();},
  'remove-doc-confirm':el=>{const doc=caseData.documents.find(d=>d.id===el.dataset.doc);openModal(`${modalTop('REMOVE EVIDENCE')}<h2 id="modal-title">Move this document to Trash?</h2><p>${esc(doc.name)} and its records will be excluded from findings and exports. You can restore the document from Trash.</p><div class="modal-actions"><button class="btn btn-ghost" data-action="document" data-doc="${esc(doc.id)}">Keep document</button><button class="btn btn-danger" data-action="remove-doc" data-doc="${esc(doc.id)}">Move to Trash</button></div>`);},
  'remove-doc':async el=>{const id=el.dataset.doc;await updateCase(next=>moveDocumentToTrash(next,id));clearDraft(id);closeModal();render();toast('Document moved to Trash.',false,{action:'restore-doc',doc:id});},
  'restore-doc':async el=>{await updateCase(next=>restoreDocument(next,el.dataset.doc));render();showTrash();toast('Document restored. Findings recalculated.');},
  'empty-trash-confirm':()=>openModal(`${modalTop('PERMANENT REMOVAL')}<h2 id="modal-title">Permanently empty Trash?</h2><p>All removed documents, original file bytes, and removed records in this workspace’s Trash will be permanently deleted. Active evidence stays in the case. Separate downloaded exports and the previous-case recovery copy are unaffected.</p><div class="modal-actions"><button class="btn btn-ghost" data-action="trash">Keep Trash</button><button class="btn btn-danger" data-action="empty-trash">Permanently empty Trash</button></div>`),
  'empty-trash':async()=>{await updateCase(next=>{next.trashDocuments=[];next.trashRecords=[];});for(const id of [...documentDrafts.keys()])if(!caseData.documents.some(d=>d.id===id))documentDrafts.delete(id);render();showTrash();toast('Trash permanently emptied for this workspace.');},
  'recover-previous':async()=>{const previous=await readPreviousCase();if(!previous)throw new Error('No previous resident case is saved in this browser.');openModal(`${modalTop('PREVIOUS CASE RECOVERY')}<h2 id="modal-title">Recover ${esc(previous.name)}?</h2><p>This restores ${previous.documents.length} active documents, original files if retained, and its saved notes. The current resident case becomes the previous recovery copy.</p><div class="modal-actions"><button class="btn btn-ghost" data-action="close">Keep current case</button><button class="btn btn-primary" id="recover-case-confirm">Recover case</button></div>`);$('#recover-case-confirm').addEventListener('click',async()=>{try{await flushNotes();await updateCase(()=>previous);documentDrafts.clear();transcriptDrafts.clear();notesDraft=null;closeModal();go('documents');toast('Previous case recovered.');}catch(e){toast(e.message,true);}});},
  'delete-case':()=>openModal(`${modalTop('PERMANENT LOCAL DATA REMOVAL')}<h2 id="modal-title">Clear all saved local case data?</h2><p>This permanently clears the active case, Trash, original files, notes, and the previous-case recovery copy in this browser. Downloads and other browsers are unaffected. Export active case data and retain originals first.</p><div class="modal-actions"><button class="btn btn-ghost" data-action="close">Keep my data</button><button class="btn btn-danger" data-action="delete-confirm">Permanently clear local data</button></div>`),
  'delete-confirm':async()=>{cancelOperation();await deleteCase();recoveryBlocked=false;documentDrafts.clear();transcriptDrafts.clear();notesDraft=null;await updateCase(()=>emptyCase());closeModal();go('documents');toast('Saved local case data and recovery copies cleared.');},
  'export-recovery':async()=>{const raw=await readRawSavedCase();const seen=new WeakSet();const json=JSON.stringify(raw,(key,value)=>{if(value instanceof Blob)return {originalFileOmitted:true,type:value.type,size:value.size};if(value&&typeof value==='object'){if(seen.has(value))return '[Circular reference]';seen.add(value);}return value;},2);download('metertrace-local-recovery.json',json,'application/json');toast('Raw recovery data exported. It may require manual repair.');},
  'run-ai':async el=>{if(staticDeployment)throw new Error('AI extraction is unavailable on this local-processing deployment. Review the document locally.');if(!$('#ai-consent')?.checked)throw new Error('Select the consent checkbox to send page text.');const token=$('#ai-token')?.value;const id=el.dataset.doc,doc=caseData.documents.find(d=>d.id===id);if(doc.pages.every(p=>!p.text.trim()))throw new Error('Add a transcript first. This feature extracts text only.');const expected=JSON.stringify(doc.records);cancelOperation();const operation=createImportOperation(caseData.id);activeOperation=operation;openModal(`${modalTop('AI EXTRACTION')}<h2 id="modal-title">Organizing the page text.</h2><p>Suggestions will need review. Cancel to keep the saved records unchanged.</p><div class="progress-bar"><span></span></div><button class="btn btn-ghost" data-action="close">Cancel extraction</button>`);try{const response=await fetch('/api/extract',{method:'POST',headers:{'content-type':'application/json',...(token?{'x-metertrace-token':token}:{})},signal:operation.signal,body:JSON.stringify({documentId:id,pages:doc.pages.map(p=>({pageNumber:p.pageNumber,text:p.text}))})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Extraction failed.');operation.assertCurrent(caseData.id);await updateCase(next=>{operation.assertCurrent(next.id);const target=next.documents.find(d=>d.id===id);if(!target||JSON.stringify(target.records)!==expected)throw new Error('The document changed while extraction ran. Saved records were kept.');target.records=result.records.map(r=>({...r,id:crypto.randomUUID()}));target.extractionMethod='ai';},{signal:operation.signal,expectedCaseId:operation.caseId});if(activeOperation===operation)activeOperation=null;clearDraft(id);render();showDocument(id);toast(`${result.records.length} AI suggestions ready for review.`);}catch(e){if(activeOperation===operation)activeOperation=null;if(e.name!=='AbortError'){showDocument(id);throw e;}}}
});

async function clicked(event) {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  event.preventDefault();
  const fn = actions[el.dataset.action];
  if (!fn) return;
  try {
    captureDraft();
    
    await fn(el);
  } catch (e) {
    toast(e.message || "This action could not be completed.", true);
  }
}
$("#app").addEventListener("click", clicked);
$("#toast").addEventListener("click",clicked);
$("#overlay").addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-backdrop")) {
    closeModal();
    return;
  }
  clicked(event);
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    showSearch();
  }
  if (event.key === "Escape") {
    if ($("#overlay").children.length) closeModal();
    else if (mobileOpen) {
      mobileOpen = false;
      render();
    }
  }
  if (event.key === "Tab" && $("#overlay").children.length) {
    const els = [...$("#overlay").querySelectorAll("button:not(:disabled),input:not([type=hidden]),select,textarea,a[href]")].filter((e) => e.offsetParent !== null);
    const first = els[0], last = els.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
document.addEventListener('change',async event=>{try{const el=event.target;if(el.id==='file-input')await importFiles(el.files);if(el.id==='source-page-select')showSource(el.dataset.sourceDoc,el.value);if(el.id==='transcript-page')showTranscribe(el.dataset.doc,el.value);if(el.id==='restore-file')await restoreCase(el.files[0]);if(el.dataset.question){const finding=analysis.findings.find(f=>f.id===el.dataset.question);const key=findingKey(finding),checked=el.checked;await flushNotes();await updateCase(next=>{const excluded=next.excludedQuestions||[];next.excludedQuestions=checked?excluded.filter(k=>k!==key):[...excluded,key];});render();}}catch(e){toast(e.message,true);}});
document.addEventListener('input',event=>{const el=event.target;if(el.id==='global-search')searchAll(el.value);if(el.id==='case-notes'){notesDraft={caseId:caseData.id,value:el.value};clearTimeout(notesTimer);notesTimer=setTimeout(()=>flushNotes().catch(e=>toast(e.message,true)),700);}if(el.closest('.modal[data-editor-doc]')||el.id==='transcript-text')captureDraft();if(el.dataset.search==='documents'){query=el.value;const start=el.selectionStart;render();const input=$('[data-search="documents"]');input?.focus();input?.setSelectionRange(start,start);}});
for(const name of ['dragover','dragleave','drop'])document.addEventListener(name,event=>{if(event.dataTransfer?.types?.includes('Files'))event.preventDefault();const zone=event.target.closest('[data-dropzone]');if(!zone){if(name==='drop'&&event.dataTransfer?.files?.length)toast('Use Add documents or the upload area to import files. Nothing was added.',true);return;}event.preventDefault();if(name==='dragover')zone.classList.add('dragover');else zone.classList.remove('dragover');if(name==='drop')importFiles(event.dataTransfer.files).catch(e=>toast(e.message,true));});
window.addEventListener('beforeunload',event=>{captureDraft();if(documentDrafts.size||transcriptDrafts.size||notesDraft||activeOperation){event.preventDefault();event.returnValue='';}});

window.matchMedia("(max-width:720px)").addEventListener("change", () => {
  if (caseData) render();
});
window.addEventListener("hashchange", () => {
  const tab = location.hash.slice(1);
  if ([...tabs.map((t) => t[0]), "method"].includes(tab)) {
    active = tab;
    filter = "all";
    render();
  }
});
$("#app").innerHTML = '<div class="inline-loading">METERTRACE / OPENING YOUR WORKSPACE\u2026</div>';
let startupError = null;
try { caseData = await loadCase() || newDemo(); }
catch(error) { storageOK=false;recoveryBlocked=true;caseData=emptyCase('Recovery workspace');startupError=error; }

active = [...tabs.map((t) => t[0]), "method"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
render();
if(startupError)openModal(`${modalTop('LOCAL RECOVERY REQUIRED')}<h2 id="modal-title">Your saved case needs attention.</h2><p>${esc(startupError.message)} The existing saved data has been preserved. Export a recovery copy before explicitly clearing it.</p><div class="modal-actions"><button class="btn btn-ghost" data-action="export-recovery">Export recovery data</button><button class="btn btn-danger" data-action="delete-case">Clear saved data…</button></div>`);
if (!staticDeployment) fetch("/api/health").then((r) => r.json()).then((data) => {
  health = data;
  if (active === "method") render();
}).catch(() => {
});
