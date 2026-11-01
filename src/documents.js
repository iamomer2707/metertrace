import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist/legacy/build/pdf.mjs';

GlobalWorkerOptions.workerSrc = new URL(`./pdf.worker.min.mjs?v=${encodeURIComponent(version)}`, import.meta.url).href;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 50;
export const PDF_TIMEOUT_MS = 25_000;
export const IMAGE_TIMEOUT_MS = 10_000;
export const MAX_IMAGE_PIXELS = 25_000_000;

const aborted = () => new DOMException('Document import was cancelled.', 'AbortError');
function checkAbort(signal) { if (signal?.aborted) throw aborted(); }
async function abortable(promise, signal) {
  checkAbort(signal);
  if (!signal) return promise;
  let onAbort;
  const cancellation = new Promise((_, reject) => { onAbort = () => reject(aborted()); signal.addEventListener('abort', onAbort, { once: true }); });
  try { return await Promise.race([promise, cancellation]); } finally { signal.removeEventListener('abort', onAbort); }
}
function documentKind(name, text) {
  const value = `${name}\n${text}`.toLowerCase();
  if (/credit (?:notice|approval)|credit.{0,30}(?:approved|authorized)/.test(value)) return 'credit';
  if (/service order|meter (?:replacement|change|exchange)/.test(value)) return 'service';
  if (/water (?:bill|usage)|billing period|amount due/.test(value)) return 'bill';
  return 'correspondence';
}
const ascii = bytes => String.fromCharCode(...bytes);
function signature(bytes) {
  if (ascii(bytes.subarray(0, 1024)).includes('%PDF-')) return 'application/pdf';
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value) && ascii(bytes.subarray(12,16)) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 16 && ascii(bytes.subarray(0,4)) === 'RIFF' && ascii(bytes.subarray(8,12)) === 'WEBP') return 'image/webp';
  return null;
}
function expectedMime(file) {
  const extensions = { pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', txt:'text/plain', md:'text/plain', csv:'text/plain' };
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1].toLowerCase();
  const byExtension = extensions[extension];
  const declared = String(file.type || '').toLowerCase().split(';')[0];
  const byMime = ['application/pdf','image/png','image/jpeg','image/webp'].includes(declared) ? declared : /^text\/(plain|csv|markdown)$/.test(declared) ? 'text/plain' : null;
  if (!byExtension && !byMime) throw new Error(`${file.name}: choose PDF, TXT, MD, CSV, PNG, JPG, or WebP.`);
  if (byExtension && byMime && byExtension !== byMime) throw new Error(`${file.name}: the file type and filename disagree. Choose an original file with the correct extension.`);
  return byExtension || byMime;
}
function textFromBytes(bytes, name) {
  let encoding = 'utf-8';
  if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le';
  else if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be';
  let text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { throw new Error(`${name}: this is not a supported text encoding. Export it as UTF-8 text or PDF.`); }
  if (/[\u0000-\u0008\u000B\u000E-\u001F]/.test(text)) throw new Error(`${name}: this looks like a binary file, not readable text.`);
  return text;
}


function imageDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png' && bytes.length >= 24) return [view.getUint32(16), view.getUint32(20)];
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  if (mime === 'image/webp' && bytes.length >= 25) {
    if (view.getUint32(4, true) + 8 > bytes.length) throw new Error('The WebP image is truncated.');
    const chunk = ascii(bytes.subarray(12,16));
    if (chunk === 'VP8X' && bytes.length >= 30) return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
    if (chunk === 'VP8L' && bytes[20] === 47) return [1 + bytes[21] + ((bytes[22] & 63) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10)];
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return [view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383];
  }
  throw new Error('The image dimensions could not be read. Choose an original PNG, JPG, or WebP.');
}
export function validateImageDimensions(bytes, mime) {
  const [width, height] = imageDimensions(bytes, mime);
  if (!width || !height || width > 10_000 || height > 10_000 || width * height > MAX_IMAGE_PIXELS) throw new Error('Images must be at most 10,000 pixels per side and 25 megapixels. Resize this image before importing.');
  return { width, height };
}
async function decodeImage(blob, signal) {
  checkAbort(signal);
  let timer, objectUrl, image;
  let expired = false;
  const decode = typeof globalThis.createImageBitmap === 'function'
    ? globalThis.createImageBitmap(blob).then(bitmap => { const result = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return result; })
    : typeof globalThis.Image === 'function'
      ? new Promise((resolve, reject) => { image = new Image(); objectUrl = URL.createObjectURL(blob); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('This image is damaged or cannot be decoded.')); image.src = objectUrl; })
      : Promise.reject(new Error('This browser cannot validate image files. Use a current browser or import a PDF/text copy.'));
  try {
    return await abortable(Promise.race([decode, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('Reading this image took longer than 10 seconds. Try a smaller image.')); }, IMAGE_TIMEOUT_MS); })]), signal);
  } catch (error) {
    if (error.name === 'AbortError' || expired) throw error;
    throw new Error('This image is damaged or cannot be decoded. Choose an original image or a PDF/text copy.');
  } finally {
    clearTimeout(timer);
    if (image) { image.onload = image.onerror = null; image.src = ''; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** Read locally, validate format, hash original bytes, and preserve a safe original Blob. */
export async function extractFile(file, { signal } = {}) {
  checkAbort(signal);
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') throw new Error('Choose a document file to continue.');
  if (!file.name.trim() || file.name.length > 1024) throw new Error('Choose a file with a valid name of at most 1,024 characters.');
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: files must be 20 MB or smaller.`);
  if (file.size === 0) throw new Error(`${file.name}: this file is empty.`);
  const expected = expectedMime(file);
  const bytes = new Uint8Array(await abortable(file.arrayBuffer(), signal));
  checkAbort(signal);
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error(`${file.name}: files must contain 1 byte to 20 MB.`);
  const detected = signature(bytes);
  if (expected !== 'text/plain' && detected !== expected || expected === 'text/plain' && detected) throw new Error(`${file.name}: its contents do not match its file type. Choose the original PDF, image, or text document.`);
  const sha256 = [...new Uint8Array(await abortable(crypto.subtle.digest('SHA-256', bytes), signal))].map(value => value.toString(16).padStart(2,'0')).join('');
  const pdf = expected === 'application/pdf', image = expected.startsWith('image/');
  const pages = [];
  if (pdf) {
    let loadingTask, timer, onAbort;
    let expired = false;
    try {
      await Promise.race([
        (async () => {
          checkAbort(signal);
          loadingTask = getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true });
          const document = await loadingTask.promise;
          if (document.numPages > MAX_PAGES) throw new Error(`This PDF has ${document.numPages} pages. Split it into files of ${MAX_PAGES} pages or fewer.`);
          for (let number = 1; number <= document.numPages; number++) {
            if (expired) return;
            checkAbort(signal);
            const page = await document.getPage(number);
            try {
              const content = await page.getTextContent();
              const text = content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
              if (text.length > 80_000) throw new Error('This PDF page contains too much text. Split or simplify the document before importing.');
              pages.push({ pageNumber: number, text });
            } finally { page.cleanup(); }
          }
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('Reading this PDF took longer than 25 seconds. Try a smaller text-based PDF or paste page text for manual review.')); }, PDF_TIMEOUT_MS); }),
        new Promise((_, reject) => {
          if (!signal) return;
          onAbort = () => { expired = true; reject(aborted()); };
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        }),
      ]);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (error.name === 'PasswordException') throw new Error(`${file.name}: remove the PDF password before importing.`);
      throw new Error(`${file.name}: ${error.message || 'PDF could not be read.'}`);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (loadingTask) { try { void Promise.resolve(loadingTask.destroy()).catch(() => {}); } catch { /* Best-effort cleanup. */ } }
    }
  } else if (!image) {
    const text = textFromBytes(bytes, file.name);
    if (text.length > 800_000) throw new Error(`${file.name}: text files must contain fewer than 800,000 characters.`);
    const parts = text.split('\f');
    if (parts.length > MAX_PAGES) throw new Error(`${file.name}: split the document into ${MAX_PAGES} pages or fewer.`);
    if (parts.some(text => text.length > 80_000)) throw new Error(`${file.name}: keep each page below 80,000 characters. Use form feeds to split a text export into pages.`);
    parts.forEach((text, index) => pages.push({ pageNumber: index + 1, text: text.trim() }));
  } else {
    const dimensions = validateImageDimensions(bytes, expected);
    const decoded = await decodeImage(new Blob([file], { type: expected }), signal);
    const sameDimensions = decoded.width === dimensions.width && decoded.height === dimensions.height;
    const rotatedDimensions = decoded.width === dimensions.height && decoded.height === dimensions.width;
    // Native decoders may apply a phone photograph's EXIF rotation.
    if (!sameDimensions && !rotatedDimensions) throw new Error(`${file.name}: the image dimensions could not be verified.`);
    pages.push({ pageNumber: 1, text: '' });
  }
  checkAbort(signal);
  return {
    id: crypto.randomUUID(), name: file.name, type: documentKind(file.name, pages.map(page => page.text).join('\n')),
    mime: expected, size: file.size, sha256,
    pages, blob: new Blob([file], { type: expected }), records: [], needsOCR: image || pages.every(page => !page.text.trim()),
    createdAt: new Date().toISOString(), extractionMethod: image ? 'manual' : 'local-text',
  };
}
