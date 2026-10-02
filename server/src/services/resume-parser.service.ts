/**
 * Resume Parser Service
 *
 * Extracts raw text from uploaded resume files (PDF, DOCX, DOC, TXT).
 * Also computes a content hash so duplicate uploads of the same resume
 * can reuse the existing analysis instead of re-running AI.
 */

import * as crypto from 'crypto';

export type ResumeParseStatus = 'ok' | 'partial' | 'scanned_likely' | 'failed';

export type ResumeExtractionResult = {
  text: string;
  parseStatus: ResumeParseStatus;
  warning?: string;
  pageCount?: number;
};

/* ── PDF ─────────────────────────────────────────────────────────── */
async function extractPdf(buffer: Buffer): Promise<{ text: string; pageCount?: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (
    buffer: Buffer,
  ) => Promise<{ text: string; numpages?: number; numPages?: number }>;
  const result = await pdfParse(buffer);
  return {
    text: result.text ?? '',
    pageCount: result.numpages ?? result.numPages,
  };
}

/* ── DOCX / DOC ─────────────────────────────────────────────────── */
async function extractDocx(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as {
    extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? '';
}

/* ── Normalise whitespace ───────────────────────────────────────── */
function normalise(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const EXTRACTION_FAILED_RE = /text extraction failed|please paste resume text/i;

/** Heuristic: image-heavy PDF with almost no extractable text (OCR not available server-side). */
export const looksLikeScannedPdf = (
  buffer: Buffer,
  extractedText: string,
  pageCount?: number,
): boolean => {
  const textLen = extractedText.trim().length;
  const pages = Math.max(1, pageCount || 1);
  if (textLen < 30 && buffer.length > 5_000) return true;
  if (textLen / pages < 40 && buffer.length > 8_000) return true;

  const sample = buffer.toString('latin1', 0, Math.min(buffer.length, 250_000));
  const images = (sample.match(/\/Image/g) || []).length;
  const fonts = (sample.match(/\/BaseFont|\/Font\b/g) || []).length;
  if (images >= 3 && fonts <= 1 && textLen < 80) return true;
  return false;
};

/**
 * Extract full text from a resume file buffer.
 * Supports: PDF, DOCX, DOC, TXT, plain-text.
 */
export async function extractResumeText(
  buffer: Buffer,
  filename: string,
  mimetype: string,
  fallbackText?: string,
): Promise<ResumeExtractionResult> {
  // Pasted plain text takes priority (user typed/pasted it themselves)
  if (fallbackText?.trim() && fallbackText.trim().length > 50) {
    return { text: normalise(fallbackText.trim()), parseStatus: 'ok' };
  }

  const isPdf =
    mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');

  try {
    const lower = filename.toLowerCase();
    const isDocx =
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || lower.endsWith('.docx');
    const isDoc = mimetype === 'application/msword' || lower.endsWith('.doc');
    const isTxt = mimetype.startsWith('text/') || lower.endsWith('.txt');

    if (isPdf) {
      const { text, pageCount } = await extractPdf(buffer);
      const normalized = normalise(text);
      const scanned = looksLikeScannedPdf(buffer, normalized, pageCount);
      const largeDocWarning =
        (typeof pageCount === 'number' && pageCount >= 5)
        || normalized.length >= 18_000
          ? 'Large resume detected (5+ pages). Analysis may take up to a minute — keep this tab open.'
          : undefined;

      if (scanned && normalized.length < 80) {
        return {
          text: '',
          parseStatus: 'scanned_likely',
          pageCount,
          warning:
            'This PDF looks scanned/image-only (little selectable text). OCR is not available here — paste your resume text or upload a text-based PDF/DOCX.',
        };
      }

      if (normalized.length > 120) {
        return {
          text: normalized,
          parseStatus: scanned ? 'partial' : 'ok',
          pageCount,
          warning:
            scanned
              ? 'Some pages may be image-based. Verify the Review step; paste any missing sections.'
              : largeDocWarning,
        };
      }
      if (normalized.length > 30) {
        return {
          text: normalized,
          parseStatus: 'partial',
          pageCount,
          warning:
            largeDocWarning
            || 'Only a small amount of text was extracted from this PDF. It may be scanned or image-based — verify the Review step or paste the full resume text.',
        };
      }
      if (buffer.length > 5_000 || scanned) {
        return {
          text: '',
          parseStatus: 'scanned_likely',
          pageCount,
          warning:
            'This looks like a scanned or image-only PDF. We could not extract selectable text. Please paste your resume text or upload a text-based PDF/DOCX.',
        };
      }
    }

    if (isDocx || isDoc) {
      const text = await extractDocx(buffer);
      const normalized = normalise(text);
      if (normalized.length > 30) {
        return {
          text: normalized,
          parseStatus: normalized.length > 120 ? 'ok' : 'partial',
          warning:
            normalized.length > 120
              ? undefined
              : 'Only partial text was extracted from this document. Please verify skills and projects on the Review step.',
        };
      }
    }

    if (isTxt) {
      return { text: normalise(buffer.toString('utf8')), parseStatus: 'ok' };
    }

    // Reject unknown types — do not sniff arbitrary binaries as PDF/DOCX.
    return {
      text: '',
      parseStatus: 'failed',
      warning: 'Unsupported resume file type. Upload a PDF, DOCX, DOC, or TXT file.',
    };
  } catch (err) {
    console.warn('[resume-parser] extraction error:', err);
  }

  if (isPdf) {
    return {
      text: '',
      parseStatus: 'scanned_likely',
      warning:
        'Could not extract text from this PDF (often scanned/image-only). Paste your resume text instead.',
    };
  }

  const fallback = fallbackText?.trim() || '';
  if (fallback.length >= 50) {
    return { text: normalise(fallback), parseStatus: 'partial', warning: 'Used pasted resume text because file extraction failed.' };
  }

  return {
    text: '',
    parseStatus: 'failed',
    warning: `Could not extract readable text from ${filename}. Please paste your resume text.`,
  };
}

/** True when the stored rawText is a failed-extraction placeholder, not a real resume. */
export function isFailedExtractionPlaceholder(text: string): boolean {
  return EXTRACTION_FAILED_RE.test(String(text || ''));
}

/**
 * Compute a SHA-256 hash of the extracted text (normalised).
 * Used to detect duplicate resume uploads.
 */
export function resumeContentHash(text: string): string {
  const canonical = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
