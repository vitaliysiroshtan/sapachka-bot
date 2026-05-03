# sapachka-bot

Telegram group bot that silently deletes duplicate text messages from the same user within a configurable time window. Built to curb ad spam in mid-large groups.

## How it works

When a user sends a text message the bot has already seen from them (in the same group, within the time window), the duplicate is deleted without any notification. The first occurrence is always kept.

Messages are stored as SHA-256 hashes — raw text is never saved.

## Self-hosting

### Prerequisites

- Node.js 18+
- A bot token from [@BotFather](https://t.me/BotFather)
- The bot must be a group **admin with "Delete messages" permission**

### Setup

```bash
git clone https://github.com/your-username/sapachka-bot.git
cd sapachka-bot
npm install
cp .env.example .env
# Edit .env and set your BOT_TOKEN and ALLOWED_CHATS
npm start
```

### Configuration

| Variable | Default | Description |
|---|---|---|
| `BOT_TOKEN` | required | Token from BotFather |
| `WINDOW_HOURS` | `48` | How long to remember a message (supports decimals) |
| `ALLOWED_CHATS` | unset | Comma-separated group IDs to restrict usage. Unset = allow all groups |

To get a group's chat ID, send `/chatid` in the group after adding the bot.

### Deploy to Fly.io

```bash
fly apps create your-app-name
fly volumes create sapachka_data --region ams --size 1
fly secrets set BOT_TOKEN=your_token_here
fly secrets set ALLOWED_CHATS=your_chat_id1, your_chat_id2
fly deploy
```

## License

MIT
