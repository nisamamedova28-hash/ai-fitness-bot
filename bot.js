const { Telegraf, Scenes, session, Markup } = require('telegraf');
const storage = require('./storage');
const ai = require('./ai');
const access = require('./access');
const { buildTrainingPlanMessage } = require('./planFormatter');
const kb = require('./keyboards');

const DISCLAIMER = `👋 Привет! Я — твой AI-тренер по похудению и заботе о себе.

Я помогу с планом тренировок и питания под твою цель, буду сохранять твои замеры, отмечать
тренировки, принимать отчёты по еде и раз в неделю разбирать прогресс — без жёстких
ограничений и чувства вины.

⚠️ Важно: я не врач. Если у тебя есть травмы, хронические заболевания или другие медицинские
ограничения — обязательно проконсультируйся с врачом перед началом тренировок. Все планы
носят рекомендательный характер.

Дальше — несколько вопросов на кнопках, чтобы собрать план под тебя (займёт 2-3 минуты).`;

const PAYMENT_LINK = process.env.PAYMENT_LINK;

// ---------- Маленькие помощники, общие для всех сцен ----------

// Читает ответ пользователя независимо от того, нажал он кнопку или написал текст —
// это позволяет одному и тому же шагу визарда одинаково обрабатывать оба варианта.
function extractAnswer(ctx) {
  if (ctx.callbackQuery) {
    return { isButton: true, data: ctx.callbackQuery.data, text: null };
  }
  return { isButton: false, data: null, text: ctx.message && ctx.message.text };
}

// Отвечает на callback (убирает "часики" на кнопке) и прячет клавиатуру у уже нажатого
// сообщения, чтобы старые кнопки не оставались активными и не сбивали с толку.
async function ackButton(ctx) {
  if (!ctx.callbackQuery) return;
  try {
    await ctx.answerCbQuery();
  } catch (e) {
    // игнорируем — например, если callback уже устарел
  }
  try {
    await ctx.editMessageReplyMarkup();
  } catch (e) {
    // сообщение могло быть уже изменено/удалено — не критично
  }
}

// Telegram режет сообщения длиннее ~4096 символов — план тренировок/питания со ссылками
// легко может быть длиннее, поэтому бьём на части по границам пустых строк.
async function sendLong(ctx, text, extra = {}) {
  const MAX = 3500;
  if (text.length <= MAX) {
    return ctx.reply(text, extra);
  }
  const parts = [];
  let rest = text;
  while (rest.length > MAX) {
    let idx = rest.lastIndexOf('\n\n', MAX);
    if (idx < 500) idx = MAX;
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx);
  }
  parts.push(rest);
  let lastMsg;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    lastMsg = await ctx.reply(parts[i], isLast ? extra : { parse_mode: extra.parse_mode });
  }
  return lastMsg;
}

function showSubscribeButton(user) {
  return !(user && user.activated);
}

async function generateAndSendTrainingPlan(ctx, chatId, profile) {
  await ctx.reply('Спасибо! Генерирую твой план тренировок и подбираю видео с техникой — это займёт немного времени…');
  try {
    const planData = await ai.generateTrainingPlanData(profile);
    const text = await buildTrainingPlanMessage(planData);
    storage.saveUser(chatId, { lastPlan: text, lastPlanAt: Date.now() });
    const user = storage.getUser(chatId);
    await sendLong(ctx, text, {
      parse_mode: 'Markdown',
      ...kb.afterTrainingPlanKeyboard(showSubscribeButton(user), PAYMENT_LINK),
    });
  } catch (e) {
    console.error(e);
    await ctx.reply('Не получилось сгенерировать план, попробуй команду /plan ещё раз чуть позже.');
  }
}

