# Admin panel data status

Last updated: 2026-08-13

Legend:

- **(a) Fully connected** — live API + client aggregations; no mock data
- **(b) Partially connected** — some fields/actions still need backend
- **(c) Fully pending** — UI shell + stub service; no fake placeholders

| Module | Status | Notes |
| --- | --- | --- |
| Dashboard | (a) | Aggregates from `GET /users/all`, `GET /interviews/admin/all`, `GET /resumes/admin/all` |
| Users | (b) | List + drawer analytics from real users/interviews/resumes. Suspend/delete/invite/bulk-import + institution-admin CRUD pending |
| Interviews (list + detail) | (a) | `GET /interviews/admin/all`, `GET /interviews/admin/:id` (+ report). Client-only “flag for review” is local UI |
| Question Bank | (c) | No Question model/API — stub in `adminQuestionsService` |
| Resume Analysis (list + detail) | (b) | Wired to `GET /resumes/admin/*`. Dedicated ATS vs resume score split and JD-match score pending backend fields |
| Performance | (a) | Client rollups over real users + interviews (student / company / institution tabs) |
| Institutions (list + detail) | (a)/(b) | Create institution + institution-scoped bulk student import via `/api/institutions`. Billing plan CRUD beyond planTier field still light |
| AI Configuration | (c) | Stub `adminAIConfigService` |
| Subscriptions | (c) | Stub `adminSubscriptionsService` |
| Support | (c) | Stub `adminSupportService` |
| Settings | (b) | Admin accounts list from real `role=admin\|recruiter` users. Roles matrix, audit log, integration keys pending |

## New admin API routes (this change)

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/interviews/admin/all` | admin |
| GET | `/api/interviews/admin/:id` | admin |
| GET | `/api/resumes/admin/all` | admin |
| GET | `/api/resumes/admin/:id` | admin |
| GET | `/api/reports/admin/all` | admin |
| GET/POST | `/api/institutions` | admin |
| GET | `/api/institutions/:id` | admin |
| POST | `/api/institutions/:id/students/bulk` | admin |

Existing reused: `GET /api/users/all`, `GET /api/users/:id/analytics`.

## Client pattern

Reuses `client/src/services/api.js` (axios + Bearer refresh). Admin hooks live in `client/src/admin/hooks/` (`useAdminQuery` mirrors student `useState`/`useEffect` fetching — no React Query in this repo).

## Performance PDF reports (2026-08-13)

- **Institutions list** → Download Combined Report (comparison cover + one section per institution)
- **Institution detail** → Download Report (single institution)
- **Performance → Student-wise** → Download Report (selected student)

Built with existing `jspdf`. Metrics from `institutionReport.js` over live hooks only. Placement readiness uses the same admin rollup formula documented in that file (no separate DB field).

## Removed

- Entire `client/src/admin/data/*` mock catalog
- Mock seed arrays formerly inlined in Settings / Support / AI Config / Notifications / Question Bank / Subscriptions
