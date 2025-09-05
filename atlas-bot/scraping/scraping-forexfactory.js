/**
 * scraping-forexfactory.js - Módulo de Scraping para Forex Factory
 *
 * Función:
 * - Extraer eventos del calendario económico de Forex Factory.
 * - Filtrar eventos de alto impacto para monedas relevantes.
 * - Persistir los eventos en disco.
 * - Actualizar periódicamente el calendario.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const axios = require('axios');
const cheerio = require('cheerio');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'scraping-state.json'),
  CALENDAR_FILE: path.join(__dirname, 'economic-calendar.json'),
  LOG_FILE: path.join(__dirname, 'scraping.log'),
  CALENDAR_URL: 'https://www.forexfactory.com/calendar',
  HIGH_IMPACT_CURRENCIES: ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'],
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
  nextCheck: null,
  status: 'idle',
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.lastUpdate = saved.lastUpdate || null;
      state.nextCheck = saved.nextCheck || null;
      state.status = saved.status || 'idle';

      logger.info(`🟢 Scraping: Estado cargado. Última actualización: ${state.lastUpdate || 'Nunca'}`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 Scraping: Estado inicial creado.');
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

// === OBTENER CALENDARIO ECONÓMICO ===
async function fetchEconomicCalendar() {
  try {
    logger.info('🔍 Scraping: Obteniendo calendario económico de Forex Factory...');
    state.status = 'fetching';

    const response = await axios.get(config.CALENDAR_URL, {
      headers: {
        'User-Agent': config.USER_AGENT,
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

      // Filtrar solo eventos de alto impacto para monedas relevantes
      if (config.HIGH_IMPACT_CURRENCIES.some(c => currency.includes(c)) && impact.toLowerCase() === 'high') {
        events.push({
          time,
          currency,
          impact,
          event,
          actual,
          forecast,
          previous,
        });
      }
    });

    // Ordenar eventos por tiempo
    events.sort((a, b) => {
      const timeA = new Date(`1970/01/01 ${a.time}`);
      const timeB = new Date(`1970/01/01 ${b.time}`);
      return timeA - timeB;
    });

    // Guardar eventos en disco
    await saveCalendar(events);

    state.status = 'idle';
    state.nextCheck = new Date(Date.now() + config.CHECK_INTERVAL).toISOString();
    await saveState();

    logger.info(`📅 Scraping: ${events.length} eventos de alto impacto encontrados.`);
    return events;
  } catch (error) {
    logger.error(`❌ Scraping: Error al obtener calendario económico: ${error.message}`);
    state.status = 'error';
    await saveState();
    throw error;
  }
}

// === GUARDAR CALENDARIO EN DISCO ===
async function saveCalendar(events) {
  try {
    const calendarData = {
      lastUpdate: new Date().toISOString(),
      events,
    };

    const tempFile = `${config.CALENDAR_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(calendarData, null, 2));
    await fs.rename(tempFile, config.CALENDAR_FILE);
  } catch (error) {
    logger.error(`❌ Error al guardar calendario: ${error.message}`);
  }
}

// === OBTENER EVENTOS PROXIMOS ===
async function getUpcomingEvents() {
  try {
    if (!(await fileExists(config.CALENDAR_FILE))) {
      await fetchEconomicCalendar();
    }

    const data = await fs.readFile(config.CALENDAR_FILE, 'utf8');
    const calendar = JSON.parse(data);

    const now = new Date();
    const upcomingEvents = calendar.events.filter(event => {
      const eventTime = new Date(`1970/01/01 ${event.time}`);
      const currentTime = new Date(now.getHours() + ':' + now.getMinutes());
      return eventTime > currentTime;
    });

    return upcomingEvents;
  } catch (error) {
    logger.error(`❌ Error al obtener eventos próximos: ${error.message}`);
    return [];
  }
}

// === ACTUALIZAR CALENDARIO ===
async function updateCalendar() {
  try {
    await fetchEconomicCalendar();
  } catch (error) {
    logger.error(`❌ Error al actualizar calendario: ${error.message}`);
  }
}

// === INICIALIZAR MÓDULO ===
async function initScraping() {
  await loadState();
  await updateCalendar();
  logger.info('🟢 Scraping: Módulo de scraping iniciado.');

  // Actualizar calendario periódicamente
  setInterval(updateCalendar, config.CHECK_INTERVAL);
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initScraping,
  updateCalendar,
  getUpcomingEvents,
  getState: () => ({ ...state }),
};
