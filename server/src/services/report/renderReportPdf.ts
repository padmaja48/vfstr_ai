import fs from 'fs';
import path from 'path';
import { buildReportHtml } from './reportPdf.template';
import type { CleanReportData } from './report.types';

let logoCache: string | undefined;

const resolveLogoDataUri = (): string | undefined => {
  if (logoCache) return logoCache;
  const candidates = [
    path.resolve(__dirname, '../../../../client/public/progrow-logo.jpeg'),
    path.resolve(process.cwd(), 'client/public/progrow-logo.jpeg'),
    path.resolve(process.cwd(), '../client/public/progrow-logo.jpeg'),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        logoCache = `data:image/jpeg;base64,${buf.toString('base64')}`;
        return logoCache;
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
};

const headerTemplate = (logoDataUri?: string) => {
  const logo = logoDataUri
    ? `<img src="${logoDataUri}" style="height:22px;width:auto;" />`
    : `<span style="font-weight:700;color:#0d4f4a;font-size:11px;">ProGrow</span>`;
  return `<div style="width:100%;font-size:9px;padding:0 14mm;font-family:Segoe UI,sans-serif;display:flex;justify-content:space-between;align-items:center;color:#64748b;">
    <div>${logo}</div>
    <div style="font-style:italic;">Interview Feedback Report</div>
  </div>`;
};

const footerTemplate = `<div style="width:100%;font-size:8px;padding:0 14mm;font-family:Segoe UI,sans-serif;display:flex;justify-content:space-between;color:#94a3b8;">
  <span>Passion for Progress and Growth</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;

/**
 * Render normalized report data to a branded PDF buffer (HTML → Puppeteer).
 */
export const renderReportPdf = async (data: CleanReportData): Promise<Buffer> => {
  const logoDataUri = resolveLogoDataUri();
  const html = buildReportHtml(data, logoDataUri);

  let puppeteer: typeof import('puppeteer');
  try {
    puppeteer = await import('puppeteer');
  } catch {
    throw new Error(
      'PDF rendering requires puppeteer. Run npm install puppeteer in the server workspace.',
    );
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate(logoDataUri),
      footerTemplate,
      margin: { top: '22mm', bottom: '18mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
};

export default renderReportPdf;
