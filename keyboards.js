// Единое место для всех inline-клавиатур бота, чтобы не разводить Markup.inlineKeyboard
// по разным файлам и было легко поправить текст/эмодзи в одном месте.

const { Markup } = require('telegraf');

// ---------- Онбординг: тренировки ----------

const GOAL_MAP = {
  g1: 'Похудение',
  g2: 'Тонус тела',
  g3: 'Сила и мышцы',
  g4: 'Гибкость и самочувствие',
};

const goalKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔥 Похудение', 'g1')],
  [Markup.button.callback('💪 Тонус тела', 'g2')],
  [Markup.button.callback('🏋️ Сила и мышцы', 'g3')],
  [Markup.button.callback('🧘 Гибкость и самочувствие', 'g4')],
  [Markup.button.callback('✏️ Своя формулировка', 'g5')],
]);

const LEVEL_MAP = { lvl1: 'Новичок', lvl2: 'Средний', lvl3: 'Продвинутый' };

const levelKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🌱 Новичок', 'lvl1')],
  [Markup.button.callback('⚡ Средний', 'lvl2')],
  [Markup.button.callback('🔥 Продвинутый', 'lvl3')],
]);

const EQUIPMENT_MAP = {
  eq1: 'Только вес тела',
  eq2: 'Дом: гантели/резинки',
  eq3: 'Полный зал',
};

const equipmentKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🧍 Только вес тела', 'eq1')],
  [Markup.button.callback('🏠 Дом: гантели/резинки', 'eq2')],
  [Markup.button.callback('🏋️ Полный зал', 'eq3')],
]);

const daysKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('2', 'd2'), Markup.button.callback('3', 'd3')],
  [Markup.button.callback('4', 'd4'), Markup.button.callback('5', 'd5')],
]);

const skipKeyboard = Markup.inlineKeyboard([[Markup.button.callback('Пропустить / нет', 'skip')]]);

// ---------- Опросник по питанию ----------

const MEAL_STYLE_MAP = {
  ms1: 'Обычное питание',
  ms2: 'Вегетарианское',
  ms3: 'Без глютена',
  ms4: 'ПП / здоровое питание',
};

const mealStyleKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🍽 Обычное', 'ms1')],
  [Markup.button.callback('🥦 Вегетарианское', 'ms2')],
  [Markup.button.callback('🌾 Без глютена', 'ms3')],
  [Markup.button.callback('🥗 ПП / здоровое', 'ms4')],
]);

const mealCountKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('2', 'mc2'), Markup.button.callback('3', 'mc3')],
  [Markup.button.callback('4', 'mc4'), Markup.button.callback('5', 'mc5')],
]);

const COOKING_TIME_MAP = {
  ct1: 'Минимум времени, максимально просто',
  ct2: 'Среднее — готова(а) готовить понемногу каждый день',
  ct3: 'Готова(а) готовить долго и с удовольствием',
};

const cookingTimeKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('⚡ Минимум времени', 'ct1')],
  [Markup.button.callback('🍳 Среднее', 'ct2')],
  [Markup.button.callback('👩‍🍳 Готова готовить долго', 'ct3')],
]);

const BUDGET_MAP = { b1: 'Эконом', b2: 'Средний', b3: 'Бюджет не важен' };

const budgetKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('💰 Эконом', 'b1')],
  [Markup.button.callback('💵 Средний', 'b2')],
  [Markup.button.callback('💎 Бюджет не важен', 'b3')],
]);

// ---------- Подписка / меню после плана ----------

function subscribeKeyboard(paymentLink) {
  return Markup.inlineKeyboard([[Markup.button.url('💳 Оформить подписку', paymentLink)]]);
}

function afterTrainingPlanKeyboard(showSubscribe, paymentLink) {
  const rows = [
    [Markup.button.callback('🍽 План питания', 'menu_meal'), Markup.button.callback('✅ Тренировка выполнена', 'menu_done')],
    [Markup.button.callback('📝 Обратная связь по плану', 'menu_feedback')],
  ];
  if (showSubscribe) rows.push([Markup.button.url('💳 Оформить подписку', paymentLink)]);
  return Markup.inlineKeyboard(rows);
}

function afterMealPlanKeyboard(showSubscribe, paymentLink) {
  const rows = [[Markup.button.callback('🔁 Пересобрать план питания', 'menu_meal'), Markup.button.callback('🏋️ План тренировок', 'menu_plan')]];
  if (showSubscribe) rows.push([Markup.button.url('💳 Оформить подписку', paymentLink)]);
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  GOAL_MAP,
  goalKeyboard,
  LEVEL_MAP,
  levelKeyboard,
  EQUIPMENT_MAP,
  equipmentKeyboard,
  daysKeyboard,
  skipKeyboard,
  MEAL_STYLE_MAP,
  mealStyleKeyboard,
  mealCountKeyboard,
  COOKING_TIME_MAP,
  cookingTimeKeyboard,
  BUDGET_MAP,
  budgetKeyboard,
  subscribeKeyboard,
  afterTrainingPlanKeyboard,
  afterMealPlanKeyboard,
};