async function generateAndSendMealPlan(ctx, chatId, profile, mealPrefs) {
  await ctx.reply('Составляю план питания и список покупок на неделю…');
  try {
    const meal = await ai.generateMealPlan(profile, mealPrefs);
    storage.saveUser(chatId, { lastMealPlan: meal, mealPrefs });
    const user = storage.getUser(chatId);
    await sendLong(ctx, meal, {
      parse_mode: 'Markdown',
      ...kb.afterMealPlanKeyboard(showSubscribeButton(user), PAYMENT_LINK),
    });
  } catch (e) {
    console.error(e);
    await ctx.reply('Не получилось составить план питания, попробуй ещё раз.');
  }
}

// ---------- Онбординг (тренировки) ----------

const onboarding = new Scenes.WizardScene(
  'onboarding',
  // 0: спросить цель
  async (ctx) => {
    await ctx.reply('Какая у тебя главная цель?', kb.goalKeyboard);
    return ctx.wizard.next();
  },
  // 1: обработать цель, спросить рост
  async (ctx) => {
    const { isButton, data, text } = extractAnswer(ctx);
    if (isButton) {
      await ackButton(ctx);
      if (data === 'g5') {
        ctx.wizard.state.awaitingCustomGoal = true;
        await ctx.reply('Напиши свою цель одним предложением:');
        return; // остаёмся на этом же шаге, ждём текст
      }
      ctx.wizard.state.profile = { goal: kb.GOAL_MAP[data] || 'Не указана' };
    } else if (ctx.wizard.state.awaitingCustomGoal && text) {
      ctx.wizard.state.profile = { goal: text };
    } else {
      return; // ждём корректного ответа
    }
    await ctx.reply('Какой у тебя рост? (в см)');
    return ctx.wizard.next();
  },
  // 2: рост -> вес
  async (ctx) => {
    ctx.wizard.state.profile.height = ctx.message && ctx.message.text;
    await ctx.reply('Какой у тебя текущий вес? (в кг)');
    return ctx.wizard.next();
  },
  // 3: вес -> замеры
  async (ctx) => {
    ctx.wizard.state.profile.weight = ctx.message && ctx.message.text;
    await ctx.reply('Хочешь добавить замеры (талия/бёдра/грудь)?', kb.skipKeyboard);
    return ctx.wizard.next();
  },
  // 4: замеры -> желаемый результат
  async (ctx) => {
    const { isButton, data, text } = extractAnswer(ctx);
    if (isButton) {
      await ackButton(ctx);
      ctx.wizard.state.profile.measurements = data === 'skip' ? 'нет' : data;
    } else {
      ctx.wizard.state.profile.measurements = text;
    }
    await ctx.reply('А какой вес или результат — твоя цель? Куда хочешь двигаться?');
    return ctx.wizard.next();
  },
  // 5: желаемый результат -> пищевые предпочтения (коротко, детали — в /meal)
  async (ctx) => {
    ctx.wizard.state.profile.targetStats = ctx.message && ctx.message.text;
    await ctx.reply(
      'Есть ли продукты, которые точно не ешь (аллергии/нелюбимое)? Если нет — просто напиши "нет".\n' +
        'Подробную анкету по питанию с кнопками задам отдельно, когда будешь собирать план еды через /meal.'
    );
    return ctx.wizard.next();
  },
  // 6: пищевые предпочтения -> уровень подготовки (кнопки)
  async (ctx) => {
    ctx.wizard.state.profile.foodPreferences = ctx.message && ctx.message.text;
    await ctx.reply('Какой у тебя уровень подготовки?', kb.levelKeyboard);
    return ctx.wizard.next();
  },
  // 7: уровень -> оборудование (кнопки)
  async (ctx) => {
    const { isButton, data } = extractAnswer(ctx);
    if (!isButton) return; // ждём нажатия кнопки
    await ackButton(ctx);
    ctx.wizard.state.profile.level = kb.LEVEL_MAP[data] || data;
    await ctx.reply('Какое оборудование доступно?', kb.equipmentKeyboard);
    return ctx.wizard.next();
  },
  // 8: оборудование -> дней в неделю (кнопки)
  async (ctx) => {
    const { isButton, data } = extractAnswer(ctx);
    if (!isButton) return;
    await ackButton(ctx);
    ctx.wizard.state.profile.equipment = kb.EQUIPMENT_MAP[data] || data;
    await ctx.reply('Сколько дней в неделю готов(а) тренироваться?', kb.daysKeyboard);
    return ctx.wizard.next();
  },
  // 9: дней в неделю -> ограничения
  async (ctx) => {
    const { isButton, data } = extractAnswer(ctx);
    if (!isButton) return;
    await ackButton(ctx);
    ctx.wizard.state.profile.daysPerWeek = data.replace('d', '');
    await ctx.reply(
      'Есть ли ограничения или пожелания (например, не люблю бег, проблемы с коленом)?',
      kb.skipKeyboard
    );
    return ctx.wizard.next();
  },
  // 10: ограничения -> финал, генерация плана
  async (ctx) => {
    const { isButton, data, text } = extractAnswer(ctx);
    if (isButton) {
      await ackButton(ctx);
      ctx.wizard.state.profile.restrictions = data === 'skip' ? 'нет' : data;
    } else {
      ctx.wizard.state.profile.restrictions = text;
    }

    const chatId = String(ctx.chat.id);
    const existing = storage.getUser(chatId) || {};
    const trial = existing.trialEndsAt ? {} : access.startTrial();

    storage.saveUser(chatId, {
      ...existing,
      ...trial,
      profile: ctx.wizard.state.profile,
      remindersOn: false,
    });

    if (ctx.wizard.state.profile.weight) {
      storage.appendLog(chatId, 'weightHistory', { weight: ctx.wizard.state.profile.weight });
    }
    if (ctx.wizard.state.profile.measurements) {
      storage.appendLog(chatId, 'measurementsHistory', { measurements: ctx.wizard.state.profile.measurements });
    }

    await generateAndSendTrainingPlan(ctx, chatId, ctx.wizard.state.profile);
    await ctx.reply(
      'Готово! Команды, которые тебе пригодятся:\n' +
        '/plan — показать план тренировок ещё раз\n' +
        '/meal — план питания и список покупок на неделю (отдельная анкета на кнопках)\n' +
        '/done — отметить, что тренировка сегодня выполнена\n' +
        '/food — записать текстом, что съел(а) (или просто скинь фото/скриншот — отмечу автоматически)\n' +
        '/measurements — обновить вес и замеры\n' +
        '/bodycheck — прислать фото-отчёт по форме (раз в месяц)\n' +
        '/profile — посмотреть свои сохранённые данные\n' +
        '/feedback — рассказать, как прошли тренировки, и скорректировать план\n' +
        '/remind — включить/выключить ежедневные напоминания\n' +
        '/checkup — какие анализы обычно обсуждают с врачом перед стартом\n' +
        '/subscribe — оформить подписку\n' +
        '/status — сколько дней доступа осталось'
    );
    return ctx.scene.leave();
  }
);

