/** MeterTrace: deterministic, evidence-linked reconciliation. No legal or billing conclusions. */
// Keep integer-cent arithmetic within JavaScript's exact range. Invalid values
// are never coerced to zero or allowed to influence a financial finding.
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100;
const cents = value => Math.round((value + Number.EPSILON) * 100);
const safeCents = value => numeric(value) && Number.isSafeInteger(cents(value));
const validMoney = value => safeCents(value) && Math.abs(value * 100 - cents(value)) < 0.000001;
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const rateMoney = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 20 }).format(value);
const day = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const stamp = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null;
};
const unique = items => [...new Set(items)];
const reference = value => typeof value === 'string' ? value.trim() : null;
const account = record => {
  if (typeof record.accountId !== 'string') return null;
  const value = record.accountId.replace(/[\s-]/g, '');
  return /^\d{5,32}$/.test(value) ? `id:${value}` : null;
};
const sameAccount = (a, b) => account(a) !== null && account(a) === account(b);
const BILL_UNITS = new Set(['gallons', 'CCF']);

function verifiedSource(source, documents, documentId) {
  if (!source || source.documentId !== documentId || !Number.isInteger(source.page) || source.page < 1) return null;
  const document = documents.find(item => item.id === source.documentId);
  const page = Array.isArray(document?.pages) ? document.pages.find(item => item && (item.pageNumber ?? item.page) === source.page) : null;
  if (!page || typeof source.quote !== 'string' || !source.quote.trim()) return null;
  // A citation cannot claim a quotation absent from the source page.
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  if (typeof page.text !== 'string' || !normalize(page.text).includes(normalize(source.quote))) return null;
  return { documentId: source.documentId, page: source.page, quote: source.quote };
}

