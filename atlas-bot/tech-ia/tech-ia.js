/**
 * tech-ia.js - Módulo de Análisis Técnico para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Analizar indicadores técnicos en tiempo real.
 * - Generar señales basadas en RSI, EMA, MACD y otros indicadores.
 * - Persistir el estado en disco.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { EMA, RSI, MACD } = require('technicalindicators');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'tech-ia-state.json'),
  LOG_FILE: path.join(__dirname, 'tech-ia.log'),
  INDICATORS: {
    EMA: { period: 14, values: [] },
    RSI: { period: 14, values: [] },
    MACD: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, values: [] },
  },
  THRESHOLDS: {
    RSI_OVERBOUGHT: 70,
    RSI_OVERSOLD: 30,
    MACD_BUY: 0,
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
  signals: [],
  indicators: {
    EMA: { values: [] },
    RSI: { values: [] },
    MACD: { values: [] },
  },
  currentSignal: null,
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.lastUpdate = saved.lastUpdate || null;
      state.signals = saved.signals || [];
      state.indicators = saved.indicators || {
        EMA: { values: [] },
        RSI: { values: [] },
        MACD: { values: [] },
      };
      state.currentSignal = saved.currentSignal || null;

      logger.info(`🟢 Tech-IA: Estado cargado. ${state.signals.length} señales procesadas.`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 Tech-IA: Estado inicial creado.');
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

// === ACTUALIZAR INDICADORES ===
function updateIndicators(price) {
  try {
    // Actualizar EMA
    const emaInput = { period: config.INDICATORS.EMA.period, values: [...state.indicators.EMA.values, price] };
    const emaResult = EMA.calculate(emaInput);
    state.indicators.EMA.values = emaResult.slice(-config.INDICATORS.EMA.period);

    // Actualizar RSI
    if (state.indicators.RSI.values.length >= config.INDICATORS.RSI.period) {
      const rsiInput = { period: config.INDICATORS.RSI.period, values: state.indicators.RSI.values };
      const rsiResult = RSI.calculate(rsiInput);
      state.indicators.RSI.current = rsiResult[rsiResult.length - 1];
    }
    state.indicators.RSI.values.push(price);
    if (state.indicators.RSI.values.length > config.INDICATORS.RSI.period * 2) {
      state.indicators.RSI.values = state.indicators.RSI.values.slice(-config.INDICATORS.RSI.period * 2);
    }

    // Actualizar MACD
    const macdInput = {
      values: [...state.indicators.MACD.values, price],
      fastPeriod: config.INDICATORS.MACD.fastPeriod,
      slowPeriod: config.INDICATORS.MACD.slowPeriod,
      signalPeriod: config.INDICATORS.MACD.signalPeriod,
    };
    const macdResult = MACD.calculate(macdInput);
    if (macdResult.length > 0) {
      state.indicators.MACD.current = macdResult[macdResult.length - 1];
    }
    state.indicators.MACD.values.push(price);
    if (state.indicators.MACD.values.length > 100) {
      state.indicators.MACD.values = state.indicators.MACD.values.slice(-100);
    }

    await saveState();
    logger.debug(`📊 Tech-IA: Indicadores actualizados. Precio: ${price}`);
  } catch (error) {
    logger.error(`❌ Error al actualizar indicadores: ${error.message}`);
  }
}

// === GENERAR SEÑAL ===
function generateSignal() {
  try {
    if (!state.indicators.RSI.current || !state.indicators.MACD.current) {
      logger.warn('⚠️ Tech-IA: Indicadores no listos para generar señal.');
      return null;
    }

    let signal = { action: 'HOLD', confidence: 0.5, timestamp: new Date().toISOString() };

    // Lógica para RSI
    if (state.indicators.RSI.current > config.THRESHOLDS.RSI_OVERBOUGHT) {
      signal.action = 'PUT';
      signal.confidence = 0.8;
      signal.reason = `RSI sobrecomprado (${state.indicators.RSI.current.toFixed(2)})`;
    } else if (state.indicators.RSI.current < config.THRESHOLDS.RSI_OVERSOLD) {
      signal.action = 'CALL';
      signal.confidence = 0.8;
      signal.reason = `RSI sobrevendido (${state.indicators.RSI.current.toFixed(2)})`;
    }

    // Lógica para MACD
    if (state.indicators.MACD.current.macd > config.THRESHOLDS.MACD_BUY &&
        state.indicators.MACD.current.signal < config.THRESHOLDS.MACD_BUY) {
      signal.action = 'CALL';
      signal.confidence = Math.max(signal.confidence, 0.7);
      signal.reason = signal.reason ? `${signal.reason} | MACD alcista` : 'MACD alcista';
    } else if (state.indicators.MACD.current.macd < config.THRESHOLDS.MACD_BUY &&
               state.indicators.MACD.current.signal > config.THRESHOLDS.MACD_BUY) {
      signal.action = 'PUT';
      signal.confidence = Math.max(signal.confidence, 0.7);
      signal.reason = signal.reason ? `${signal.reason} | MACD bajista` : 'MACD bajista';
    }

    // Lógica para EMA (simplificada)
    if (state.indicators.EMA.values.length >= config.INDICATORS.EMA.period) {
      const lastPrice = state.indicators.EMA.values[state.indicators.EMA.values.length - 1];
      const emaValue = state.indicators.EMA.values[state.indicators.EMA.values.length - 2];
      if (lastPrice > emaValue && signal.action !== 'PUT') {
        signal.confidence = Math.min(1.0, signal.confidence + 0.1);
      } else if (lastPrice < emaValue && signal.action !== 'CALL') {
        signal.confidence = Math.min(1.0, signal.confidence + 0.1);
      }
    }

    // Registrar señal
    state.signals.push(signal);
    state.currentSignal = signal;
    await saveState();

    logger.info(`🎯 Tech-IA: Señal generada. Acción: ${signal.action}. Confianza: ${signal.confidence.toFixed(2)}. Razón: ${signal.reason || 'N/A'}`);
    return signal;
  } catch (error) {
    logger.error(`❌ Error al generar señal: ${error.message}`);
    return null;
  }
}

// === OBTENER SEÑAL ACTUAL ===
function getCurrentSignal() {
  if (!state.currentSignal) {
    return { action: 'HOLD', confidence: 0.5, reason: 'No hay señal generada' };
  }
  return state.currentSignal;
}

// === INICIALIZAR MÓDULO ===
async function initTechIA() {
  await loadState();
  logger.info('🟢 Tech-IA: Módulo de análisis técnico iniciado.');
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initTechIA,
  updateIndicators,
  generateSignal,
  getCurrentSignal,
  getState: () => ({ ...state }),
};