// ---------- Опросник по питанию (кнопки) ----------

const mealScene = new Scenes.WizardScene(
  'mealIntake',
  // 0: стиль питания
  async (ctx) => {
    ctx.wizard.state.mealPrefs = {};
    await ctx.reply('Соберу план питания — пара вопросов на кнопках. Какой стиль питания тебе ближе?', kb.mealStyleKeyboard);
    return ctx.wizard.next();
  },
  // 1: стиль -> приёмов пищи в день
  async (ctx) => {
    const { isButton, data } = extractAnswer(ctx);
    if (!isButton) return;
    await ackButton(ctx);
    ctx.wizard.state.mealPrefs.style = kb.MEAL_STYLE_MAP[data] || data;
    await ctx.reply('Сколько приёмов пищи в день удобно?', kb.mealCountKeyboard);
    return ctx.wizard.next();
  },
  // 2: приёмов пищи -> время на готовку
  async (ctx) => {
    const { isButton, data } = extractAnswer(ctx);
    if (!isButton) return;
    await ackButton(ctx);
    ctx.wizard.state.mealPrefs.mealsPerDay = data.replace('mc', '');
    await ctx.reply('Сколько времени готова(а) тратить на готовку?', kb.cookingTimeKeyboard);
    return ctx.wizard.next();
  },
  // 3: время на готовку -> бюджет
  async (ctx) => {
    const { isButton, data } = extractAnswer(ctx);
    if (!isButton) return;
    await ackButton(ctx);
    ctx.wizard.state.mealPrefs.cookingTime = kb.COOKING_TIME_MAP[data] || data;
    await ctx.reply('Какой бюджет на продукты?', kb.budgetKeyboard);
    return ctx.wizard.next();
  },
  // 4: бюджет -> аллергии/нелюбимые продукты
  async (ctx) => {
    const { isButton, data } = extractAnswer(ctx);
    if (!isButton) return;
    await ackButton(ctx);
    ctx.wizard.state.mealPrefs.budget = kb.BUDGET_MAP[data] || data;
    await ctx.reply('Есть аллергии или продукты, которые точно не ешь?', kb.skipKeyboard);
    return ctx.wizard.next();
  },
  // 5: аллергии -> генерация плана питания
  async (ctx) => {
    const { isButton, data, text } = extractAnswer(ctx);
    if (isButton) {
      await ackButton(ctx);
      ctx.wizard.state.mealPrefs.allergies = data === 'skip' ? 'нет' : data;
    } else {
      ctx.wizard.state.mealPrefs.allergies = text;
    }

    const chatId = String(ctx.chat.id);
    const user = storage.getUser(chatId);
    if (!user || !user.profile) {
      await ctx.reply('Сначала нужно пройти основную анкету — набери /start.');
      return ctx.scene.leave();
    }
    await generateAndSendMealPlan(ctx, chatId, user.profile, ctx.wizard.state.mealPrefs);
    return ctx.scene.leave();
  }
);

