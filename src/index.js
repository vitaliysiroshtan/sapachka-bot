require('dotenv').config();
const { Bot } = require('grammy');
const { isDuplicate, recordMessage, pruneOld, getOriginalTimestamp } = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WINDOW_HOURS = parseFloat(process.env.WINDOW_HOURS || '48');
const ALLOWED_CHATS = process.env.ALLOWED_CHATS
  ? process.env.ALLOWED_CHATS.split(',').map(id => parseInt(id.trim(), 10))
  : null;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const deletionCounts = new Map(); // key: `${userId}:${chatId}`, value: number of deletions this session

function formatRemaining(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}г ${minutes}хв`;
}

bot.command('start', (ctx) => {
  if (ctx.chat.type === 'private') {
    ctx.reply('This bot is for whitelisted groups only. Check github.com/vitaliysiroshtan/sapachka-bot to fork your own or contact the author for more details.');
  }
});

bot.command('chatid', (ctx) => ctx.reply(`Chat ID: \`${ctx.chat.id}\``, { parse_mode: 'Markdown' }));

bot.command('echo', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  const text = ctx.match;
  if (!text) return;
  const member = await ctx.getChatMember(ctx.from.id);
  if (!['administrator', 'creator'].includes(member.status)) return;
  await ctx.deleteMessage();
  await ctx.reply(text);
});

bot.on('message:text', async (ctx) => {
  if (ctx.chat.type === 'private') return;

  const userId = ctx.from?.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  if (!userId) return;
  if (ALLOWED_CHATS && !ALLOWED_CHATS.includes(chatId)) return;

  if (isDuplicate(userId, chatId, text, WINDOW_HOURS)) {
    try {
      await ctx.deleteMessage();
      console.log(`[${new Date().toISOString()}] Deleted duplicate from user ${userId} in chat ${chatId}`);

      const key = `${userId}:${chatId}`;
      const count = (deletionCounts.get(key) || 0) + 1;
      deletionCounts.set(key, count);

      if (count === 2) {
        const originalTs = getOriginalTimestamp(userId, chatId, text, WINDOW_HOURS);
        const remainingMs = originalTs
          ? (originalTs + WINDOW_HOURS * 60 * 60 * 1000) - Date.now()
          : WINDOW_HOURS * 60 * 60 * 1000;
        const warning = await ctx.reply(
          `${ctx.from.first_name}, повторення оголошень не частіше ніж раз в два дні. До наступної публікації: ${formatRemaining(remainingMs)}`
        );
        setTimeout(async () => {
          try { await ctx.api.deleteMessage(chatId, warning.message_id); } catch (_) {}
        }, 2 * 60 * 1000);
      }
    } catch (err) {
      console.error(`Could not delete message: ${err.message}`);
    }
  } else {
    recordMessage(userId, chatId, text);
  }
});

setInterval(() => {
  const deleted = pruneOld(WINDOW_HOURS);
  if (deleted > 0) console.log(`Pruned ${deleted} expired records`);
}, 60 * 60 * 1000);

bot.catch((err) => console.error('Unhandled bot error:', err));

bot.start();
console.log(`Bot started. Duplicate window: ${WINDOW_HOURS}h${ALLOWED_CHATS ? ` | Allowed chats: ${ALLOWED_CHATS.join(', ')}` : ' | No chat restrictions'}`);
