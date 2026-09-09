const { Telegraf, Scenes, session, Markup } = require('telegraf');
const storage = require('./storage');
const ai = require('./ai');
const access = require('./access');

const DISCLAIMER = `👋 Привет! Я — твой AI-тренер по похудению и заботе о себе.

Я помогу с планом тренировок и питания под твою цель, буду мягко поддерживать, отслеживать вес и напоминать о тренировках — без жёстких ограничений и чувства вины.

⚠️ Важно: я не врач. Если у тебя есть травмы, хронические заболевания или другие медицинские ограничения — обязательно проконсультируйся с врачом перед началом тренировок. Все планы носят рекомендательный характер.

Дальше — пара вопросов, чтобы собрать план под тебя (займёт 1-2 минуты).`;

// ---------- Onboarding wizard ----------
const onboarding = new Scenes.WizardScene(
  'onboarding',
  async (ctx) => {
    await ctx.reply('Какая у тебя главная цель? (например: похудение, тонус тела, лёгкость в движении)');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile = { goal: ctx.message.text };
    await ctx.reply('Напиши текущий вес и, если хочешь, замеры (талия/бёдра и т.п.) — чтобы я видела точку старта.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.currentStats = ctx.message.text;
    await ctx.reply('А какой вес или результат — твоя цель? Куда хочешь двигаться?');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.targetStats = ctx.message.text;
    await ctx.reply(
      'Какой у тебя уровень подготовки?',
      Markup.keyboard([['Новичок', 'Средний', 'Продвинутый']]).oneTime().resize()
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.level = ctx.message.text;
    await ctx.reply(
      'Какое оборудование доступно?',
      Markup.keyboard([['Только вес тела'], ['Дом: гантели/резинки'], ['Полный зал']]).oneTime().resize()
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.equipment = ctx.message.text;
    await ctx.reply(
      'Сколько дней в неделю готов(а) тренироваться?',
      Markup.keyboard([['2', '3'], ['4', '5']]).oneTime().resize()
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.daysPerWeek = ctx.message.text;
    await ctx.reply(
      'Есть ли ограничения или пожелания (например, не люблю бег, проблемы с коленом — напиши, что важно учесть)? Если нет — напиши "нет".',
      Markup.removeKeyboard()
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.restrictions = ctx.message.text;
    const chatId = String(ctx.chat.id);
    const existing = storage.getUser(chatId) || {};
    const trial = existing.trialEndsAt ? {} : access.startTrial();

    storage.saveUser(chatId, {
      ...existing,
      ...trial,
      profile: ctx.wizard.state.profile,
      remindersOn: false,
    });

    await ctx.reply('Спасибо! Генерирую твой план тренировок — это займёт немного времени…');
    try {
      const plan = await ai.generateTrainingPlan(ctx.wizard.state.profile);
      storage.saveUser(chatId, { lastPlan: plan, lastPlanAt: Date.now() });
      await ctx.reply(plan, { parse_mode: 'Markdown' });
      await ctx.reply(
        'Готово! Команды, которые тебе пригодятся:\n' +
          '/plan — показать план тренировок ещё раз\n' +
          '/meal — план питания и список покупок\n' +
          '/feedback — рассказать, как прошли тренировки, и скорректировать план\n' +
          '/remind — включить/выключить ежедневные напоминания\n' +
          '/checkup — какие анализы обычно обсуждают с врачом перед стартом\n' +
          '/status — сколько дней доступа осталось'
      );
    } catch (e) {
      console.error(e);
      await ctx.reply('Не получилось сгенерировать план, попробуй команду /plan ещё раз чуть позже.');
    }
    return ctx.scene.leave();
  }
);

// ---------- Feedback wizard (adjust plan) ----------
const feedbackScene = new Scenes.WizardScene(
  'feedback',
  async (ctx) => {
    await ctx.reply('Расскажи, как прошли тренировки: что было легко/тяжело, были ли дискомфорт или боль, что хочешь изменить?');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const chatId = String(ctx.chat.id);
    const user = storage.getUser(chatId);
    if (!user || !user.lastPlan) {
      await ctx.reply('Сначала нужно сгенерировать план — набери /start.');
      return ctx.scene.leave();
    }
    await ctx.reply('Обновляю план с учётом твоей обратной связи…');
    try {
      const updated = await ai.adjustPlan(user.profile, user.lastPlan, ctx.message.text);
      storage.saveUser(chatId, { lastPlan: updated, lastPlanAt: Date.now() });
      await ctx.reply(updated, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(e);
      await ctx.reply('Не получилось обновить план, попробуй ещё раз чуть позже.');
    }
    return ctx.scene.leave();
  }
);

function requireAccess(ctx, next) {
  const chatId = String(ctx.chat.id);
  const user = storage.getUser(chatId);
  if (!user) {
    return ctx.reply('Похоже, мы ещё не знакомы! Набери /start, чтобы начать.');
  }
  if (!access.hasAccess(user)) {
    return ctx.reply(
      `Пробный период закончился. Чтобы продолжить пользоваться ботом, оформи подписку: ${process.env.PAYMENT_LINK}\n\n` +
        'Если у тебя есть промокод — отправь команду /activate КОД'
    );
  }
  return next();
}

function createBot() {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  const stage = new Scenes.Stage([onboarding, feedbackScene]);
  bot.use(session());
  bot.use(stage.middleware());

  bot.start(async (ctx) => {
    await ctx.reply(DISCLAIMER);
    return ctx.scene.enter('onboarding');
  });

  bot.command('plan', (ctx) =>
    requireAccess(ctx, async () => {
      const user = storage.getUser(String(ctx.chat.id));
      if (!user?.lastPlan) {
        await ctx.reply('У тебя ещё нет плана. Набери /start, чтобы его создать.');
        return;
      }
      await ctx.reply(user.lastPlan, { parse_mode: 'Markdown' });
    })
  );

  bot.command('meal', (ctx) =>
    requireAccess(ctx, async () => {
      const chatId = String(ctx.chat.id);
      const user = storage.getUser(chatId);
      if (!user?.profile) {
        await ctx.reply('Сначала пройди онбординг: /start');
        return;
      }
      await ctx.reply('Составляю план питания и список покупок…');
      try {
        const meal = await ai.generateMealPlan(user.profile);
        storage.saveUser(chatId, { lastMealPlan: meal });
        await ctx.reply(meal, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error(e);
        await ctx.reply('Не получилось составить план питания, попробуй ещё раз.');
      }
    })
  );

  bot.command('feedback', (ctx) => requireAccess(ctx, () => ctx.scene.enter('feedback')));

  bot.command('checkup', (ctx) =>
    requireAccess(ctx, async () => {
      const user = storage.getUser(String(ctx.chat.id));
      await ctx.reply('Собираю общий список…');
      try {
        const info = await ai.getGeneralCheckupInfo(user?.profile || {});
        await ctx.reply(info, { parse_mode: 'Markdown' });
        await ctx.reply(
          '⚠️ Это общая информация, а не разбор твоих личных анализов. Что именно сдавать и что ' +
            'делать по результатам — решает врач, я этого не оцениваю.'
        );
      } catch (e) {
        console.error(e);
        await ctx.reply('Не получилось собрать список, попробуй ещё раз чуть позже.');
      }
    })
  );

  bot.command('remind', (ctx) =>
    requireAccess(ctx, async () => {
      const chatId = String(ctx.chat.id);
      const user = storage.getUser(chatId);
      const next = !user?.remindersOn;
      storage.saveUser(chatId, { remindersOn: next });
      await ctx.reply(next ? '🔔 Напоминания включены (ежедневно в 09:00 по серверному времени).' : '🔕 Напоминания выключены.');
    })
  );

  bot.command('status', (ctx) => {
    const user = storage.getUser(String(ctx.chat.id));
    if (!user) {
      return ctx.reply('Набери /start, чтобы начать.');
    }
    if (user.activated) {
      return ctx.reply('У тебя активная подписка. Доступ открыт ✅');
    }
    const days = access.daysLeftInTrial(user);
    return ctx.reply(days > 0 ? `Осталось дней пробного доступа: ${days}` : 'Пробный период закончился.');
  });

  bot.command('activate', async (ctx) => {
    const code = ctx.message.text.replace('/activate', '').trim();
    if (access.checkCode(code)) {
      storage.saveUser(String(ctx.chat.id), { activated: true });
      await ctx.reply('✅ Доступ активирован. Спасибо!');
    } else {
      await ctx.reply('Код не найден. Проверь правильность или оформи подписку: ' + process.env.PAYMENT_LINK);
    }
  });

  bot.help((ctx) =>
    ctx.reply(
      '/start — начать заново и заполнить профиль\n' +
        '/plan — показать текущий план тренировок\n' +
        '/meal — план питания и список покупок\n' +
        '/feedback — скорректировать план по обратной связи\n' +
        '/remind — вкл/выкл ежедневные напоминания\n' +
        '/checkup — общий список анализов перед стартом (не разбор твоих личных)\n' +
        '/status — статус доступа/подписки\n' +
        '/activate КОД — активировать промокод'
    )
  );

  return bot;
}

module.exports = { createBot };
