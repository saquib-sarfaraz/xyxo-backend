# Xyxo Backend

Production-grade starter backend for a multiplayer Tic‑Tac‑Toe platform (profiles, friends, notifications, settings) with REST + Socket.IO.

## Setup

1. Install deps: `npm i`
2. Create env: copy `.env.example` → `.env` and fill values
   - Ensure MongoDB is running and reachable via `MONGO_URI`
3. Start:
   - Dev: `npm run dev`
   - Prod: `npm start`

## Notes

- REST base path: `/api`
- Health check: `GET /api/health`
- Socket.IO namespace: default (`/`)
- Auth: send `Authorization: Bearer <token>` on REST; for sockets pass `auth: { token }`
- Cleanup: server deletes old games on a daily schedule (defaults: finished + waiting older than 24h). If you install `node-cron`, it runs at midnight; otherwise it falls back to every 24h from process start.
- Auto-restart: when a game finishes, the server emits `game:restart_timer` then restarts the round after ~3s (only if both players are still present).
- Leaderboard:
  - Lifetime: `GET /api/leaderboard`
  - Rolling 7-day: `GET /api/leaderboard/rolling`
- Realtime events:
  - `game:join { gameId }` / `game:leave { gameId }`
  - `game:move { gameId, index }`
  - `game:rematch { gameId }`
  - Server emits `game:update` (payload contains game fields at top-level and also `payload.game`), `game:error`, `game:rematch-request`, `game:auto_move`, `game:restart_timer`, `leaderboard:update`
- Debug: set `SOCKET_DEBUG=true` to log socket lifecycle/events on the backend
# xyxo-backend
