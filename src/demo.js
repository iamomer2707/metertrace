/** All names, identifiers, dates, and amounts in this sample are fictional. */
const account = { accountId: '00004821', accountLast4: '4821' };
function document(id, name, type, text, records) {
  return { id, name, type, mimeType: 'text/plain', isDemo: true, uploadedAt: '2026-07-01T12:00:00Z', pages: [{ pageNumber: 1, text }], records: records.map((record, index) => ({ ...account, ...record, id: `${id}-record-${index + 1}`, confidence: 'reviewed', source: { documentId: id, page: 1, quote: record.quote || text } })) };
}
export const demoCaseMeta = { id: 'demo-4821', title: 'The missing credit', name: 'The missing credit', address: '1842 N. Example Avenue, Chicago', accountLast4: '4821', accountId: '00004821', description: 'A fictional Chicago reconciliation case. Two estimated bills, a meter replacement, overlapping service orders, and a partially traced credit.', isDemo: true };

export const demoDocuments = [
  document('demo-bill-jan', '01_Jan–Feb_water_bill.txt', 'bill', `METERTRACE — FICTIONAL DEMONSTRATION DOCUMENT
This is fabricated sample data, not a City of Chicago bill.
Account number: 00004821
Bill date: 2026-03-05
Billing period: 2026-01-01 to 2026-02-28
Reading type: Estimated
Meter ID: M-0197
Previous reading: 1210
Current reading: 1230
Usage: 20
Unit: CCF
Rate per CCF: $4.56
Water charge: $91.20
Total due: $182.40`, [{ kind: 'bill', date: '2026-03-05', periodStart: '2026-01-01', periodEnd: '2026-02-28', readType: 'estimated', meterId: 'M-0197', previousReading: 1210, currentReading: 1230, usage: 20, unit: 'CCF', rate: 4.56, rateUnit: 'CCF', waterCharge: 91.2, total: 182.4 }]),
  document('demo-bill-mar', '02_Mar–Apr_water_bill.txt', 'bill', `METERTRACE — FICTIONAL DEMONSTRATION DOCUMENT
This is fabricated sample data, not a City of Chicago bill.
Account number: 00004821
Bill date: 2026-05-05
Billing period: 2026-03-01 to 2026-04-30
Reading type: Estimated
Meter ID: M-0197
Previous reading: 1230
Current reading: 1254
Usage: 24
Unit: CCF
Rate per CCF: $4.56
Water charge: $109.44
Total due: $218.88`, [{ kind: 'bill', date: '2026-05-05', periodStart: '2026-03-01', periodEnd: '2026-04-30', readType: 'estimated', meterId: 'M-0197', previousReading: 1230, currentReading: 1254, usage: 24, unit: 'CCF', rate: 4.56, rateUnit: 'CCF', waterCharge: 109.44, total: 218.88 }]),
  document('demo-service-1', '03_Meter_replacement_notice.txt', 'service', `METERTRACE — FICTIONAL DEMONSTRATION DOCUMENT
This is fabricated sample data, not a City of Chicago service notice.
Account number: 00004821
Service date: 2026-05-12
Service order: SO-2026-771
Action: Meter replacement
Meter ID: M-0197
New meter ID: M-4412
Status: Completed
Replacement installation recorded. Closing reading of removed meter and opening reading of new meter are not included in this notice.`, [{ kind: 'service', date: '2026-05-12', orderId: 'SO-2026-771', action: 'Meter replacement', meterId: 'M-0197', newMeterId: 'M-4412', status: 'Completed' }]),
  document('demo-service-2', '04_Service_order_followup.txt', 'service', `METERTRACE — FICTIONAL DEMONSTRATION DOCUMENT
This is fabricated sample data, not City of Chicago correspondence.
Account number: 00004821
Service date: 2026-05-14
Service order: SO-2026-772
Action: Meter replacement
Meter ID: M-0197
Status: Closed
This notice references replacement work for the same removed meter. Detailed completion notes and the relationship to SO-2026-771 are not supplied.`, [{ kind: 'service', date: '2026-05-14', orderId: 'SO-2026-772', action: 'Meter replacement', meterId: 'M-0197', status: 'Closed' }]),
  document('demo-credit', '05_Credit_approval_notice.txt', 'credit', `METERTRACE — FICTIONAL DEMONSTRATION DOCUMENT
This is fabricated sample data, not a City of Chicago credit approval.
Account number: 00004821
Notice date: 2026-05-20
Credit reference: CR-2026-041
Approved credit: $286.40
Credit status: Approved
Your billing review has resulted in an approved adjustment of $286.40. This adjustment is expected on your next statement. The calculation worksheet is not enclosed.`, [{ kind: 'credit', date: '2026-05-20', reference: 'CR-2026-041', amount: 286.4, status: 'promised' }]),
  document('demo-bill-may', '06_May–Jun_water_bill.txt', 'bill', `METERTRACE — FICTIONAL DEMONSTRATION DOCUMENT
This is fabricated sample data, not a City of Chicago bill.
Account number: 00004821
Bill date: 2026-07-05
Billing period: 2026-05-01 to 2026-06-30
Reading type: Actual
Meter ID: M-4412
Usage: 90
Unit: CCF
Rate per CCF: $4.56
Water charge: $410.40
Other charges: $637.90
Credit applied: $120.00
Credit reference: CR-2026-041
Total due: $928.30
The billed period spans a meter replacement. The notice does not provide the old-meter closing reading or the new-meter opening reading.`, [{ kind: 'bill', date: '2026-07-05', periodStart: '2026-05-01', periodEnd: '2026-06-30', readType: 'actual', meterId: 'M-4412', usage: 90, unit: 'CCF', rate: 4.56, rateUnit: 'CCF', waterCharge: 410.4, total: 928.3, creditApplied: 120, creditReference: 'CR-2026-041' }])
];

export function createDemoDocuments() { return JSON.parse(JSON.stringify(demoDocuments)); }
export default demoDocuments;
