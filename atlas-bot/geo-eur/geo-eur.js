/**
 * geo-eur.js - Módulo de Análisis Geopolítico para EUR
 *
 * Función:
 * - Analizar eventos geopolíticos y económicos en la zona EUR.
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
  STATE_FILE: path.join(__dirname, 'geo-eur-state.json'),
  LOG_FILE: path.join(__dirname, 'geo-eur.log'),
  CALENDAR_URL: 'https://www.forexfactory.com/calendar',
  IMPACT_LEVELS: {
    'high': 3,
    'medium': 2,
    'low': 1,
  },
  CURRENCIES: ['EUR'], // Monedas de interés
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

      logger.info(`🟢 Geo-EUR: Estado cargado. Sentimiento: ${state.sentiment} (${(state.confidence * 100).toFixed(1)}%)`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 Geo-EUR: Estado inicial creado.');
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar estado de geo-eur: ${error.message}`);
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
    logger.info('🔍 Geo-EUR: Obteniendo calendario económico de Forex Factory...');

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

      // Filtrar solo eventos relevantes para EUR
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

    logger.info(`📅 Geo-EUR: ${events.length} eventos relevantes para EUR encontrados.`);
    return events;
  } catch (error) {
    logger.error(`❌ Geo-EUR: Error al obtener calendario económico: ${error.message}`);
    throw error;
  }
}

// === ANALIZAR SENTIMIENTO ===
function analyzeSentiment() {
  if (state.events.length === 0) {
    logger.info('ℹ️ Geo-EUR: No hay eventos para analizar. Sentimiento neutral.');
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

  if (upcomingEvents.length === 0) {
    logger.info('ℹ️ Geo-EUR: No hay eventos próximos. Sentimiento neutral.');
    state.sentiment = 'neutral';
    state.confidence = 0.5;
    return;
  }

  // Calcular impacto promedio de los próximos eventos
  const totalImpact = upcomingEvents.reduce((sum, event) => sum + event.impactLevel, 0);
  const avgImpact = totalImpact / upcomingEvents.length;

  // Determinar sentimiento basado en el impacto
  if (avgImpact >= 2.5) {
    state.sentiment = 'negative';
    state.confidence = 0.8;
    logger.info(`⚠️ Geo-EUR: Alto impacto próximo (${avgImpact.toFixed(1)}). Sentimiento NEGATIVO (${(state.confidence * 100).toFixed(1)}% confianza).`);
  } else if (avgImpact >= 1.5) {
    state.sentiment = 'neutral';
    state.confidence = 0.6;
    logger.info(`ℹ️ Geo-EUR: Impacto moderado próximo (${avgImpact.toFixed(1)}). Sentimiento NEUTRAL (${(state.confidence * 100).toFixed(1)}% confianza).`);
  } else {
    state.sentiment = 'positive';
    state.confidence = 0.7;
    logger.info(`✅ Geo-EUR: Bajo impacto próximo (${avgImpact.toFixed(1)}). Sentimiento POSITIVO (${(state.confidence * 100).toFixed(1)}% confianza).`);
  }

  await saveState();
}

// === OBTENER SEÑAL ACTUAL ===
function getCurrentSignal() {
  analyzeSentiment();
  return {
    action: state.sentiment === 'positive' ? 'CALL' : 'PUT',
    confidence: state.confidence,
    source: 'geo-eur',
    details: {
      sentiment: state.sentiment,
      events: state.events.slice(0, 3), // Top 3 eventos
    },
  };
}

// === ACTUALIZAR CALENDARIO ===
async function updateCalendar() {
  try {
    await fetchEconomicCalendar();
    analyzeSentiment();
  } catch (error) {
    logger.error(`❌ Geo-EUR: Error al actualizar calendario: ${error.message}`);
  }
}

// === INICIALIZAR MÓDULO ===
async function initGeoEUR() {
  await loadState();
  await updateCalendar();
  logger.info('🟢 Geo-EUR: Módulo iniciado. Sentimiento actual: ' + state.sentiment);
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initGeoEUR,
  updateCalendar,
  getCurrentSignal,
  getState: () => ({ ...state }),
};
