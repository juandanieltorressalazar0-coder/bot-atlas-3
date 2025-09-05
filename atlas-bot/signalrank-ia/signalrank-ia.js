/**
 * signalrank-ia.js - Módulo de Fusión de Señales para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Recibir señales de múltiples fuentes.
 * - Filtrar y fusionar señales para mejorar la confianza.
 * - Proporcionar una señal consolidada para la ejecución.
 * - Persistir el estado en disco.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'signalrank-ia-state.json'),
  LOG_FILE: path.join(__dirname, 'signalrank-ia.log'),
  MIN_CONFIDENCE: 0.7, // Confianza mínima para aceptar una señal
  MAX_SIGNAL_AGE: 300000, // 5 minutos en milisegundos
  SOURCES: ['geo-eur', 'geo-usa', 'tech-ia', 'sent-ia', 'vol-ia'],
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
  totalSignals: 0,
  filteredOut: 0,
  confidenceHistory: [],
  lastUpdate: null,
  avgConfidence: 0.5,
  bestSignal: null,
  worstSignal: null,
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.totalSignals = saved.totalSignals || 0;
      state.filteredOut = saved.filteredOut || 0;
      state.confidenceHistory = saved.confidenceHistory || [];
      state.lastUpdate = saved.lastUpdate || null;
      state.avgConfidence = saved.avgConfidence || 0.5;
      state.bestSignal = saved.bestSignal || null;
      state.worstSignal = saved.worstSignal || null;

      logger.info(`🟢 SignalRank-IA: Estado cargado. Señales procesadas: ${state.totalSignals}`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 SignalRank-IA: Estado inicial creado.');
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

// === PROCESAR SEÑAL ===
function processSignal(signal) {
  try {
    state.totalSignals++;

    // Validar señal
    if (!signal || !signal.action || !signal.source || signal.confidence === undefined) {
      state.filteredOut++;
      logger.warn(`⚠️ SignalRank-IA: Señal inválida de ${signal.source}. Filtrada.`);
      return null;
    }

    // Validar edad de la señal
    const signalAge = Date.now() - new Date(signal.timestamp).getTime();
    if (signalAge > config.MAX_SIGNAL_AGE) {
      state.filteredOut++;
      logger.warn(`⚠️ SignalRank-IA: Señal de ${signal.source} demasiado antigua (${signalAge}ms). Filtrada.`);
      return null;
    }

    // Validar confianza mínima
    if (signal.confidence < config.MIN_CONFIDENCE) {
      state.filteredOut++;
      logger.warn(`⚠️ SignalRank-IA: Señal de ${signal.source} con baja confianza (${signal.confidence}). Filtrada.`);
      return null;
    }

    // Registrar confianza en el historial
    state.confidenceHistory.push(signal.confidence);

    // Actualizar mejor y peor señal
    if (!state.bestSignal || signal.confidence > state.bestSignal.confidence) {
      state.bestSignal = signal;
    }
    if (!state.worstSignal || signal.confidence < state.worstSignal.confidence) {
      state.worstSignal = signal;
    }

    // Calcular confianza promedio
    const totalConfidence = state.confidenceHistory.reduce((sum, conf) => sum + conf, 0);
    state.avgConfidence = totalConfidence / state.confidenceHistory.length;

    await saveState();
    logger.info(`📊 SignalRank-IA: Señal procesada de ${signal.source}. Acción: ${signal.action}. Confianza: ${signal.confidence}`);

    return signal;
  } catch (error) {
    logger.error(`❌ Error al procesar señal: ${error.message}`);
    return null;
  }
}

// === FUSIONAR SEÑALES ===
function fuseSignals(signals) {
  try {
    if (!signals || signals.length === 0) {
      logger.warn('⚠️ SignalRank-IA: No hay señales para fusionar.');
      return null;
    }

    // Filtrar señales válidas
    const validSignals = signals.filter(signal => signal !== null);

    if (validSignals.length === 0) {
      logger.warn('⚠️ SignalRank-IA: Todas las señales fueron filtradas.');
      return null;
    }

    // Calcular confianza promedio ponderada
    const totalWeightedConfidence = validSignals.reduce((sum, signal) => {
      let weight = 1.0;
      if (signal.source === 'tech-ia') weight = 1.2; // Mayor peso para señales técnicas
      return sum + (signal.confidence * weight);
    }, 0);

    const totalWeight = validSignals.reduce((sum, signal) => {
      return sum + (signal.source === 'tech-ia' ? 1.2 : 1.0);
    }, 0);

    const avgConfidence = totalWeightedConfidence / totalWeight;

    // Determinar acción predominante
    const callCount = validSignals.filter(signal => signal.action === 'CALL').length;
    const putCount = validSignals.filter(signal => signal.action === 'PUT').length;
    const action = callCount >= putCount ? 'CALL' : 'PUT';

    // Crear señal fusionada
    const fusedSignal = {
      action,
      confidence: avgConfidence,
      source: 'signalrank-ia',
      timestamp: new Date().toISOString(),
      details: {
        signals: validSignals,
        callCount,
        putCount,
      },
    };

    // Procesar la señal fusionada
    processSignal(fusedSignal);

    logger.info(`🔀 SignalRank-IA: Señal fusionada. Acción: ${action}. Confianza: ${avgConfidence.toFixed(2)}`);
    return fusedSignal;
  } catch (error) {
    logger.error(`❌ Error al fusionar señales: ${error.message}`);
    return null;
  }
}

// === OBTENER ESTADO ACTUAL ===
function getCurrentState() {
  return {
    totalSignals: state.totalSignals,
    filteredOut: state.filteredOut,
    avgConfidence: state.avgConfidence,
    bestSignal: state.bestSignal,
    worstSignal: state.worstSignal,
    lastUpdate: state.lastUpdate,
  };
}

// === INICIALIZAR MÓDULO ===
async function initSignalRankIA() {
  await loadState();
  logger.info('🟢 SignalRank-IA: Módulo de fusión de señales iniciado.');
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initSignalRankIA,
  processSignal,
  fuseSignals,
  getCurrentState,
  getState: () => ({ ...state }),
};
