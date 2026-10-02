import { looksLikeScannedPdf } from '../services/resume-parser.service';

describe('scanned PDF detection', () => {
  it('flags image-heavy PDFs with almost no extractable text', () => {
    // Minimal fake PDF-ish payload with Image markers and almost no fonts.
    const payload = Buffer.from(
      `%PDF-1.4\n1 0 obj<< /Type /XObject /Subtype /Image >>endobj\n`.repeat(4)
      + `/Image /Image /Image\ntrailer<<>>`,
      'latin1',
    );
    expect(looksLikeScannedPdf(payload, '', 2)).toBe(true);
    expect(looksLikeScannedPdf(payload, 'hi', 2)).toBe(true);
  });

  it('does not flag text-rich resumes', () => {
    const text =
      'Jane Doe\nProjects\nPDF Knowledge Chatbot using Python FAISS LangChain\n'.repeat(20);
    const payload = Buffer.from(`%PDF-1.4\n/Font /BaseFont Helvetica\n${text}`);
    expect(looksLikeScannedPdf(payload, text, 2)).toBe(false);
  });
});
