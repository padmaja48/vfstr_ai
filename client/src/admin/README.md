# Admin Panel layout shell

Cream + teal command-center UI under `src/admin/`.

**Note:** This repo uses custom CSS (not Tailwind). Tokens match the prompt pack
(`cream`, `cream-alt`, `teal-accent`, `ink`, etc.) as CSS variables in `styles/admin.css`.

## Layout features
- Collapsible sidebar with Lucide icons + section groups
- Topbar: search, avatar menu, admin dark-mode toggle
- Content: cream page bg, white cards, soft borders
- Shared: `PageHeader`, `StatCard`, `EmptyState`
- Responsive: icons-only sidebar ≤1024px

## Access
- `user.role === 'admin'`; the `localStorage.fluentai.forceAdmin` escape hatch is development-only
- Open `/admin/dashboard`

## Mock data (typed)
Import from `@/admin/data/...` (alias configured in `vite.config.mjs` + `tsconfig.json`):

```ts
import { students } from '@/admin/data/students'
import { interviews, performance, plans } from '@/admin/data'
import type { Student, Interview } from '@/admin/types'
```

Collections: students (28), institutions (16), interviews (28), questions (30),
resumes (26), performance aggregates, plans + billingTransactions (20).

Aligned with platform concepts: `targetCompany`, interview `score` ≈ `totalScore`,
`duration` minutes, institution string linkage via `institutionId`.
