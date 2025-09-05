/**
 * scraping-forexfactory.js - Módulo de Scraping para Forex Factory (Versión Refactorizada)
 *
 * Función:
 * - Extraer eventos del calendario económico de Forex Factory de forma robusta.
 * - Normalizar los tiempos de los eventos a UTC.
 * - Filtrar eventos de alto impacto.
 * - Persistir y cachear los eventos de forma eficiente.
 */

const path = require('path');
const cheerio = require('cheerio');
const { saveJsonFile, readJsonFile, fileExists, setupLogger } = require('../utils/helpers');
const { fetchWithRetry } = require('../utils/network-helpers');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'scraping-state.json'),
  CALENDAR_FILE: path.join(__dirname, 'economic-calendar.json'),
  LOG_FILE: path.join(__dirname, 'logs', 'scraping.log'),
  CALENDAR_URL: 'https://www.forexfactory.com/calendar',
  CHECK_INTERVAL: 3600000, // 1 hora
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};

// === LOGGER ===
const logger = setupLogger('scraping-forexfactory', config.LOG_FILE);

// === ESTADO DEL MÓDULO ===
let state = {
  lastUpdate: null,
  etag: null, // Para cacheo HTTP
  status: 'idle',
};

// === FUNCIONES PRINCIPALES ===

/**
 * Carga el estado del scraper desde el disco.
 */
async function loadState() {
  if (await fileExists(config.STATE_FILE)) {
    try {
      state = await readJsonFile(config.STATE_FILE);
      logger.info(`Estado de scraping cargado. Última actualización: ${state.lastUpdate || 'Nunca'}`);
    } catch (error) {
      logger.error('No se pudo cargar el estado de scraping, se usará estado limpio.', error);
    }
  }
}

/**
 * Realiza el scraping del calendario económico.
 */
async function fetchEconomicCalendar() {
  logger.info('Iniciando fetch del calendario económico...');
  state.status = 'fetching';

  const headers = { 'User-Agent': config.USER_AGENT };
  if (state.etag) {
    headers['If-None-Match'] = state.etag;
  }

  try {
    const response = await fetchWithRetry(config.CALENDAR_URL, { headers });

    if (response.status === 304) {
      logger.info('Calendario no ha cambiado (304 Not Modified). No se necesita actualizar.');
      state.status = 'idle';
      await saveJsonFile(config.STATE_FILE, state);
      return;
    }

    const html = response.data;
    const $ = cheerio.load(html);
    const events = [];
    let currentDate = '';

    $('table.calendar__table tr.calendar__row').each((i, row) => {
      const $row = $(row);

      // Detectar fila de fecha
      if ($row.hasClass('calendar__row--new-day')) {
        currentDate = $row.find('td.calendar__date').text().trim();
        return;
      }

      const time = $row.find('td.calendar__time').text().trim();
      const currency = $row.find('td.calendar__currency').text().trim();
      const impactClass = $row.find('td.calendar__impact span').attr('class');
      const impact = impactClass ? impactClass.split('--')[1] : 'low'; // e.g., 'impact--high' -> 'high'
      const eventName = $row.find('td.calendar__event').text().trim();
      const actual = $row.find('td.calendar__actual').text().trim();
      const forecast = $row.find('td.calendar__forecast').text().trim();
      const previous = $row.find('td.calendar__previous').text().trim();

      if (!time || !currency) return;

      // Normalizar a UTC
      const eventDate = new Date(`${currentDate} ${time}`);
      const timeUTC = eventDate.toISOString();

      events.push({ timeUTC, currency, impact, event: eventName, actual, forecast, previous });
    });

    // Guardar calendario y actualizar estado
    await saveJsonFile(config.CALENDAR_FILE, { lastUpdate: new Date().toISOString(), events });
    state.lastUpdate = new Date().toISOString();
    state.etag = response.headers.etag || null;
    state.status = 'idle';
    await saveJsonFile(config.STATE_FILE, state);

    logger.info(`Calendario actualizado con ${events.length} eventos.`);
  } catch (error) {
    logger.error('Fallo el fetch del calendario económico.', error.originalError || error);
    state.status = 'error';
    await saveJsonFile(config.STATE_FILE, state);
  }
}

/**
 * Obtiene eventos de alto impacto que ocurrirán en una ventana de tiempo futura.
 * @param {number} windowMinutes - La ventana de tiempo en minutos desde ahora.
 * @returns {Promise<Array>} - Un array de eventos de alto impacto.
 */
async function getUpcomingHighImpactEvents(windowMinutes = 60) {
  if (!(await fileExists(config.CALENDAR_FILE))) {
    logger.warn('Archivo de calendario no encontrado, intentando hacer fetch...');
    await fetchEconomicCalendar();
  }

  try {
    const { events } = await readJsonFile(config.CALENDAR_FILE);
    const now = new Date();
    const futureLimit = new Date(now.getTime() + windowMinutes * 60000);

    return events.filter(event => {
      const eventDate = new Date(event.timeUTC);
      return event.impact === 'high' && eventDate > now && eventDate <= futureLimit;
    });
  } catch (error) {
    logger.error('No se pudieron obtener los eventos próximos.', error);
    return [];
  }
}

/**
 * Inicializa el módulo de scraping.
 */
async function initScraping() {
  await loadState();
  await fetchEconomicCalendar();
  setInterval(fetchEconomicCalendar, config.CHECK_INTERVAL);
  logger.info('Módulo de scraping inicializado y programado.');
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initScraping,
  getUpcomingHighImpactEvents,
  // Para pruebas o control manual
  _fetchEconomicCalendar: fetchEconomicCalendar,
};
