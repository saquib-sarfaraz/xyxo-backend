# Debugging checklist (backend)

Use this flow whenever an API call fails (especially `400` responses).

## 1) Confirm the request reaches the server

- Check the server terminal for any logs/errors.
- Hit health: `GET /api/health` (should return `{ ok: true }`).

## 2) Confirm CORS + Origin

- If your frontend runs on a different origin (e.g. `http://localhost:5174`), ensure it’s included in `CORS_ORIGIN` (comma-separated) and restart the backend.
- Browser preflight (`OPTIONS`) must succeed for `POST`/non-simple requests.

## 3) Confirm JSON body is parsed

- Backend uses `express.json()`; client must send `Content-Type: application/json` and valid JSON.
- In DevTools → Network, verify the request payload matches what the route expects.

## 4) Understand `400 ValidationError`

This backend uses Zod. On validation failure it returns:

```json
{
  "error": "ValidationError",
  "issues": [{ "path": "fieldName", "message": "..." }]
}
```

Look at `issues[]` to see exactly which field failed (missing, too short, regex, etc.).

## 5) Common auth pitfalls (signup/login)

- `POST /api/auth/signup` needs `name`, `password` and either `username` or `email`.
- `POST /api/auth/login` needs `password` and either `username` or `email`.
- Passwords are never logged; enable safe auth logs with `AUTH_DEBUG=true`.

## 6) Middleware blockers

- Auth-protected routes require `Authorization: Bearer <accessToken>`.
- Rate-limiting can cause `429` if you spam requests.

