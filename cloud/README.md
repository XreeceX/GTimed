# GTimed cloud (API only)

No UI. This folder is a Vercel project that stores schedules and fires GitHub-side jobs (`push` / PR / tag) at `dueAt`. Local-only jobs stay in the API until `gtimed tick` on that machine claims them.

## Deploy

From this directory:

```bash
npx vercel
```

Set the project root to `cloud/` if you deploy from the repo root.

## Environment

| Variable | Purpose |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Job store (required in production; memory is lost between lambdas) |
| `UPSTASH_REDIS_REST_TOKEN` | Job store |
| `QSTASH_TOKEN` | Delayed wake for GitHub-side jobs |
| `GTIMED_PUBLIC_URL` | Public base URL, e.g. `https://gtimed.vercel.app` (QStash target) |
| `GTIMED_FIRE_SECRET` | Shared secret forwarded to `/api/internal/fire` |
| `GITHUB_CLIENT_ID` | Optional; CLI device login (`gtimed cloud login`) |
| `GITHUB_TOKEN` | PAT used to promote holding refs if no GitHub App |
| `GITHUB_APP_ID` | GitHub App (preferred for fire) |
| `GITHUB_APP_PRIVATE_KEY` | PEM, `\n` escaped is fine |
| `GITHUB_APP_INSTALLATION_ID` | Installation that can write the repo |
| `ALLOW_DEV_LOGIN=1` | Accept any token at `/api/auth/login` (local tests only) |

Hobby Cron is once per day. Use QStash delays, not Vercel Cron.

## Routes

- `POST /api/auth/login` `{ githubAccessToken }`
- `GET /api/auth/config`
- `GET /api/jobs`
- `POST /api/jobs`
- `POST /api/jobs/cancel`
- `POST /api/jobs/claim`
- `POST /api/jobs/:id/result`
- `POST /api/jobs/:id/fire`
- `POST /api/internal/fire`
