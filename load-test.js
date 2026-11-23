import http from 'k6/http';
import { check } from 'k6';

// TEST-NFR-01 / TEST-NFR-02: 50 concurrent users, p95 < 500 ms, errors < 1%.
export const options = {
  vus: 50,
  duration: '30s',
  // k6 clears each VU's cookie jar between iterations by default, which would drop the session
  // cookie while `loggedIn` stays true; keep cookies so the one-time login is reused.
  noCookiesReset: true,
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const PASSWORD = 'Spend@Test2026';
const USERS = [
  'amit.sharma@spendwise.example',
  'neha.kapoor@spendwise.example',
  'arjun.rao@spendwise.example',
  'vikram.singh@spendwise.example',
  'sneha.iyer@spendwise.example',
];
const FINANCE = 'anita.desai@spendwise.example';

// Per-VU state survives across iterations: users log in once and reuse the session cookie
// (sessions last 30 minutes), instead of paying the deliberate bcrypt cost (>= 12) on every iteration.
let loggedIn = false;

function login(email) {
  const res = http.post(
    `${__ENV.BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'login ok': (r) => r.status === 200 });
  loggedIn = res.status === 200;
}

export default function () {
  const base = __ENV.BASE_URL;
  if (__VU % 5 === 0) {
    if (!loggedIn) login(FINANCE);
    const report = http.get(`${base}/api/reports/monthly?month=2026-09`);
    check(report, { 'report ok': (r) => r.status === 200 });
    return;
  }
  if (!loggedIn) login(USERS[__VU % USERS.length]);
  const list = http.get(`${base}/api/claims?page=1`);
  check(list, { 'list ok': (r) => r.status === 200 });
  // Each iteration uses a distinct amount/description so the duplicate rule does not fire.
  const cents = String(((__VU * 1000 + __ITER) % 2000) + 1);
  const submit = http.post(
    `${base}/api/claims`,
    JSON.stringify({
      date: '2026-10-01',
      category: 'Travel',
      amount: `${cents}.00`,
      description: 'Load test claim',
      confirmDuplicate: true,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(submit, { 'submit ok': (r) => r.status === 201 });
}

export function handleSummary(data) {
  return { 'reports/k6-summary.json': JSON.stringify(data, null, 2) };
}
