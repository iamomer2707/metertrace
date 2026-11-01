# MeterTrace product and evidence review

## Verified audit context

The [Chicago OIG audit, May 6, 2026](https://igchicago.org/publications/water-billing-audit/) supports examining estimation methods, credit calculations, service-order records, and customer communication. It found meters commonly installed in small residential buildings generally accurate. Those findings motivate reconciliation; they do not establish an error in an individual resident’s account. MeterTrace is an independent evidence-organizing tool and is not affiliated with the City or OIG.

Suggested short product copy: “Follow the records. Compare bill periods, meter changes, and credits, with a page citation for every finding. MeterTrace identifies questions to verify; it does not determine what the City owes.”

## Consequential implementation checks

1. **Account and meter identity:** Never reconcile different accounts. Last four account digits alone are not a unique identifier; keep case ownership explicit and flag mixed identifiers. Reconcile reading deltas only within one meter, with the same unit and multiplier. A replacement meter often starts at a new reading.
2. **Credits:** Match promises and postings by reference, account, and chronology. Avoid summing a credit repeated in several letters or counting both a posting notice and its bill line. An unmatched difference is an amount needing clarification, not a refund guarantee. A posted credit predating the promise needs review.
3. **Billing intervals:** Handle inclusive date endpoints consistently and show exact dates. Avoid false overlap from a bill’s closing date becoming the next opening date. Do not compare different period lengths as if consumption totals were directly comparable. Missing periods indicate missing evidence, not proven unbilled service.
4. **Arithmetic and units:** Use integer cents for money. Show all operands and formulas. Missing, zero, negative, or unparseable values need explicit handling. Do not substitute a historical or current tariff for the rate printed on the resident’s bill; do not treat total due, arrears, taxes, or sewer charges as the water-use charge.
5. **Source fidelity:** Every finding needs stable document IDs, page numbers, and relevant quotations. OCR and AI extraction require review. Check that quoted text appears on the cited page; this proves provenance, not that a model interpreted it correctly. An absent field must remain unknown.
6. **Duplicates and revisions:** Detect re-uploaded documents and repeated service-order references before aggregation. Preserve original page text after manual edits; edits should be identifiable in exports. Multiple orders for one meter are possible, so a duplicate-order finding must be framed as a question.
7. **Privacy and persistence:** Explain that IndexedDB is specific to this browser and origin, and can be cleared. Original bills may contain names, addresses, and full account numbers. Make deletion work for blobs and extracted data. AI transmission must be opt-in and distinguish extracted text from original files. Never put a provider key in browser code.
8. **Export and accessibility:** Export findings, calculations, questions, document manifest, review status, and citations. A packet that excludes originals must say so. Test an empty case, a scanned PDF with no text, a PDF with multiple pages, reload after edits, keyboard navigation, reduced motion, narrow screens, print legibility, and escaped malicious document text.

## Release scope

Clearly mark all sample documents and sample amounts as fictional. State whether extraction is deterministic or AI-assisted, whether documents remain local, and whether the AI provider is configured. Do not claim guaranteed accuracy, successful dispute resolution, refunds, security certification, or award approval.
