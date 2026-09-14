// Возвращает ссылку на YouTube для упражнения.
//
// Если задан YOUTUBE_API_KEY (console.cloud.google.com → включить YouTube Data API v3
// → создать API key) — бот находит и возвращает ссылку на конкретное видео (первый
// релевантный результат). Без ключа — отдаёт ссылку на поиск по названию упражнения,
// она тоже открывается и всегда работает, просто без выбора конкретного видео за юзера.

const API_KEY = process.env.YOUTUBE_API_KEY;
const cache = new Map(); // exerciseName -> url, чтобы не дёргать API повторно за один процесс

function searchResultsLink(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

async function getExerciseVideoLink(exerciseName) {
  const query = `${exerciseName} техника выполнения`;

  if (!API_KEY) {
    return searchResultsLink(query);
  }

  if (cache.has(exerciseName)) {
    return cache.get(exerciseName);
  }

  try {
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1` +
      `&relevanceLanguage=ru&safeSearch=strict&q=${encodeURIComponent(query)}&key=${API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`YouTube API ${resp.status}`);
    const data = await resp.json();
    const videoId = data.items?.[0]?.id?.videoId;
    const link = videoId ? `https://www.youtube.com/watch?v=${videoId}` : searchResultsLink(query);
    cache.set(exerciseName, link);
    return link;
  } catch (e) {
    console.error('YouTube API error, falling back to search link:', e.message);
    return searchResultsLink(query);
  }
}

module.exports = { getExerciseVideoLink };
