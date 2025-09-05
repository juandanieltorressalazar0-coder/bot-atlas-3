/**
 * news-filter.js - Módulo de Filtro de Noticias para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Filtrar operaciones durante ventanas de noticias de alto impacto.
 * - Monitorear el calendario económico en tiempo real.
 * - Bloquear operaciones 2 minutos antes y 3 minutos después de eventos de alto impacto.
 * - Persistir estado en disco.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const axios = require('axios');
const cheerio = require('cheerio');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'news-filter-state.json'),
  LOG_FILE: path.join(__dirname, 'news-filter.log'),
  CALENDAR_URL: 'https://www.forexfactory.com/calendar',
  BLOCK_WINDOW: 5, // Minutos antes y después de un evento de alto impacto para bloquear operaciones
  HIGH_IMPACT_CURRENCIES: ['USD', 'EUR', 'GBP', 'JPY'], // Monedas de alto impacto
  CHECK_INTERVAL: 60000, // 1 minuto en milisegundos
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
  isNewsWindowActive: false,
  currentEvent: null,
  nextCheck: null,
  lastUpdate: null,
  events: [],
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.isNewsWindowActive = saved.isNewsWindowActive || false;
      state.currentEvent = saved.currentEvent || null;
      state.nextCheck = saved.nextCheck || null;
      state.lastUpdate = saved.lastUpdate || null;
      state.events = saved.events || [];

      logger.info(`🟢 NewsFilter: Estado cargado. Ventana activa: ${state.isNewsWindowActive}`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 NewsFilter: Estado inicial creado.');
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar estado de news-filter: ${error.message}`);
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
    logger.info('🔍 NewsFilter: Obteniendo calendario económico de Forex Factory...');

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
          startTime: calculateEventTime(time, -config.BLOCK_WINDOW),
          endTime: calculateEventTime(time, config.BLOCK_WINDOW),
        });
      }
    });

    // Ordenar eventos por tiempo
    events.sort((a, b) => {
      return new Date(`1970/01/01 ${a.time}`) - new Date(`1970/01/01 ${b.time}`);
    });

    state.events = events;
    await saveState();

    logger.info(`📅 NewsFilter: ${events.length} eventos de alto impacto encontrados.`);
    return events;
  } catch (error) {
    logger.error(`❌ NewsFilter: Error al obtener calendario económico: ${error.message}`);
    throw error;
  }
}

// === CALCULAR HORA DE INICIO/FIN DE VENTANA DE BLOQUEO ===
function calculateEventTime(eventTime, offsetMinutes) {
  const [hours, minutes] = eventTime.split(':').map(Number);
  const eventDate = new Date();
  eventDate.setHours(hours, minutes + offsetMinutes, 0, 0);
  return eventDate.toISOString();
}

// === VERIFICAR VENTANA DE NOTICIAS ACTIVA ===
function checkNewsWindow() {
  const now = new Date();

  // Buscar eventos activos
  const activeEvent = state.events.find(event => {
    const startTime = new Date(event.startTime);
    const endTime = new Date(event.endTime);
    return now >= startTime && now <= endTime;
  });

  if (activeEvent) {
    if (!state.isNewsWindowActive) {
      state.isNewsWindowActive = true;
      state.currentEvent = activeEvent;
      logger.warn(`⚠️ NewsFilter: VENTANA DE NOTICIAS ACTIVA por ${activeEvent.event} (${activeEvent.currency}). Operaciones bloqueadas.`);
    }
  } else {
    if (state.isNewsWindowActive) {
      state.isNewsWindowActive = false;
      state.currentEvent = null;
      logger.info('✅ NewsFilter: Ventana de noticias finalizada. Operaciones permitidas.');
    }
  }

  // Programar próxima verificación
  const nextEvent = state.events.find(event => new Date(event.startTime) > now);
  state.nextCheck = nextEvent ? new Date(nextEvent.startTime) : null;

  await saveState();
}

// === OBTENER ESTADO ACTUAL ===
function getCurrentStatus() {
  checkNewsWindow();
  return {
    isNewsWindowActive: state.isNewsWindowActive,
    currentEvent: state.currentEvent,
    nextCheck: state.nextCheck,
    lastUpdate: state.lastUpdate,
  };
}

// === ACTUALIZAR CALENDARIO ===
async function updateCalendar() {
  try {
    await fetchEconomicCalendar();
    checkNewsWindow();
  } catch (error) {
    logger.error(`❌ NewsFilter: Error al actualizar calendario: ${error.message}`);
  }
}

// === INICIALIZAR MÓDULO ===
async function initNewsFilter() {
  await loadState();
  await updateCalendar();
  logger.info('🟢 NewsFilter: Módulo iniciado. Ventana activa: ' + state.isNewsWindowActive);

  // Actualizar calendario periódicamente
  setInterval(updateCalendar, config.CHECK_INTERVAL);
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initNewsFilter,
  updateCalendar,
  getCurrentStatus,
  getState: () => ({ ...state }),
};
