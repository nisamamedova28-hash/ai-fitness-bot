const youtube = require('./youtube');

// planData — результат ai.generateTrainingPlanData(profile):
// { note, days: [{ title, exercises: [{ name, sets, tip }] }], disclaimer }
//
// Возвращает готовый текст для ctx.reply(text, { parse_mode: 'Markdown' }) —
// каждое упражнение получает реальную (или поисковую, если нет YOUTUBE_API_KEY) ссылку.
async function buildTrainingPlanMessage(planData) {
  const lines = [];

  if (planData.note) {
    lines.push(planData.note, '');
  }

  for (const day of planData.days || []) {
    lines.push(`*${day.title}*`);
    let i = 1;
    for (const ex of day.exercises || []) {
      const link = await youtube.getExerciseVideoLink(ex.name);
      const setsPart = ex.sets ? ` — ${ex.sets}` : '';
      lines.push(`${i}. ${ex.name}${setsPart}`);
      if (ex.tip) lines.push(`   _${ex.tip}_`);
      lines.push(`   ▶️ [Видео с техникой](${link})`);
      i += 1;
    }
    lines.push('');
  }

  if (planData.disclaimer) {
    lines.push(`⚠️ ${planData.disclaimer}`);
  }

  return lines.join('\n');
}

module.exports = { buildTrainingPlanMessage };
