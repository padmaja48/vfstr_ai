import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const mode = (__ENV.MODE || 'health').toLowerCase();
const vus = Number(__ENV.VUS || 50);
const duration = __ENV.DURATION || '30s';
const token = __ENV.LOAD_TEST_TOKEN || '';
const sessionCookie = __ENV.LOAD_TEST_COOKIE || '';
const csrfToken = __ENV.LOAD_TEST_CSRF || '';

if (!['health', 'health-burst', 'create'].includes(mode)) {
  throw new Error(`MODE must be "health", "health-burst", or "create", received: ${mode}`);
}

export const options = mode === 'create'
  ? {
      scenarios: {
        create_interviews: {
          executor: 'per-vu-iterations',
          vus,
          iterations: 1,
          maxDuration: '2m',
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(90)<1000', 'p(95)<1500'],
        checks: ['rate>0.99'],
      },
    }
  : mode === 'health-burst'
    ? {
        scenarios: {
          health_burst: {
            executor: 'per-vu-iterations',
            vus,
            iterations: 1,
            maxDuration: '1m',
          },
        },
        thresholds: {
          http_req_failed: ['rate<0.01'],
          http_req_duration: ['p(90)<500', 'p(95)<1000'],
          checks: ['rate>0.99'],
        },
      }
    : {
      scenarios: {
        health: {
          executor: 'constant-vus',
          vus,
          duration,
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(90)<250', 'p(95)<500'],
        checks: ['rate>0.99'],
      },
      };

const interviewPayload = JSON.stringify({
  roleLevel: 'Fresher',
  roleDomain: 'SDE',
  interviewStyle: 'Mixed',
  duration: 30,
  resumeText: 'Load-test candidate. Projects: REST API and web application.',
  interviewType: 'Mixed',
  interviewMode: 'sde',
  complexity: 'Beginner',
});

export function setup() {
  if (mode === 'create' && !token && !sessionCookie) {
    throw new Error('MODE=create requires LOAD_TEST_TOKEN or LOAD_TEST_COOKIE');
  }
}

export default function () {
  if (mode === 'create') {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      headers.Cookie = sessionCookie.includes('=')
        ? sessionCookie
        : `fluentai_access=${sessionCookie}`;
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }

    const response = http.post(`${baseUrl}/api/interviews`, interviewPayload, {
      headers,
      tags: { endpoint: 'create-interview' },
    });

    check(response, {
      'create interview returned 2xx': (res) => res.status >= 200 && res.status < 300,
    });
    return;
  }

  const response = http.get(`${baseUrl}/api/health`, {
    tags: { endpoint: 'health' },
  });

  check(response, {
    'health returned 200': (res) => res.status === 200,
  });
  if (mode === 'health') sleep(1);
}
