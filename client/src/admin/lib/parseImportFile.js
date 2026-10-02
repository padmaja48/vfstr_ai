/** Parse CSV or Excel (.xlsx/.xls) into header + row objects for admin imports. */
import * as XLSX from 'xlsx';

export const parseCsvText = (text) => {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 1) return { headers: [], rows: [] };

  const splitLine = (line) => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  // Single-column email list (no header)
  if (lines.length === 1 || !/,/.test(lines[0])) {
    const values = lines
      .map((l) => l.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
    if (values.length) {
      return {
        headers: ['email'],
        rows: values.map((email) => ({ email })),
      };
    }
  }

  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
  return { headers, rows };
};

export const parseSpreadsheetFile = async (file) => {
  if (!file) return { headers: [], rows: [] };
  const name = String(file.name || '').toLowerCase();
  const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls') || /sheet|excel/i.test(file.type || '');

  if (isExcel) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    if (!json.length) return { headers: [], rows: [] };
    const headers = Object.keys(json[0]);
    return { headers, rows: json };
  }

  const text = await file.text();
  return parseCsvText(text);
};

export const extractEmailsFromRows = (rows) => {
  const emails = [];
  rows.forEach((row) => {
    const email =
      row.email
      || row.Email
      || row.EMAIL
      || row['E-mail']
      || row['e-mail']
      || Object.values(row).find((v) => String(v || '').includes('@'))
      || '';
    const cleaned = String(email).trim().toLowerCase();
    emails.push(cleaned);
  });
  return [...new Set(emails)];
};

export const extractRollNumberFromRow = (row) => {
  const raw =
    row.rollNumber
    ?? row.rollnumber
    ?? row.roll
    ?? row.RollNumber
    ?? row['Roll Number']
    ?? row['roll number']
    ?? row['Roll No']
    ?? row['roll no']
    ?? '';
  return String(raw).trim();
};

export const buildStudentImportPayload = (row) => ({
  name: String(row.name || row.Name || '').trim(),
  email: String(row.email || row.Email || '').trim().toLowerCase(),
  rollNumber: extractRollNumberFromRow(row),
});

export const usernameFromEmail = (email) => {
  const local = String(email || '').split('@')[0] || '';
  return local
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40) || 'user';
};

export const passwordFromUsername = (username) => `${username}@PV2913`;

export const LAST_IMPORT_STORAGE_KEY = 'fluentai.admin.lastImport';

export const readLastImport = () => {
  try {
    const raw = sessionStorage.getItem(LAST_IMPORT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveLastImport = (result) => {
  try {
    sessionStorage.setItem(LAST_IMPORT_STORAGE_KEY, JSON.stringify(result));
  } catch {
    // A blocked/full session store should not make a successful import fail.
  }
};

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const downloadCredentialsCsv = (created = [], filename = 'VFSTR_AI_credentials.csv') => {
  const rows = [
    ['Email', 'Username', 'Default Password'],
    ...created.map((account) => [account.email, account.username, account.password]),
  ];
  const blob = new Blob([
    `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
  ], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
