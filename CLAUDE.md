# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`sapachka_bot` is a Telegram group management bot that silently deletes duplicate text messages from the same user within a configurable time window (default 48h). Built to prevent ad spam in a 2K+ member group already managed by @missrose_bot. Starts with identical message detection only — fuzzy/similar message detection is a planned future phase.

## Architecture

Two-file Node.js app using the [grammY](https://grammy.dev) Telegram bot framework and `better-sqlite3`.

- **`src/index.js`** — bot entry point. Registers a `message:text` handler that checks for duplicates, deletes if found, records if not. Runs an hourly pruner via `setInterval`.
- **`src/db.js`** — all SQLite logic. Stores SHA-256 hashes of message text (lowercased + trimmed) in a `seen_messages` table. Never stores raw message content.

Duplicate detection: same `(user_id, chat_id, text_hash)` within `WINDOW_HOURS`.

The bot must be a group **admin with "Delete messages" permission** to function.

## Build Commands

```bash
npm install          # install dependencies (first time only)
npm start            # run the bot
npm run dev          # run with auto-restart on file changes (Node 18+)
```

## Project Structure

```
src/
  index.js   — bot + message handler
  db.js      — SQLite helpers (isDuplicate, recordMessage, pruneOld)
Dockerfile   — node:22-slim image, compiles native better-sqlite3
fly.toml     — Fly.io config, mounts /data volume for SQLite persistence
.env         — BOT_TOKEN and WINDOW_HOURS (never commit)
.env.example — template for .env
data.db      — SQLite file created at first run (never commit, not on Fly)
```

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `BOT_TOKEN` | `.env` / `fly secrets` | Telegram bot token from BotFather |
| `WINDOW_HOURS` | `.env` / `fly secrets` | Duplicate window in hours (supports decimals, default 48) |
| `DB_PATH` | `fly.toml [env]` | Path to SQLite file; defaults to `data.db` in project root |

To change `WINDOW_HOURS` on the live deployment: `fly secrets set WINDOW_HOURS=24`

## Roadmap / TODO

- **`/echo` command** — let an admin send a message to the group as the bot (useful for announcements). Should be restricted to admins only, not all users.
- **Repeat-offender warning** — currently the bot deletes silently, which can confuse users. If the same user gets deleted more than 2 times within 5 minutes, auto-reply once explaining why (then stay silent again to avoid noise). Needs a short-term in-memory counter (no need to persist to SQLite).
- **Analytics** — track deletion counts per user/chat over time. Think about what would actually be useful to surface (top spammers, busiest hours, etc.) before building.
- **Fuzzy/similar message detection** — originally planned next phase after identical-only. Likely needs a similarity threshold (e.g. Levenshtein distance or cosine similarity on word sets). Decide on threshold carefully to avoid false positives.

## Style Guidelines

CommonJS (`require`/`module.exports`). No TypeScript. Keep logic in the two existing files unless complexity grows significantly.

## Deployment

Deployed on **Fly.io** (`sapachka-bot` app, `ams` region) with a 1 GB persistent volume (`sapachka_data` → `/data`) so the SQLite database survives redeploys.

```bash
fly deploy          # deploy latest code
fly logs            # tail live logs
fly secrets set BOT_TOKEN=...   # update token
```
