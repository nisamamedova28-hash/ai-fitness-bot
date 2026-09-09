require('dotenv').config();
const cron = require('node-cron');
const { createBot } = require('./bot');
const storage = require('./storage');
const access = require('./access');

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN не задан. Скопируй .env.example в .env и заполни значения.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY не задан. Скопируй .env.example в .env и заполни значения.');
  process.exit(1);
}

const bot = createBot();

// Ежедневное напоминание в 09:00 (время сервера, например Railway = UTC)
cron.schedule('0 9 * * *', async () => {
  const users = storage.getAllUsers();
  for (const [chatId, user] of Object.entries(users)) {
    if (user.remindersOn && access.hasAccess(user)) {
      try {
        await bot.telegram.sendMessage(
          chatId,
          '💪 Напоминание: сегодня по плану тренировка! Набери /plan, если нужно освежить программу.'
        );
      } catch (e) {
        console.error(`Не удалось отправить напоминание ${chatId}:`, e.message);
      }
    }
  }
});

bot.launch();
console.log('🤖 AI-фитнес-тренер запущен');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
