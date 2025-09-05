/**
 * sent-ia.js - Módulo de Análisis de Sentimiento para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Analizar el sentimiento del mercado usando noticias y datos económicos.
 * - Proporcionar una puntuación de sentimiento para influir en las decisiones de trading.
 * - Persistir el estado en disco.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const axios = require('axios');
const natural = require('natural');
const { SentimentAnalyzer, PorterStemmer } = natural;
const analyzer = new SentimentAnalyzer('English', PorterStemmer, 'afinn');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'sent-ia-state.json'),
  LOG_FILE: path.join(__dirname, 'sent-ia.log'),
  NEWS_SOURCES: [
    { name: 'Reuters', url: 'https://www.reuters.com/markets/currencies/' },
    { name: 'Bloomberg', url: 'https://www.bloomberg.com/markets' },
    { name: 'ForexLive', url: 'https://www.forexlive.com/' },
  ],
  CHECK_INTERVAL: 3600000, // 1 hora en milisegundos
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};

// === LOGGING ===
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: config.LOG_FILE }),
    new winston.transports.Console(),
  ],
});

// === ESTADO DEL MÓDULO ===
let state = {
  lastUpdate: null,
  sentiment: 'neutral', // neutral, positive, negative
  confidence: 0.5,     // 0.0 a 1.0
  news: [],
  keywords: {
    positive: ['bullish', 'rally', 'growth', 'optimism', 'recovery', 'up', 'gain', 'strength'],
    negative: ['bearish', 'decline', 'recession', 'pessimism', 'down', 'loss', 'weakness', 'crisis'],
  },
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.lastUpdate = saved.lastUpdate || null;
      state.sentiment = saved.sentiment || 'neutral';
      state.confidence = saved.confidence || 0.5;
      state.news = saved.news || [];

      logger.info(`🟢 Sent-IA: Estado cargado. Sentimiento: ${state.sentiment} (${(state.confidence * 100).toFixed(1)}%)`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 Sent-IA: Estado inicial creado.');
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar estado: ${error.message}`);
    // Crear estado limpio en caso de error
    await saveState();
  }
}

// === GUARDAR ESTADO EN DISCO ===
async function saveState() {
  try {
    state.lastUpdate = new Date().toISOString();
    const tempFile = `${config.STATE_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(state, null, 2));
    await fs.rename(tempFile, config.STATE_FILE);
  } catch (error) {
    logger.error(`❌ Error al guardar estado: ${error.message}`);
  }
}

// === VERIFICAR SI EXISTE ARCHIVO ===
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// === OBTENER NOTICIAS RECIENTES ===
async function fetchRecentNews() {
  try {
    logger.info('📰 Sent-IA: Obteniendo noticias recientes...');
    const news = [];

    for (const source of config.NEWS_SOURCES) {
      try {
        const response = await axios.get(source.url, {
          headers: {
            'User-Agent': config.USER_AGENT,
          },
        });

        const $ = cheerio.load(response.data);

        // Ejemplo para Reuters (ajustar según la estructura real de la página)
        $('h3').slice(0, 5).each((i, element) => {
          const title = $(element).text().trim();
          const link = $(element).find('a').attr('href');
          const fullLink = link.startsWith('http') ? link : new URL(link, source.url).toString();

          news.push({
            source: source.name,
            title,
            link: fullLink,
            timestamp: new Date().toISOString(),
          });
        });
      } catch (error) {
        logger.error(`⚠️ Error al obtener noticias de ${source.name}: ${error.message}`);
      }
    }

    state.news = news;
    await saveState();

    logger.info(`📰 Sent-IA: ${news.length} noticias recientes obtenidas.`);
    return news;
  } catch (error) {
    logger.error(`❌ Error al obtener noticias: ${error.message}`);
    throw error;
  }
}

// === ANALIZAR SENTIMIENTO ===
function analyzeSentiment() {
  if (state.news.length === 0) {
    logger.info('ℹ️ Sent-IA: No hay noticias para analizar. Sentimiento neutral.');
    state.sentiment = 'neutral';
    state.confidence = 0.5;
    return;
  }

  // Analizar títulos de noticias
  let totalScore = 0;
  let keywordCount = 0;

  state.news.forEach(news => {
    const title = news.title.toLowerCase();
    let score = analyzer.getSentiment(news.title);

    // Buscar palabras clave positivas y negativas
    config.keywords.positive.forEach(keyword => {
      if (title.includes(keyword)) {
        score += 1;
        keywordCount++;
      }
    });

    config.keywords.negative.forEach(keyword => {
      if (title.includes(keyword)) {
        score -= 1;
        keywordCount++;
      }
    });

    totalScore += score;
  });

  // Calcular puntuación promedio
  const avgScore = totalScore / state.news.length;
  const keywordRatio = keywordCount / state.news.length;

  // Determinar sentimiento basado en la puntuación
  if (avgScore > 0.5 || keywordRatio > 0.3) {
    state.sentiment = 'positive';
    state.confidence = Math.min(0.9, 0.5 + avgScore * 0.2 + keywordRatio * 0.3);
  } else if (avgScore < -0.5 || keywordRatio > 0.3) {
    state.sentiment = 'negative';
    state.confidence = Math.min(0.9, 0.5 - avgScore * 0.2 + keywordRatio * 0.3);
  } else {
    state.sentiment = 'neutral';
    state.confidence = 0.5;
  }

  await saveState();
  logger.info(`📊 Sent-IA: Sentimiento ${state.sentiment} (${(state.confidence * 100).toFixed(1)}% confianza).`);
}

// === OBTENER SENTIMIENTO ACTUAL ===
function getCurrentSentiment() {
  analyzeSentiment();
  return {
    sentiment: state.sentiment,
    confidence: state.confidence,
    news: state.news.slice(0, 3), // Top 3 noticias
  };
}

// === ACTUALIZAR DATOS ===
async function updateData() {
  try {
    await fetchRecentNews();
    analyzeSentiment();
  } catch (error) {
    logger.error(`❌ Error al actualizar datos: ${error.message}`);
  }
}

// === INICIALIZAR MÓDULO ===
async function initSentIA() {
  await loadState();
  await updateData();
  logger.info('🟢 Sent-IA: Módulo de análisis de sentimiento iniciado.');

  // Actualizar datos periódicamente
  setInterval(updateData, config.CHECK_INTERVAL);
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initSentIA,
  updateData,
  getCurrentSentiment,
  getState: () => ({ ...state }),
};
