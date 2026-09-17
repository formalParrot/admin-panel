# Admin Panel

Express admin panel for managing lock-service access tokens and a live notification stream.

## Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | - | Redirects to `/admin` |
| GET | `/admin` | - | Login page or admin dashboard |
| POST | `/admin/login` | - | PIN-based login (rate limited) |
| POST | `/admin/logout` | session | Destroys session |
| POST | `/admin/lock` | admin | Proxy to Lock API (`issue`, `revoke`, `tokens`) |
| ALL | `/admin/f42/*` | admin | Proxy to F42 API (all methods, all subpaths) |
| POST | `/admin/notifications` | admin | Create a notification (rate limited) |
| GET | `/admin/notifications` | admin | List all notifications |
| PATCH | `/admin/notifications/:id/read` | admin | Mark notification as read |
| GET | `/admin/notifications/missed` | admin | Unread notifications since last seen |
| POST | `/admin/notifications/mark-seen` | admin | Mark all current notifications as seen |
| GET | `/admin/notifications/stream` | admin | SSE stream for live notifications |
| POST | `/admin/webhook/notifications` | webhook key | Create notification via webhook (rate limited) |
| static | `/assets/*` | - | Static files from `public/assets/` |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: `9879`) |
| `SESSION_SECRET` | Yes | Express session secret |
| `ADMIN_PIN` | Yes | Bcrypt-hashed PIN for login |
| `ADMIN_KEY` | No | Header-based admin auth key |
| `LOCK_API_URL` | Yes | Lock service base URL |
| `LOCK_ADMIN_SECRET` | Yes | Secret sent to Lock API |
| `F42_API_KEY` | Yes | Key for F42 service status API |
| `WEBHOOK_TOKEN` | Yes | Webhook token to send notifications | 
| `TRUST_PROXY` | No | Proxy hop count (default: `1`) |

## Dashboard

The Factory 42 page polls `/admin/f42/services/Velocity` every 10s and shows live
`Status: online/offline`. When the running state flips, it POSTs a notification
through the existing `/admin/notifications` pipeline, so the change shows up in
the dashboard badge and SSE stream.

## Auth

Admin access via:
1. **Session** - login with PIN, cookie `admin_session`
2. **Header** - `x-admin-key` matching `ADMIN_KEY`

## Start

```sh
npm install
node app.js
```
