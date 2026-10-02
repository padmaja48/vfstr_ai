/**
 * Fail the test run if any file under __tests__ connects via raw mongoose.connect(MONGODB_URI).
 * Integration tests must use connectDatabase() from config/database.ts.
 */
import fs from 'fs';
import path from 'path';

describe('test database isolation guard', () => {
  const testsDir = path.join(__dirname);

  it('does not use raw mongoose.connect(MONGODB_URI) in any test file', () => {
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.name.endsWith('.test.ts')) continue;

        const content = fs.readFileSync(fullPath, 'utf8');
        if (/mongoose\.connect\s*\(\s*process\.env\.MONGODB_URI/.test(content)) {
          offenders.push(path.relative(testsDir, fullPath));
        }
      }
    };

    walk(testsDir);
    expect(offenders).toEqual([]);
  });
});
