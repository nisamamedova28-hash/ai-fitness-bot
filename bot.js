const { Telegraf, Scenes, session, Markup } = require('telegraf');
const storage = require('./storage');
const ai = require('./ai');
const access = require('./access');

const DISCLAIMER = `👋 Привет! Я — твой AI-тренер по похудению и заботе о себе.

Я помогу с планом тренировок и питания под твою цель, буду сохранять твои замеры, отмечать
тренировки, принимать отчёты по еде и раз в неделю разбирать прогресс — без жёстких
ограничений и чувства вины.

⚠️ Важно: я не врач. Если у тебя есть травмы, хронические заболевания или другие медицинские
ограничения — обязательно проконсультируйся с врачом перед началом тренировок. Все планы
носят рекомендательный характер.

Дальше — несколько вопросов, чтобы собрать план под тебя (займёт 2-3 минуты).`;

// ---------- Onboarding wizard ----------
const onboarding = new Scenes.WizardScene(
  'onboarding',
  async (ctx) => {
    await ctx.reply('Какая у тебя главная цель? (например: похудение, тонус тела, лёгкость в движении)');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile = { goal: ctx.message.text };
    await ctx.reply('Какой у тебя рост? (в см)');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.height = ctx.message.text;
    await ctx.reply('Какой у тебя текущий вес? (в кг)');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.weight = ctx.message.text;
    await ctx.reply('Хочешь добавить замеры (талия/бёдра/грудь)? Если нет — напиши "нет".');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.measurements = ctx.message.text;
    await ctx.reply('А какой вес или результат — твоя цель? Куда хочешь двигаться?');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.targetStats = ctx.message.text;
    await ctx.reply('Какие продукты любишь, а что не ешь? (это поможет составить меню и список покупок под твой вкус)');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.profile.foodPreferences = ctx.message.text;
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

    // Сразу сохраняем стартовый вес и замеры в историю.
    if (ctx.wizard.state.profile.weight) {
      storage.appendLog(chatId, 'weightHistory', { weight: ctx.wizard.state.profile.weight });
    }
    if (ctx.wizard.state.profile.measurements) {
      storage.appendLog(chatId, 'measurementsHistory', { measurements: ctx.wizard.state.profile.measurements });
    }

    await ctx.reply('Спасибо! Генерирую твой план тренировок — это займёт немного времени…');
    try {
      const plan = await ai.generateTrainingPlan(ctx.wizard.state.profile);
      storage.saveUser(chatId, { lastPlan: plan, lastPlanAt: Date.now() });
      await ctx.reply(plan, { parse_mode: 'Markdown' });
      await ctx.reply(
        'Готово! Команды, которые тебе пригодятся:\n' +
          '/plan — показать план тренировок ещё раз\n' +
          '/meal — план питания и список покупок на неделю\n' +
          '/done — отметить, что тренировка сегодня выполнена\n' +
          '/food — записать текстом, что съел(а) (или просто скинь фото/скриншот — отмечу автоматически)\n' +
          '/measurements — обновить вес и замеры\n' +
          '/bodycheck — прислать фото-отчёт по форме (раз в месяц)\n' +
          '/profile — посмотреть свои сохранённые данные\n' +
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

// ---------- Measurements update wizard (тоже используется в еженедельном напоминании) ----------
const measurementsScene = new Scenes.WizardScene(
  'measurements',
  async (ctx) => {
    await ctx.reply('Какой у тебя текущий вес? (в кг)');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.weight = ctx.message.text;
    await ctx.reply('Замеры (талия/бёдра/грудь)? Если не хочешь вносить — напиши "нет".');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const chatId = String(ctx.chat.id);
    const measurements = ctx.message.text;
    storage.appendLog(chatId, 'weightHistory', { weight: ctx.wizard.state.weight });
    if (measurements && measurements.toLowerCase() !== 'нет') {
      storage.appendLog(chatId, 'measurementsHistory', { measurements });
    }
    const user = storage.getUser(chatId);
    storage.saveUser(chatId, {
      profile: { ...user.profile, weight: ctx.wizard.state.weight, measurements },
    });
    await ctx.reply('Записала! Спасибо, что делишься прогрессом 💛');
    return ctx.scene.leave();
  }
);

// ---------- Food log wizard ----------
const foodScene = new Scenes.WizardScene(
  'foodLog',
  async (ctx) => {
    await ctx.reply('Расскажи, что сегодня съел(а) — текстом, или пришли фото тарелки/еды.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      storage.appendLog(chatId, 'foodLog', {
        photoFileId: photo.file_id,
        note: ctx.message.caption || '',
      });
    } else {
      storage.appendLog(chatId, 'foodLog', { note: ctx.message.text || '' });
    }
    await ctx.reply('Записала в дневник питания 📝');
    return ctx.scene.leave();
  }
);

// ---------- Monthly body-check photo wizard ----------
const bodycheckScene = new Scenes.WizardScene(
  'bodycheck',
  async (ctx) => {
    await ctx.reply('Пришли, пожалуйста, фото для ежемесячного отчёта по форме.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (!ctx.message.photo) {
      await ctx.reply('Нужно именно фото — попробуй ещё раз через /bodycheck.');
      return ctx.scene.leave();
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    storage.appendLog(chatId, 'monthlyPhotos', { photoFileId: photo.file_id }, 24);
    await ctx.reply('Спасибо! Сохранила фото-отчёт за этот месяц 📸');
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

  const stage = new Scenes.Stage([onboarding, feedbackScene, measurementsScene, foodScene, bodycheckScene]);
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
      await ctx.reply('Составляю план питания и список покупок на неделю…');
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
  bot.command('measurements', (ctx) => requireAccess(ctx, () => ctx.scene.enter('measurements')));
  bot.command('food', (ctx) => requireAccess(ctx, () => ctx.scene.enter('foodLog')));
  bot.command('bodycheck', (ctx) => requireAccess(ctx, () => ctx.scene.enter('bodycheck')));

  bot.command('done', (ctx) =>
    requireAccess(ctx, async () => {
      const chatId = String(ctx.chat.id);
      const today = new Date().toISOString().slice(0, 10);
      storage.appendLog(chatId, 'workoutLog', { date: today, done: true });
      await ctx.reply('Отлично, записала тренировку ✅ Так держать!');
    })
  );

  bot.command('profile', (ctx) => {
    const user = storage.getUser(String(ctx.chat.id));
    if (!user?.profile) {
      return ctx.reply('Профиль ещё не заполнен — набери /start.');
    }
    const p = user.profile;
    const weightLog = user.weightHistory || [];
    const lastWeight = weightLog.length ? weightLog[weightLog.length - 1].weight : p.weight;
    return ctx.reply(
      `📋 Твой профиль:\n` +
        `Цель: ${p.goal}\n` +
        `Рост: ${p.height || 'не указан'}\n` +
        `Текущий вес: ${lastWeight || 'не указан'}\n` +
        `Замеры: ${p.measurements || 'не указаны'}\n` +
        `Желаемый результат: ${p.targetStats || 'не указано'}\n` +
        `Пищевые предпочтения: ${p.foodPreferences || 'не указаны'}\n` +
        `Уровень: ${p.level || '—'}, оборудование: ${p.equipment || '—'}, дней в неделю: ${p.daysPerWeek || '—'}`
    );
  });

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
      await ctx.reply(next ? '🔔 Напоминания включены (тренировки ежедневно, замеры раз в неделю).' : '🔕 Напоминания выключены.');
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
        '/meal — план питания и список покупок на неделю\n' +
        '/done — отметить тренировку выполненной\n' +
        '/food — записать, что съел(а) (или просто скинь фото/скриншот)\n' +
        '/measurements — обновить вес и замеры\n' +
        '/bodycheck — фото-отчёт по форме (раз в месяц)\n' +
        '/profile — посмотреть сохранённые данные\n' +
        '/feedback — скорректировать план по обратной связи\n' +
        '/remind — вкл/выкл напоминания\n' +
        '/checkup — общий список анализов перед стартом (не разбор твоих личных)\n' +
        '/status — статус доступа/подписки\n' +
        '/activate КОД — активировать промокод'
    )
  );

  // Просто прислал фото/скриншот вне сценария (не /food и не /bodycheck) —
  // сразу засчитываем как отметку в дневник питания, без лишних шагов.
  bot.on('photo', (ctx) =>
    requireAccess(ctx, async () => {
      const chatId = String(ctx.chat.id);
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      storage.appendLog(chatId, 'foodLog', {
        photoFileId: photo.file_id,
        note: ctx.message.caption || '',
      });
      await ctx.reply('📸 Отметила в дневнике питания!');
    })
  );

  return bot;
}

module.exports = { createBot };