// ---------- Обратная связь по плану тренировок ----------

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
      await sendLong(ctx, updated, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(e);
      await ctx.reply('Не получилось обновить план, попробуй ещё раз чуть позже.');
    }
    return ctx.scene.leave();
  }
);

// ---------- Обновление веса/замеров ----------

const measurementsScene = new Scenes.WizardScene(
  'measurements',
  async (ctx) => {
    await ctx.reply('Какой у тебя текущий вес? (в кг)');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.wizard.state.weight = ctx.message.text;
    await ctx.reply('Замеры (талия/бёдра/грудь)?', kb.skipKeyboard);
    return ctx.wizard.next();
  },
  async (ctx) => {
    const { isButton, data, text } = extractAnswer(ctx);
    let measurements;
    if (isButton) {
      await ackButton(ctx);
      measurements = data === 'skip' ? 'нет' : data;
    } else {
      measurements = text;
    }
    const chatId = String(ctx.chat.id);
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

// ---------- Дневник питания ----------

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

// ---------- Ежемесячное фото-контроль ----------

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
      'Пробный период закончился. Чтобы продолжить пользоваться ботом, оформи подписку ' +
        'кнопкой ниже. Если у тебя есть промокод — отправь команду /activate КОД',
      kb.subscribeKeyboard(PAYMENT_LINK)
    );
  }
  return next();
}

