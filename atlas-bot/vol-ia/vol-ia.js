/**
 * vol-ia.js - Módulo de Análisis de Volatilidad para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Analizar la volatilidad del mercado en tiempo real.
 * - Proporcionar señales basadas en cambios de volatilidad.
 * - Persistir el estado en disco.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { StandardDeviation } = require('ml-stat');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'vol-ia-state.json'),
  LOG_FILE: path.join(__dirname, 'vol-ia.log'),
  WINDOW_SIZE: 20, // Número de precios para calcular volatilidad
  VOLATILITY_LEVELS: {
    LOW: 0.005,   // 0.5%
    MEDIUM: 0.01, // 1%
    HIGH: 0.02,   // 2%
  },
  PAIR: 'EURUSD',
  TIMEFRAME: '1m',
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
  priceHistory: [],
  currentVolatility: 0,
  volatilityLevel: 'medium', // low, medium, high
  signals: [],
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.lastUpdate = saved.lastUpdate || null;
      state.priceHistory = saved.priceHistory || [];
      state.currentVolatility = saved.currentVolatility || 0;
      state.volatilityLevel = saved.volatilityLevel || 'medium';
      state.signals = saved.signals || [];

      logger.info(`🟢 Vol-IA: Estado cargado. Volatilidad actual: ${state.volatilityLevel}`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 Vol-IA: Estado inicial creado.');
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

// === ACTUALIZAR HISTORIAL DE PRECIOS ===
function updatePriceHistory(price) {
  try {
    state.priceHistory.push(price);

    // Mantener solo los últimos WINDOW_SIZE precios
    if (state.priceHistory.length > config.WINDOW_SIZE) {
      state.priceHistory = state.priceHistory.slice(-config.WINDOW_SIZE);
    }

    // Calcular volatilidad si hay suficientes datos
    if (state.priceHistory.length >= config.WINDOW_SIZE) {
      calculateVolatility();
    }

    await saveState();
    logger.debug(`📊 Vol-IA: Precio actualizado: ${price}`);
  } catch (error) {
    logger.error(`❌ Error al actualizar historial de precios: ${error.message}`);
  }
}

// === CALCULAR VOLATILIDAD ===
function calculateVolatility() {
  try {
    if (state.priceHistory.length < config.WINDOW_SIZE) {
      logger.warn('⚠️ Vol-IA: No hay suficientes datos para calcular volatilidad.');
      return;
    }

    // Calcular retornos logarítmicos
    const logReturns = [];
    for (let i = 1; i < state.priceHistory.length; i++) {
      const ret = Math.log(state.priceHistory[i] / state.priceHistory[i - 1]);
      logReturns.push(ret);
    }

    // Calcular desviación estándar de los retornos
    const stdDev = StandardDeviation(logReturns);
    state.currentVolatility = stdDev;

    // Determinar nivel de volatilidad
    if (stdDev < config.VOLATILITY_LEVELS.LOW) {
      state.volatilityLevel = 'low';
    } else if (stdDev < config.VOLATILITY_LEVELS.MEDIUM) {
      state.volatilityLevel = 'medium';
    } else {
      state.volatilityLevel = 'high';
    }

    await saveState();
    logger.info(`📈 Vol-IA: Volatilidad calculada: ${stdDev.toFixed(6)} (${state.volatilityLevel})`);
  } catch (error) {
    logger.error(`❌ Error al calcular volatilidad: ${error.message}`);
  }
}

// === GENERAR SEÑAL ===
function generateSignal() {
  try {
    if (state.priceHistory.length < config.WINDOW_SIZE) {
      logger.warn('⚠️ Vol-IA: No hay suficientes datos para generar señal.');
      return null;
    }

    let signal = {
      volatility: state.volatilityLevel,
      value: state.currentVolatility,
      timestamp: new Date().toISOString(),
    };

    // Generar recomendación basada en volatilidad
    if (state.volatilityLevel === 'high') {
      signal.recommendation = 'reduce_lot_size';
      signal.confidence = 0.9;
      signal.reason = 'Volatilidad alta detectada';
    } else if (state.volatilityLevel === 'low') {
      signal.recommendation = 'increase_lot_size';
      signal.confidence = 0.7;
      signal.reason = 'Volatilidad baja detectada';
    } else {
      signal.recommendation = 'maintain_lot_size';
      signal.confidence = 0.8;
      signal.reason = 'Volatilidad media detectada';
    }

    // Registrar señal
    state.signals.push(signal);
    await saveState();

    logger.info(`🎯 Vol-IA: Señal generada. Volatilidad: ${state.volatilityLevel}. Recomendación: ${signal.recommendation}`);
    return signal;
  } catch (error) {
    logger.error(`❌ Error al generar señal: ${error.message}`);
    return null;
  }
}

// === OBTENER SEÑAL ACTUAL ===
function getCurrentSignal() {
  if (state.signals.length === 0) {
    return {
      volatility: 'medium',
      value: 0,
      recommendation: 'maintain_lot_size',
      confidence: 0.5,
      reason: 'No hay datos suficientes',
    };
  }
  return state.signals[state.signals.length - 1];
}

// === INICIALIZAR MÓDULO ===
async function initVolIA() {
  await loadState();
  logger.info('🟢 Vol-IA: Módulo de análisis de volatilidad iniciado.');
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initVolIA,
  updatePriceHistory,
  calculateVolatility,
  generateSignal,
  getCurrentSignal,
  getState: () => ({ ...state }),
};