export function deriveCase(documents = []) {
  const docs = Array.isArray(documents) ? documents.filter(document => document && typeof document.id === 'string') : [];
  const findings = [];
  const records = docs.flatMap(document => (Array.isArray(document.records) ? document.records : []).filter(record => record && typeof record === 'object' && ['bill', 'credit', 'service'].includes(record.kind)).map((record, index) => ({ ...record, id: record.id || `${document.id}-record-${index + 1}`, documentId: document.id })));
  // Key by record object, not untrusted record IDs that may collide.
  const sourceMap = new Map(records.map(record => [record, verifiedSource(record.source, docs, record.documentId)]));
  const add = ({ severity = 'medium', category, title, detail, records: involved = [], calculation = null, question }) => {
    const sources = involved.map(record => sourceMap.get(record)).filter(Boolean).filter((source, index, all) => all.findIndex(other => other.documentId === source.documentId && other.page === source.page && other.quote === source.quote) === index);
    findings.push({ id: `finding-${findings.length + 1}`, severity, category, title, detail, sources, calculation, question, status: 'open', requiresReview: involved.some(record => record.confidence !== 'reviewed') });
  };
  const verified = records.filter(record => sourceMap.get(record));
  const numberFields = ['previousReading', 'currentReading', 'usage', 'readingMultiplier', 'rate', 'waterCharge', 'total', 'creditApplied', 'amount', 'oldClosingReading', 'newOpeningReading'];
  const stringFields = ['accountId', 'accountLast4', 'meterId', 'newMeterId', 'reference', 'creditReference', 'orderId', 'action', 'status', 'billId'];
  const invalid = verified.filter(record => numberFields.some(key => record[key] != null && !numeric(record[key])) || record.readingMultiplier != null && record.readingMultiplier <= 0 || ['waterCharge', 'total', 'creditApplied', 'amount'].some(key => record[key] != null && !validMoney(record[key])) || stringFields.some(key => record[key] != null && typeof record[key] !== 'string') || ['date', 'periodStart', 'periodEnd'].some(key => record[key] != null && day(record[key]) === null) || record.periodStart && record.periodEnd && day(record.periodEnd) < day(record.periodStart));
  const sourced = verified.filter(record => !invalid.includes(record));
  if (invalid.length) add({ severity: 'info', category: 'documents', title: 'Invalid field values need review', detail: `${invalid.length} record${invalid.length === 1 ? '' : 's'} contain negative, unsafe, nonnumeric, fractional-cent monetary, invalid date values, or a nonpositive meter multiplier. They were excluded from reconciliation rather than interpreted as a charge, credit, or date.`, records: invalid, question: 'Can you verify the sign, amount, reading values, documented multiplier, and dates against the original page? Credit reversals and corrected statements need separate ledger documentation.' });
  const billCandidates = sourced.filter(record => record.kind === 'bill');
  const billKeys = new Set();
  const repeatedBills = [];
  const uniqueBills = billCandidates.filter(record => {
    if (!account(record) || !record.periodStart || !record.periodEnd || !record.date) return true;
    const key = JSON.stringify([account(record), record.periodStart, record.periodEnd, record.date, record.billId, record.meterId, record.previousReading, record.currentReading, record.readingUnit, record.readingMultiplier, record.usage, record.unit, record.rate, record.rateUnit, record.readType, record.waterCharge, record.total, record.creditApplied, record.creditReference]);
    if (billKeys.has(key)) { repeatedBills.push(record); return false; }
    billKeys.add(key); return true;
  });
  if (repeatedBills.length) add({ severity: 'info', category: 'documents', title: 'Repeated billing records excluded', detail: `${repeatedBills.length} bill record${repeatedBills.length === 1 ? '' : 's'} repeat the same account, billing dates, usage, charges, and credit details. These repeats were counted once.`, records: repeatedBills, question: 'Are these copies of the same statement, or do distinct bill identifiers establish separate transactions?' });
  const conflictingBills = new Set();
  const periodGroups = new Map();
  for (const bill of uniqueBills) {
    if (!account(bill) || day(bill.periodStart) === null || day(bill.periodEnd) === null) continue;
    const key = JSON.stringify([account(bill), bill.periodStart, bill.periodEnd]);
    const group = periodGroups.get(key) || []; group.push(bill); periodGroups.set(key, group);
  }
  for (const group of periodGroups.values()) if (group.length > 1) {
    group.forEach(bill => conflictingBills.add(bill));
    add({ severity: 'high', category: 'documents', title: 'Billing records disagree for the same period', detail: `Multiple statement records cover ${group[0].periodStart} through ${group[0].periodEnd}. They may be copies, revisions, rebills, or distinct transactions. No version was selected and these records were excluded from arithmetic until their relationship is documented.`, records: group, question: 'Which statement is final for this period? Please provide bill identifiers, any reversal or rebill entries, and the account ledger showing which charges and credits remain posted.' });
  }
  const bills = uniqueBills.filter(bill => !conflictingBills.has(bill));
  const credits = sourced.filter(record => record.kind === 'credit');
  const services = sourced.filter(record => record.kind === 'service');
  const weakIdentity = sourced.filter(record => !account(record) && (record.accountLast4 || record.accountId));
  if (weakIdentity.length) add({ severity: 'info', category: 'account', title: 'Confirm the complete account identity', detail: 'Some records contain only a masked or partial account identifier. These identifiers were not used to match financial records because different accounts can share the same final digits.', records: weakIdentity, question: 'Can you verify the complete numeric account number and service address on every source before linking these records?' });
  const missing = records.filter(record => !sourceMap.get(record));
  if (missing.length) add({ severity: 'info', category: 'documents', title: 'Source pages need attention', detail: `${missing.length} record${missing.length === 1 ? '' : 's'} lack a verifiable source page and exact excerpt. They were excluded from reconciliation.`, question: 'Can you attach the original page and select the exact supporting text?' });
  const accounts = unique(sourced.map(account).filter(Boolean));
  if (accounts.length > 1) add({ severity: 'info', category: 'account', title: 'Multiple accounts detected', detail: `Records contain ${accounts.length} account identifiers. Cross-document checks stay within each explicitly identified account.`, records: sourced.filter(record => account(record)), question: 'Do these documents all belong in this case, or should the accounts be separated?' });
  const unknownAccounts = sourced.filter(record => !account(record) && !record.accountId && !record.accountLast4);
  if (unknownAccounts.length) add({ severity: 'info', category: 'account', title: 'Account identifiers are missing', detail: `${unknownAccounts.length} record${unknownAccounts.length === 1 ? '' : 's'} cannot be linked to other documents until an account identifier is confirmed.`, records: unknownAccounts, question: 'Which account do the highlighted records belong to?' });
  for (const bill of bills) {
    const context = `${bill.periodStart || 'Unknown start'} to ${bill.periodEnd || 'unknown end'}`;
    const replacementDuringPeriod = services.some(service => sameAccount(service, bill) && service.newMeterId && (!bill.meterId || service.meterId === bill.meterId || service.newMeterId === bill.meterId) && day(service.date) !== null && day(bill.periodStart) !== null && day(bill.periodEnd) !== null && day(service.date) >= day(bill.periodStart) && day(service.date) <= day(bill.periodEnd));
    if (!replacementDuringPeriod && numeric(bill.previousReading) && numeric(bill.currentReading) && numeric(bill.usage) && BILL_UNITS.has(bill.unit) && bill.readingUnit === bill.unit) {
      const multiplier = bill.readingMultiplier ?? 1;
      const expected = (bill.currentReading - bill.previousReading) * multiplier;
      const formula = bill.readingMultiplier != null ? `(${bill.currentReading} − ${bill.previousReading}) × ${multiplier} = ${expected} ${bill.unit}` : `${bill.currentReading} − ${bill.previousReading} = ${expected} ${bill.unit}`;
      if (!Number.isFinite(expected) || Math.abs(expected) > Number.MAX_SAFE_INTEGER) add({ severity: 'info', category: 'calculation', title: 'Reading calculation exceeds supported precision', detail: `${context}: the reading difference and documented multiplier exceed supported numeric precision. No usage difference was calculated.`, records: [bill], question: 'Can you verify the readings, documented multiplier, and decimal placement on the original statement?' });
      else if (expected < 0) add({ category: 'meter', title: 'Reading decreases within a bill', detail: `${context}: the closing reading is below the opening reading. A meter change, rollover, or transcription issue needs documentation.`, records: [bill], calculation: formula, question: 'Can the City provide the meter serials, rollover details, and reading history for this period?' });
      else if (Math.abs(expected - bill.usage) > 0.01) add({ severity: 'high', category: 'calculation', title: 'Usage does not match meter readings', detail: `${context}: the recorded usage differs from the reading difference${bill.readingMultiplier != null ? ' multiplied by the explicitly documented meter multiplier' : ''}. Confirm both readings use the same unit and meter before disputing the charge.`, records: [bill], calculation: `${formula}; bill shows ${bill.usage} ${bill.unit}`, question: 'What adjustment, multiplier, or meter event explains the difference between the readings and billed usage?' });
    }
    if (numeric(bill.usage) && numeric(bill.rate) && numeric(bill.waterCharge) && BILL_UNITS.has(bill.unit) && bill.rateUnit === bill.unit) {
      if (!safeCents(bill.usage * bill.rate)) {
        add({ severity: 'info', category: 'calculation', title: 'Charge calculation exceeds supported precision', detail: `${context}: the usage and rate produce an amount outside exact integer-cent arithmetic. No difference was calculated.`, records: [bill], question: 'Can you verify the usage, rate denominator, and decimal placement on the original statement?' });
        continue;
      }
      const expected = cents(bill.usage * bill.rate);
      const billed = cents(bill.waterCharge);
      if (expected !== billed) add({ severity: 'high', category: 'calculation', title: 'Water charge needs an explanation', detail: `${context}: the stated water-only charge differs from usage multiplied by the stated per-${bill.unit} rate, rounded once to the nearest cent. Taxes, sewer charges, and other bill items are excluded. A rounding rule may explain a small difference.`, records: [bill], calculation: `${bill.usage} ${bill.unit} × ${rateMoney(bill.rate)}/${bill.unit} = ${money(expected / 100)}; water charge ${money(bill.waterCharge)}; difference ${money((billed - expected) / 100)}`, question: 'Which rate, billing adjustment, or rounding rule accounts for this water-charge difference?' });
    }
    if (!['actual', 'estimated'].includes(bill.readType)) add({ severity: 'info', category: 'readings', title: 'Reading type is not documented', detail: `${context}: this record does not establish whether the reading was actual or estimated.`, records: [bill], question: 'Was this bill based on an actual meter reading or an estimate? Please provide the reading date and value.' });
  }
  for (const service of services.filter(record => record.newMeterId)) {
    if (!numeric(service.oldClosingReading) || !numeric(service.newOpeningReading)) add({ category: 'meter', title: 'Meter replacement readings are missing', detail: `Order ${service.orderId || '(number missing)'} records a change from ${service.meterId || 'an unidentified meter'} to ${service.newMeterId}, but both boundary readings are not available. Readings across this replacement were not subtracted.`, records: [service], question: 'Can the City provide the removed-meter closing reading, new-meter opening reading, units, and installation timestamp?' });
  }
  const overlappingBills = new Set();
  for (const id of accounts) {
    const accountBills = bills.filter(record => account(record) === id).sort((a, b) => (day(a.periodStart) ?? Infinity) - (day(b.periodStart) ?? Infinity));
    let estimated = [];
    const flush = () => {
      if (estimated.length >= 2) add({ category: 'estimates', title: `${estimated.length} consecutive estimated periods`, detail: `The available records show estimated bills from ${estimated[0].periodStart || 'an unknown start'} through ${estimated.at(-1).periodEnd || 'an unknown end'}. This is a review prompt, not proof that an estimate is wrong.`, records: [...estimated], question: 'What historical readings, usage window, and formula were used for each estimate, and were they reconciled after an actual reading?' });
      estimated = [];
    };
    for (const bill of accountBills) {
      if (bill.readType === 'estimated' && day(bill.periodStart) !== null && day(bill.periodEnd) !== null) {
        const previous = estimated.at(-1);
        if (previous) {
          const boundary = day(bill.periodStart) !== null && day(previous.periodEnd) !== null ? day(bill.periodStart) - day(previous.periodEnd) : null;
          if (boundary === null || boundary < 0 || boundary > 86400000) flush();
        }
        estimated.push(bill);
      } else flush();
    }
    flush();
    let covering = null;
    for (const current of accountBills) {
      if (day(current.periodStart) === null || day(current.periodEnd) === null) continue;
      if (covering && day(current.periodStart) < day(covering.periodEnd)) {
        overlappingBills.add(covering); overlappingBills.add(current);
        add({ category: 'documents', title: 'Billing periods overlap', detail: `The periods ${covering.periodStart}–${covering.periodEnd} and ${current.periodStart}–${current.periodEnd} overlap beyond a shared endpoint. A rebill, correction, or different meter may explain the overlap; their usage was not combined into a case total.`, records: [covering, current], question: 'Do these statements replace one another, cover different meters, or bill overlapping service? Please provide the final bill and reversal history for the overlapping dates.' });
      }
      if (!covering || day(current.periodEnd) > day(covering.periodEnd)) covering = current;
    }
    for (let i = 1; i < accountBills.length; i++) {
      const before = accountBills[i - 1], after = accountBills[i];
      const end = day(before.periodEnd), start = day(after.periodStart);
      if (end !== null && start !== null && start - end > 86400000) add({ severity: 'info', category: 'documents', title: 'A billing period may be missing', detail: `The available bills leave a gap between ${before.periodEnd} and ${after.periodStart}. A missing document does not establish a missing charge.`, records: [before, after], question: `Can you provide all bills and reading records covering ${before.periodEnd} through ${after.periodStart}?` });
      if (before.meterId && after.meterId && before.meterId !== after.meterId) {
        const matching = services.filter(service => sameAccount(service, before) && service.meterId === before.meterId && service.newMeterId === after.meterId && day(service.date) !== null && day(before.periodStart) !== null && day(after.periodEnd) !== null && day(service.date) >= day(before.periodStart) && day(service.date) <= day(after.periodEnd));
        if (!matching.length) add({ category: 'meter', title: 'Meter change lacks a service record', detail: `The meter identifier changes from ${before.meterId} to ${after.meterId}, but no matching replacement record is available.`, records: [before, after], question: 'Can you provide the replacement service order, installation date, removed-meter closing reading, and new-meter opening reading?' });
      }
    }
  }
  let creditPromisedCents = 0, creditPostedCents = 0, unresolvedCents = 0, creditNeedsReviewCount = 0;
  const promiseGroups = new Map();
  for (const credit of credits.filter(record => !['promised', 'posted'].includes(record.status))) {
    creditNeedsReviewCount++;
    add({ severity: 'info', category: 'credits', title: 'Credit status is not documented', detail: 'A credit amount is recorded, but its approval or posting status is not established. It was not counted as an approved promise or a bill posting.', records: [credit], question: 'Was this adjustment approved, pending, denied, or actually posted? Please provide the final notice and ledger entry.' });
  }
  for (const credit of credits.filter(record => record.status === 'promised' && numeric(record.amount) && record.amount > 0)) {
    if (!account(credit) || !credit.reference?.trim()) {
      creditNeedsReviewCount++;
      add({ category: 'credits', title: 'Credit cannot be matched to a bill', detail: `A notice mentions ${money(credit.amount)}, but the account or adjustment reference is missing. No posting amount has been assumed.`, records: [credit], question: 'Can the City identify the account, adjustment reference, posting date, and bill receiving this credit?' });
      continue;
    }
    const key = `${account(credit)}:${reference(credit.reference)}`;
    const group = promiseGroups.get(key) || [];
    group.push(credit); promiseGroups.set(key, group);
  }
  for (const group of promiseGroups.values()) {
    const credit = group[0];
    const amounts = unique(group.map(record => cents(record.amount)));
    if (amounts.length > 1) {
      creditNeedsReviewCount++;
      add({ severity: 'high', category: 'credits', title: 'Credit notices contradict one another', detail: `Notices for ${credit.reference} state different amounts: ${amounts.map(amount => money(amount / 100)).join(' and ')}. A final approved amount is needed before reconciliation.`, records: group, question: `What is the final approved amount for ${credit.reference}, and which notice supersedes the others?` });
      continue;
    }
    const matches = bills.filter(bill => sameAccount(bill, credit) && reference(bill.creditReference) === reference(credit.reference) && numeric(bill.creditApplied));
    const conflicts = [...conflictingBills, ...invalid.filter(record => record.kind === 'bill')].filter(bill => sameAccount(bill, credit) && reference(bill.creditReference) === reference(credit.reference));
    const earlierOrUndated = matches.filter(bill => day(bill.date) === null || group.some(notice => day(notice.date) === null) || day(bill.date) < Math.min(...group.map(notice => day(notice.date))));
    // A repeated adjustment on later statements may be a carried-forward line.
    // Without transaction-level ledger IDs it cannot be summed safely.
    if (matches.length > 1 || conflicts.length || earlierOrUndated.length || group.some(notice => day(notice.date) === null)) {
      creditNeedsReviewCount++;
      add({ severity: 'high', category: 'credits', title: 'Credit posting history needs a ledger', detail: `${credit.reference}: ${matches.length > 1 ? 'more than one statement shows this reference, and separate postings cannot be distinguished from carried-forward amounts.' : conflicts.length ? 'a conflicting or invalid statement may contain this credit.' : 'a matching statement predates the notice or a posting/notice date is missing.'} This adjustment was excluded from numeric credit totals rather than assuming which postings count.`, records: [...group, ...matches, ...conflicts], question: `For ${credit.reference}, please provide each unique posting or reversal transaction, its date and amount, and the final statement. Which appearances are new postings and which are carried-forward information?` });
      continue;
    }
    const promised = amounts[0];
    const posted = matches.reduce((sum, bill) => sum + cents(bill.creditApplied), 0);
    if (![creditPromisedCents + promised, creditPostedCents + posted, unresolvedCents + Math.max(promised - posted, 0)].every(Number.isSafeInteger)) {
      creditNeedsReviewCount++;
      add({ severity: 'info', category: 'credits', title: 'Credit totals exceed supported precision', detail: `${credit.reference}: this adjustment would exceed exact integer-cent arithmetic in the case total. It was excluded rather than rounded or overflowed.`, records: [...group, ...matches], question: 'Can you verify the amount and decimal placement, or review this adjustment in a separate case?' });
      continue;
    }
    creditPromisedCents += promised; creditPostedCents += posted;
    const difference = promised - posted;
    if (difference > 0) {
      unresolvedCents += difference;
      add({ severity: 'high', category: 'credits', title: matches.length ? `${money(difference / 100)} in credit remains untraced` : 'Promised credit is not shown in the available bills', detail: `${credit.reference}: correspondence states ${money(promised / 100)}. ${matches.length ? `Bills explicitly linked to this reference show ${money(posted / 100)} applied.` : 'No available bill has an explicitly matching adjustment reference.'} The document set may be incomplete; this is not an amount legally owed.`, records: [...group, ...matches], calculation: `${money(promised / 100)} promised − ${money(posted / 100)} shown = ${money(difference / 100)} untraced`, question: `For adjustment ${credit.reference}, on which bill was the remaining ${money(difference / 100)} applied? Please provide its posting date, calculation, and ledger entry.` });
    } else if (difference < 0) add({ category: 'credits', title: 'Posted credit exceeds the notice amount', detail: `${credit.reference}: matching bills show more credit than the referenced notice. Confirm whether another adjustment is included.`, records: [...group, ...matches], calculation: `${money(posted / 100)} shown − ${money(promised / 100)} promised = ${money(-difference / 100)}`, question: 'Does the posted amount include a separate adjustment, reversal, or duplicate credit?' });
  }
  // Group nearby notices instead of producing O(n²) pairwise findings.
  const serviceGroups = new Map();
  for (const service of services) {
    if (!account(service) || !service.meterId || !service.action || !service.orderId || day(service.date) === null) continue;
    const key = JSON.stringify([account(service), service.meterId, service.action.trim().toLowerCase()]);
    const group = serviceGroups.get(key) || []; group.push(service); serviceGroups.set(key, group);
  }
  for (const group of serviceGroups.values()) {
    group.sort((a, b) => day(a.date) - day(b.date));
    let cluster = [];
    const flush = () => {
      const orderIds = unique(cluster.map(record => record.orderId));
      if (orderIds.length > 1) add({ category: 'service', title: 'Service orders may overlap', detail: `${orderIds.join(', ')} describe the same action for meter ${cluster[0].meterId}. Successive notices occur within seven days of one another. These may be related visits rather than duplicates; completion notes are needed.`, records: [...cluster], question: `Were ${orderIds.join(', ')} separate visits, replacement orders, or duplicates? Please supply completion notes and any resulting billing adjustments.` });
      cluster = [];
    };
    for (const service of group) {
      if (cluster.length && day(service.date) - day(cluster.at(-1).date) > 7 * 86400000) flush();
      cluster.push(service);
    }
    flush();
  }
  const periods = bills.map(bill => ({ id: bill.id, documentId: bill.documentId, periodStart: bill.periodStart || null, periodEnd: bill.periodEnd || null, date: bill.date || bill.periodEnd || null, readType: bill.readType || 'unknown', usage: numeric(bill.usage) ? bill.usage : null, unit: bill.unit || null, total: numeric(bill.total) ? bill.total : null, waterCharge: numeric(bill.waterCharge) ? bill.waterCharge : null, creditApplied: numeric(bill.creditApplied) ? bill.creditApplied : null, meterId: bill.meterId || null, accountLast4: bill.accountLast4 || null, source: sourceMap.get(bill), confidence: bill.confidence || 'needs-review' })).sort((a, b) => (day(a.periodStart) ?? Infinity) - (day(b.periodStart) ?? Infinity));
  const timeline = sourced.map(record => ({ id: record.id, kind: record.kind, date: record.date || record.periodEnd || null, title: record.kind === 'bill' ? `${record.readType || 'Unknown'} bill` : record.kind === 'service' ? `${record.action || 'Service'} · ${record.orderId || 'No order number'}` : `Credit ${record.reference || 'notice'}`, detail: record.kind === 'bill' ? `${record.periodStart || '?'} → ${record.periodEnd || '?'}` : record.kind === 'credit' ? `${numeric(record.amount) ? money(record.amount) : 'Amount unknown'} · ${record.status || 'status unknown'}` : record.status || 'Status unknown', source: sourceMap.get(record) })).sort((a, b) => (day(a.date) ?? Infinity) - (day(b.date) ?? Infinity));
  const units = unique(bills.filter(bill => numeric(bill.usage)).map(bill => bill.unit));
  const usageHasOneAccount = accounts.length === 1 && bills.every(bill => account(bill) === accounts[0]);
  const usageComplete = !conflictingBills.size && !overlappingBills.size && bills.every(bill => numeric(bill.usage));
  return { findings, periods, timeline, records, questions: findings.map(finding => ({ id: finding.id, text: finding.question, sources: finding.sources })), metrics: { documentCount: docs.length, recordCount: records.length, sourcedRecordCount: sourced.length, periodCount: bills.length, actualCount: bills.filter(bill => bill.readType === 'actual').length, estimatedCount: bills.filter(bill => bill.readType === 'estimated').length, findingCount: findings.length, highCount: findings.filter(finding => finding.severity === 'high').length, unreconciledCredit: unresolvedCents / 100, creditPromised: creditPromisedCents / 100, creditPosted: creditPostedCents / 100, creditNeedsReviewCount, invalidRecordCount: invalid.length, conflictingBillCount: conflictingBills.size, usageTotal: usageHasOneAccount && usageComplete && units.length === 1 && BILL_UNITS.has(units[0]) ? bills.reduce((sum, bill) => sum + bill.usage, 0) : null, usageUnit: usageHasOneAccount && units.length === 1 ? units[0] : null } };
}