function createBot() {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  const stage = new Scenes.Stage([onboarding, mealScene, feedbackScene, measurementsScene, foodScene, bodycheckScene]);
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
      await sendLong(ctx, user.lastPlan, {
        parse_mode: 'Markdown',
        ...kb.afterTrainingPlanKeyboard(showSubscribeButton(user), PAYMENT_LINK),
      });
    })
  );

  bot.command('meal', (ctx) =>
    requireAccess(ctx, async () => {
      const user = storage.getUser(String(ctx.chat.id));
      if (!user?.profile) {
        await ctx.reply('Сначала пройди онбординг: /start');
        return;
      }
      return ctx.scene.enter('mealIntake');
    })
  );

  bot.command('feedback', (ctx) => requireAccess(ctx, () => ctx.scene.enter('feedback')));
  bot.command('measurements', (ctx) => requireAccess(ctx, () => ctx.scene.enter('measurements')));
  bot.command('food', (ctx) => requireAccess(ctx, () => ctx.scene.enter('foodLog')));
  bot.command('bodycheck', (ctx) => requireAccess(ctx, () => ctx.scene.enter('bodycheck')));

  bot.command('subscribe', (ctx) =>
    ctx.reply('Оформить или продлить подписку можно по кнопке ниже 👇', kb.subscribeKeyboard(PAYMENT_LINK))
  );

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
    if (days > 0) {
      return ctx.reply(
        `Осталось дней пробного доступа: ${days}` + (days <= 2 ? '\n\nЧтобы не потерять доступ — можно оформить подписку заранее 👇' : ''),
        days <= 2 ? kb.subscribeKeyboard(PAYMENT_LINK) : undefined
      );
    }
    return ctx.reply('Пробный период закончился. Оформи подписку, чтобы продолжить 👇', kb.subscribeKeyboard(PAYMENT_LINK));
  });

  bot.command('activate', async (ctx) => {
    const code = ctx.message.text.replace('/activate', '').trim();
    if (access.checkCode(code)) {
      storage.saveUser(String(ctx.chat.id), { activated: true });
      await ctx.reply('✅ Доступ активирован. Спасибо!');
    } else {
      await ctx.reply('Код не найден. Проверь правильность или оформи подписку 👇', kb.subscribeKeyboard(PAYMENT_LINK));
    }
  });

  bot.help((ctx) =>
    ctx.reply(
      '/start — начать заново и заполнить профиль\n' +
        '/plan — показать текущий план тренировок\n' +
        '/meal — план питания и список покупок на неделю (анкета на кнопках)\n' +
        '/done — отметить тренировку выполненной\n' +
        '/food — записать, что съел(а) (или просто скинь фото/скриншот)\n' +
        '/measurements — обновить вес и замеры\n' +
        '/bodycheck — фото-отчёт по форме (раз в месяц)\n' +
        '/profile — посмотреть сохранённые данные\n' +
        '/feedback — скорректировать план по обратной связи\n' +
        '/remind — вкл/выкл напоминания\n' +
        '/checkup — общий список анализов перед стартом (не разбор твоих личных)\n' +
        '/subscribe — оформить подписку\n' +
        '/status — статус доступа/подписки\n' +
        '/activate КОД — активировать промокод'
    )
  );

  // Кнопки, которые приходят под уже отправленным планом тренировок/питания
  // (пользователь в этот момент не находится ни в одной сцене).
  bot.action('menu_meal', (ctx) =>
    requireAccess(ctx, async () => {
      await ackButton(ctx);
      return ctx.scene.enter('mealIntake');
    })
  );
  bot.action('menu_plan', (ctx) =>
    requireAccess(ctx, async () => {
      await ackButton(ctx);
      const user = storage.getUser(String(ctx.chat.id));
      if (!user?.lastPlan) {
        await ctx.reply('У тебя ещё нет плана тренировок. Набери /start.');
        return;
      }
      await sendLong(ctx, user.lastPlan, {
        parse_mode: 'Markdown',
        ...kb.afterTrainingPlanKeyboard(showSubscribeButton(user), PAYMENT_LINK),
      });
    })
  );
  bot.action('menu_done', (ctx) =>
    requireAccess(ctx, async () => {
      await ackButton(ctx);
      const chatId = String(ctx.chat.id);
      const today = new Date().toISOString().slice(0, 10);
      storage.appendLog(chatId, 'workoutLog', { date: today, done: true });
      await ctx.reply('Отлично, записала тренировку ✅ Так держать!');
    })
  );
  bot.action('menu_feedback', (ctx) =>
    requireAccess(ctx, async () => {
      await ackButton(ctx);
      return ctx.scene.enter('feedback');
    })
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
