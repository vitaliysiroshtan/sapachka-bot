# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`sapachka_bot` is a telegram bot for a group management that will remove duplicated posts from a user if it's posted again within 48h (make the time window configurable) to prevent advertisment spam. Let's start with identical messages only and add very similar message detection later. The group is 2K+ members and already managed by @missrose_bot, so this one is a substitute for a specific anti-flood cases.

## Getting Started

My bot creation skills are 0, and i have pretty basic experience of AI-assisted node.js + js coding, so i'd stick to that instead of python.
Let's do this in Node.js and SQLite storage. We'll use a library called grammY (modern, beginner-friendly, excellent docs at grammy.dev).

The roadmap:

Phase 0 — Install prerequisites (Node, Git, editor) – done
Phase 1 — Create the bot with BotFather, get the token – done
Phase 2 — Set up the local project (npm, git, folder structure) – done
Phase 3 — Write the bot code (with explanations of each part)
Phase 4 — Run it locally, add to a test group, watch it work
Phase 5 — Push to GitHub
Phase 6 — Deploy to a server so it runs 24/7
Phase 7 — Maintenance: logs, updates, backups

Walk through one or two phases per message and pause so it can be implemented, ask questions if something's weird, and we move at your pace. Don't try to skip ahead.



## Architecture

Two-file Node.js app using the [grammY](https://grammy.dev) Telegram bot framework and `better-sqlite3`.

- **`src/index.js`** — bot entry point. Registers a `message:text` handler that checks for duplicates, deletes if found, records if not. Runs an hourly pruner.
- **`src/db.js`** — all SQLite logic. Stores SHA-256 hashes of message text (lowercased + trimmed) in a `seen_messages` table. Never stores raw message content.

Duplicate detection: same `(user_id, chat_id, text_hash)` within `WINDOW_HOURS`.

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
.env         — BOT_TOKEN and WINDOW_HOURS (never commit)
.env.example — template for .env
data.db      — SQLite file created at first run (never commit)
```

## Style Guidelines

CommonJS (`require`/`module.exports`). No TypeScript. Keep logic in the two existing files unless complexity grows significantly.

## Deployment

TBD — Phase 6. Likely a small VPS or Railway.app running `npm start` as a systemd service or Docker container.

