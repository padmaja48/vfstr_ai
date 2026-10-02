/**
 * Live load probe for J01 — fires N concurrent create-interview requests.
 *
 * Usage (server must be running, with a valid access token):
 *   LOAD_TEST_TOKEN=<jwt> npx ts-node --transpile-only scripts/loadTestCreateInterview.ts
 *
 * Optional env:
 *   LOAD_TEST_BASE_URL=http://localhost:4000
 *   LOAD_TEST_CONCURRENCY=20
 */
const baseUrl = (process.env.LOAD_TEST_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const token = process.env.LOAD_TEST_TOKEN || '';
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 20);

const payload = {
  roleLevel: 'Fresher',
  roleDomain: 'SDE',
  interviewStyle: 'Mixed',
    duration: 30,
  resumeText:
    'Jane Doe. Projects: PDF Knowledge Chatbot using Python, FAISS, LangChain. Skills: Python, REST APIs.',
  interviewType: 'Mixed',
  interviewMode: 'sde',
  complexity: 'Beginner',
};

async function main() {
  if (!token) {
    console.error('Set LOAD_TEST_TOKEN to a valid Bearer access token.');
    process.exit(1);
  }

  console.log(`Firing ${concurrency} concurrent POST ${baseUrl}/api/interviews ...`);
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: concurrency }, async (_, i) => {
      try {
        const res = await fetch(`${baseUrl}/api/interviews`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        return { i, status: res.status, code: body?.code, retryable: body?.retryable === true };
      } catch (err) {
        return { i, status: 0, code: 'NETWORK', retryable: true, error: String(err) };
      }
    }),
  );

  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  const retryable = results.filter((r) => r.retryable || r.status === 429 || r.status === 503).length;
  const otherFail = concurrency - ok - retryable;
  const ratio = ok / concurrency;

  console.log(JSON.stringify({ elapsedMs: Date.now() - started, ok, retryable, otherFail, ratio, results }, null, 2));
  if (ratio < 0.9) {
    console.error(`FAIL: success ratio ${ratio.toFixed(2)} < 0.90`);
    process.exit(2);
  }
  console.log(`PASS: success ratio ${(ratio * 100).toFixed(0)}% ≥ 90%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