function parseDate(value) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return day(trimmed) !== null ? trimmed : undefined;
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    const result = `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    const date = new Date(result + 'T12:00:00Z');
    return date.getUTCMonth() + 1 === +match[1] && date.getUTCDate() === +match[2] ? result : undefined;
  }
  return undefined;
}
const datePattern = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})';
function field(text, label) { return text.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:=]\\s*([^\\n]+)`, 'im'))?.[1]?.trim(); }
function amount(text, label) {
  const value = field(text, label);
  if (value === undefined) return undefined;
  // Reject partial and malformed tokens rather than turning '$1,2' into 12,
  // or reading '12oops' as 12. Known unit suffixes do not alter the quantity.
  const match = value.match(/^([-+]?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(?:CCF|gallons?|gal)(?:\s*)|\s*)$/i);
  if (!match) return undefined;
  const number = Number(match[1].replace(/[$,\s]/g, ''));
  return numeric(number) ? number : undefined;
}
function compact(object) { return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)); }

/** Conservative labeled-text parser. All output requires human field review. */
export function extractRecords(pages = [], documentId) {
  const records = [];
  for (const page of pages) {
    const text = typeof page.text === 'string' ? page.text : '';
    if (!text.trim()) continue;
    const repeatedLabel = /(?:^|\n)\s*(Account(?: number| ID)?|Billing period|Service period|Bill date|Notice date|Credit amount|Approved credit|Promised credit|Credit reference|Adjustment reference|Credit applied|Applied credit|Service order|Water charge|Usage|Consumption|Previous reading|Current reading|Reading multiplier|Meter multiplier)\s*[:=]/gim;
    const labels = [...text.matchAll(repeatedLabel)].map(match => match[1].toLowerCase());
    // More than one of these labels can mean multiple accounts, statements,
    // or orders on the same page. Do not silently select their first values.
    if (labels.some((label, index) => labels.indexOf(label) !== index)) continue;
    const multiplierText = field(text, 'Reading multiplier|Meter multiplier');
    const readingMultiplier = amount(text, 'Reading multiplier|Meter multiplier');
    if (multiplierText !== undefined && (!numeric(readingMultiplier) || readingMultiplier <= 0)) continue;
    const fullAccount = field(text, 'Account(?: number| ID)?');
    const base = compact({ accountId: fullAccount?.replace(/\s/g, '').match(/^\d{5,}$/)?.[0], accountLast4: (fullAccount || field(text, 'Account last 4'))?.match(/(\d{4})\s*$/)?.[1], meterId: field(text, 'Meter(?: ID| serial)?'), confidence: 'needs-review', extractionMethod: 'labeled-text', source: { documentId, page: page.pageNumber ?? page.page ?? 1, quote: text.trim().slice(0, 2400) } });
    const range = field(text, 'Billing period|Service period|Period')?.match(new RegExp(`${datePattern}\\s*(?:to|through|[–—])\\s*${datePattern}`, 'i'));
    const readLabel = field(text, 'Read(?:ing)? type')?.toLowerCase();
    const unitText = field(text, 'Unit|Usage unit')?.toLowerCase();
    const unit = unitText === 'ccf' ? 'CCF' : /^(gallons?|gal)$/.test(unitText || '') ? 'gallons' : undefined;
    const readingUnitText = field(text, 'Reading unit')?.toLowerCase();
    const readingUnit = readingUnitText === 'ccf' ? 'CCF' : /^(gallons?|gal)$/.test(readingUnitText || '') ? 'gallons' : undefined;
    if (range || /(?:^|\n)\s*(?:Water charge|Current charges|Total due)\s*:/i.test(text)) records.push(compact({ ...base, kind: 'bill', periodStart: parseDate(range?.[1]), periodEnd: parseDate(range?.[2]), date: parseDate(field(text, 'Bill date|Date')), readType: readLabel === 'actual' ? 'actual' : readLabel === 'estimated' ? 'estimated' : 'unknown', previousReading: amount(text, 'Previous reading|Opening reading'), currentReading: amount(text, 'Current reading|Closing reading'), usage: amount(text, 'Usage|Consumption'), unit, readingUnit, readingMultiplier, rate: amount(text, 'Rate(?: per (?:CCF|gallon))?'), rateUnit: /Rate per CCF\s*:/i.test(text) ? 'CCF' : /Rate per gallon\s*:/i.test(text) ? 'gallons' : undefined, waterCharge: amount(text, 'Water charge'), total: amount(text, 'Total due|Total|Current charges'), creditApplied: amount(text, 'Credit applied|Applied credit'), creditReference: field(text, 'Credit reference|Adjustment reference') }));
    const orderId = field(text, 'Service order|Order(?: ID| number)?');
    if (orderId) records.push(compact({ ...base, kind: 'service', date: parseDate(field(text, 'Service date|Date')), orderId, newMeterId: field(text, 'New meter(?: ID| serial)?'), action: field(text, 'Action|Service action'), status: field(text, 'Status'), oldClosingReading: amount(text, 'Old meter closing reading|Removed meter closing reading'), newOpeningReading: amount(text, 'New meter opening reading') }));
    const creditAmount = amount(text, 'Credit amount|Approved credit|Promised credit');
    if (numeric(creditAmount)) records.push(compact({ ...base, kind: 'credit', date: parseDate(field(text, 'Notice date|Date')), amount: creditAmount, reference: field(text, 'Credit reference|Adjustment reference|Reference'), status: /^(posted|applied)$/i.test(field(text, 'Credit status|Status') || '') ? 'posted' : /^(promised|approved)$/i.test(field(text, 'Credit status|Status') || '') ? 'promised' : undefined }));
  }
  return records;
}
