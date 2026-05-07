require('dotenv').config();
const { Bot } = require('grammy');
const { DAY_MS, utcDayStart, hashText, isDuplicate, recordMessage, pruneOld, getOriginalTimestamp, getWindowHours, setWindowHours } = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WINDOW_HOURS = parseFloat(process.env.WINDOW_HOURS || '48');
if (!Number.isFinite(WINDOW_HOURS) || WINDOW_HOURS <= 0) {
  console.error(`Invalid WINDOW_HOURS: "${process.env.WINDOW_HOURS}". Must be a positive number.`);
  process.exit(1);
}
const ALLOWED_CHATS = process.env.ALLOWED_CHATS
  ? process.env.ALLOWED_CHATS.split(',').map(id => parseInt(id.trim(), 10))
  : null;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID ? parseInt(process.env.ADMIN_USER_ID, 10) : null;
if (!ADMIN_USER_ID) console.warn('ADMIN_USER_ID not set — private /say command disabled.');

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// In-memory only — resets on restart, which is intentional.
// We only need to warn once per session; persistent tracking would just add complexity.
const deletionCounts = new Map(); // key: `${userId}:${chatId}`

function mentionUser(user) {
  // HTML entities must be escaped — user-controlled names can contain <, >, &
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const escaped = fullName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<a href="tg://user?id=${user.id}">${escaped}</a>`;
}

function formatRemaining(ms) {
  // Always show at least 1 minute to avoid a confusing "0г 0хв" edge case
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}г ${minutes}хв`;
}

async function handleMessage(ctx, contentKey) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat.id;

  if (!userId) return;
  if (ALLOWED_CHATS && !ALLOWED_CHATS.includes(chatId)) return;

  // Per-group setting takes precedence over the global default
  const windowHours = getWindowHours(chatId) ?? WINDOW_HOURS;

  if (isDuplicate(userId, chatId, contentKey, windowHours)) {
    try {
      await ctx.deleteMessage();
      const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
      const username = ctx.from.username ? ` @${ctx.from.username}` : '';
      console.log(`[${new Date().toISOString()}] Deleted duplicate from ${fullName}${username} (${userId}) in chat ${chatId}`);

      const key = `${userId}:${chatId}`;
      const count = (deletionCounts.get(key) || 0) + 1;
      deletionCounts.set(key, count);

      // Warn on the first deletion only — subsequent ones are silently removed
      if (count === 1) {
        const originalTs = getOriginalTimestamp(userId, chatId, contentKey, windowHours);
        const windowDays = Math.ceil(windowHours / 24);
        // Calendar-day boundary: user can repost once windowDays full UTC days have passed
        // since the day they originally posted — regardless of the exact hour.
        // e.g. posted Tuesday 09:30 → allowed again from Thursday 00:00 UTC (not Thursday 09:30).
        const allowedFrom = originalTs
          ? utcDayStart(originalTs) + windowDays * DAY_MS
          : Date.now() + windowHours * 60 * 60 * 1000;
        const remainingMs = Math.max(0, allowedFrom - Date.now());
        const warning = await ctx.reply(
          `${mentionUser(ctx.from)}, повторення оголошень не частіше ніж раз в два дні. До наступної публікації: ${formatRemaining(remainingMs)}`,
          { parse_mode: 'HTML', disable_notification: true }
        );
        // Auto-delete the warning to keep the chat clean
        setTimeout(async () => {
          try { await ctx.api.deleteMessage(chatId, warning.message_id); } catch (_) {}
        }, 2 * 60 * 1000);
      }
    } catch (err) {
      // Most common cause: bot lost admin rights or message was already deleted
      console.error(`Could not delete message: ${err.message}`);
    }
  } else {
    recordMessage(userId, chatId, contentKey);
  }
}

async function isGroupAdmin(ctx) {
  const member = await ctx.getChatMember(ctx.from.id);
  return ['administrator', 'creator'].includes(member.status);
}

bot.command('start', (ctx) => {
  if (ctx.chat.type === 'private') {
    ctx.reply('This bot is for whitelisted groups only. Check github.com/vitaliysiroshtan/sapachka-bot to fork your own or contact the author for more details.');
  }
});

// Useful for finding group chat IDs to populate ALLOWED_CHATS, and for finding
// your own user ID to set ADMIN_USER_ID (send this in a private chat with the bot)
bot.command('chatid', (ctx) => ctx.reply(`Chat ID: \`${ctx.chat.id}\``, { parse_mode: 'Markdown' }));

bot.command('say', async (ctx) => {
  if (ctx.chat.type === 'private') {
    // Private usage: owner-only remote announce. Format: /say <chat_id> <message>
    // Restricted to ADMIN_USER_ID to prevent anyone else from making the bot post anywhere
    if (!ADMIN_USER_ID || ctx.from.id !== ADMIN_USER_ID) return;
    const match = ctx.match.match(/^(-?\d+)\s+([\s\S]+)$/);
    if (!match) {
      await ctx.reply('Usage: /say <chat_id> <message>');
      return;
    }
    const [, targetChatId, text] = match;
    try {
      await ctx.api.sendMessage(parseInt(targetChatId), text);
      await ctx.reply('Sent.');
    } catch (err) {
      await ctx.reply(`Failed: ${err.message}`);
    }
    return;
  }

  // Group usage: admin posts as the bot, original command message is deleted
  if (ALLOWED_CHATS && !ALLOWED_CHATS.includes(ctx.chat.id)) return;
  const text = ctx.match;
  if (!text) return;
  if (!await isGroupAdmin(ctx)) return;
  await ctx.deleteMessage();
  await ctx.reply(text);
});

bot.command('sethours', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  if (ALLOWED_CHATS && !ALLOWED_CHATS.includes(ctx.chat.id)) return;
  if (!await isGroupAdmin(ctx)) return;
  const hours = parseFloat(ctx.match);
  if (!Number.isFinite(hours) || hours <= 0) {
    await ctx.reply('Usage: /sethours 48  (or /sethours 0.016 for ~1 minute)');
    return;
  }
  setWindowHours(ctx.chat.id, hours);
  const label = hours >= 1 ? `${hours}h` : `~${Math.round(hours * 60)} min`;
  await ctx.reply(`Duplicate window set to ${label} for this group.`);
});

bot.on('message:text', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  await handleMessage(ctx, hashText(ctx.message.text));
});

bot.on('message:photo', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  // file_unique_id is stable across sessions and bots; file_id is not
  const photo = ctx.message.photo.at(-1); // largest size has the most reliable id
  await handleMessage(ctx, photo.file_unique_id);
});

setInterval(() => {
  const deleted = pruneOld(WINDOW_HOURS);
  if (deleted > 0) console.log(`Pruned ${deleted} expired records`);
}, 60 * 60 * 1000);

bot.catch((err) => console.error('Unhandled bot error:', err));

bot.start();
console.log(`Bot started. Duplicate window: ${WINDOW_HOURS}h${ALLOWED_CHATS ? ` | Allowed chats: ${ALLOWED_CHATS.join(', ')}` : ' | No chat restrictions'}`);
