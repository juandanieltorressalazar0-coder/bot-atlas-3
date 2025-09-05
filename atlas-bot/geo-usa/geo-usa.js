/**
 * geo-usa.js - Módulo de Análisis Geopolítico para USA
 *
 * Función:
 * - Analizar eventos geopolíticos y económicos en EE.UU.
 * - Proporcionar señales basadas en el sentimiento macroeconómico.
 * - Integrar con el calendario económico de Forex Factory.
 * - Persistir estado en disco.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const axios = require('axios');
const cheerio = require('cheerio');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'geo-usa-state.json'),
  LOG_FILE: path.join(__dirname, 'geo-usa.log'),
  CALENDAR_URL: 'https://www.forexfactory.com/calendar',
  IMPACT_LEVELS: {
    'high': 3,
    'medium': 2,
    'low': 1,
  },
  CURRENCIES: ['USD'], // Monedas de interés
  NEWS_SOURCES: [
    { name: 'Reuters', url: 'https://www.reuters.com/markets/us/' },
    { name: 'Bloomberg', url: 'https://www.bloomberg.com/markets' },
  ],
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
  events: [],
  sentiment: 'neutral', // neutral, positive, negative
  confidence: 0.5,     // 0.0 a 1.0
  news: [],
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.lastUpdate = saved.lastUpdate || null;
      state.events = saved.events || [];
      state.sentiment = saved.sentiment || 'neutral';
      state.confidence = saved.confidence || 0.5;
      state.news = saved.news || [];

      logger.info(`🟢 Geo-USA: Estado cargado. Sentimiento: ${state.sentiment} (${(state.confidence * 100).toFixed(1)}%)`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 Geo-USA: Estado inicial creado.');
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar estado de geo-usa: ${error.message}`);
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

// === OBTENER CALENDARIO ECONÓMICO ===
async function fetchEconomicCalendar() {
  try {
    logger.info('🔍 Geo-USA: Obteniendo calendario económico de Forex Factory...');

    const response = await axios.get(config.CALENDAR_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    const $ = cheerio.load(response.data);
    const events = [];

    // Analizar eventos de la tabla del calendario
    $('table.calendar__table tr').each((i, row) => {
      if (i === 0) return; // Saltar encabezado

      const cells = $(row).find('td');
      if (cells.length < 6) return;

      const time = $(cells[0]).text().trim();
      const currency = $(cells[1]).text().trim();
      const impact = $(cells[2]).find('span').attr('title') || 'low';
      const event = $(cells[3]).text().trim();
      const actual = $(cells[4]).text().trim();
      const forecast = $(cells[5]).text().trim();
      const previous = $(cells[6]).text().trim();

      // Filtrar solo eventos relevantes para USD
      if (config.CURRENCIES.some(c => currency.includes(c))) {
        events.push({
          time,
          currency,
          impact,
          event,
          actual,
          forecast,
          previous,
          impactLevel: config.IMPACT_LEVELS[impact.toLowerCase()] || 1,
        });
      }
    });

    // Ordenar eventos por tiempo
    events.sort((a, b) => {
      const timeA = new Date(`1970/01/01 ${a.time}`);
      const timeB = new Date(`1970/01/01 ${b.time}`);
      return timeA - timeB;
    });

    state.events = events;
    await saveState();

    logger.info(`📅 Geo-USA: ${events.length} eventos relevantes para USD encontrados.`);
    return events;
  } catch (error) {
    logger.error(`❌ Geo-USA: Error al obtener calendario económico: ${error.message}`);
    throw error;
  }
}

// === OBTENER NOTICIAS RECIENTES ===
async function fetchRecentNews() {
  try {
    logger.info('📰 Geo-USA: Obteniendo noticias recientes...');

    const news = [];

    for (const source of config.NEWS_SOURCES) {
      try {
        const response = await axios.get(source.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
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
        logger.error(`⚠️ Geo-USA: Error al obtener noticias de ${source.name}: ${error.message}`);
      }
    }

    state.news = news;
    await saveState();

    logger.info(`📰 Geo-USA: ${news.length} noticias recientes obtenidas.`);
    return news;
  } catch (error) {
    logger.error(`❌ Geo-USA: Error al obtener noticias: ${error.message}`);
    throw error;
  }
}

// === ANALIZAR SENTIMIENTO ===
function analyzeSentiment() {
  if (state.events.length === 0 && state.news.length === 0) {
    logger.info('ℹ️ Geo-USA: No hay eventos ni noticias para analizar. Sentimiento neutral.');
    state.sentiment = 'neutral';
    state.confidence = 0.5;
    return;
  }

  // Analizar impacto de los próximos eventos
  const now = new Date();
  const upcomingEvents = state.events.filter(event => {
    const eventTime = new Date(`1970/01/01 ${event.time}`);
    const currentTime = new Date(now.getHours() + ':' + now.getMinutes());
    return eventTime > currentTime;
  });

  // Analizar noticias recientes
  const recentNews = state.news.slice(0, 5); // Top 5 noticias

  // Calcular impacto promedio de los próximos eventos
  const totalImpact = upcomingEvents.reduce((sum, event) => sum + event.impactLevel, 0);
  const avgImpact = upcomingEvents.length > 0 ? totalImpact / upcomingEvents.length : 0;

  // Determinar sentimiento basado en el impacto y noticias
  if (avgImpact >= 2.5 || recentNews.some(news => news.title.toLowerCase().includes('crisis|recesión|caída'))) {
    state.sentiment = 'negative';
    state.confidence = 0.8;
    logger.info(`⚠️ Geo-USA: Alto impacto próximo (${avgImpact.toFixed(1)}) o noticias negativas. Sentimiento NEGATIVO (${(state.confidence * 100).toFixed(1)}% confianza).`);
  } else if (avgImpact >= 1.5) {
    state.sentiment = 'neutral';
    state.confidence = 0.6;
    logger.info(`ℹ️ Geo-USA: Impacto moderado próximo (${avgImpact.toFixed(1)}). Sentimiento NEUTRAL (${(state.confidence * 100).toFixed(1)}% confianza).`);
  } else {
    state.sentiment = 'positive';
    state.confidence = 0.7;
    logger.info(`✅ Geo-USA: Bajo impacto próximo (${avgImpact.toFixed(1)}) y sin noticias negativas. Sentimiento POSITIVO (${(state.confidence * 100).toFixed(1)}% confianza).`);
  }

  await saveState();
}

// === OBTENER SEÑAL ACTUAL ===
function getCurrentSignal() {
  analyzeSentiment();
  return {
    action: state.sentiment === 'positive' ? 'CALL' : 'PUT',
    confidence: state.confidence,
    source: 'geo-usa',
    details: {
      sentiment: state.sentiment,
      events: state.events.slice(0, 3), // Top 3 eventos
      news: state.news.slice(0, 3),     // Top 3 noticias
    },
  };
}

// === ACTUALIZAR DATOS ===
async function updateData() {
  try {
    await fetchEconomicCalendar();
    await fetchRecentNews();
    analyzeSentiment();
  } catch (error) {
    logger.error(`❌ Geo-USA: Error al actualizar datos: ${error.message}`);
  }
}

// === INICIALIZAR MÓDULO ===
async function initGeoUSA() {
  await loadState();
  await updateData();
  logger.info('🟢 Geo-USA: Módulo iniciado. Sentimiento actual: ' + state.sentiment);
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initGeoUSA,
  updateData,
  getCurrentSignal,
  getState: () => ({ ...state }),
};
