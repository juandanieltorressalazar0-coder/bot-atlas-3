/**
 * helpers-ia.js - Funciones de utilidad para los módulos de IA de Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Proporcionar funciones reutilizables para análisis técnico, manejo de datos y utilidades generales.
 * - Facilitar la integración entre módulos.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

// === FUNCIONES DE MANEJO DE ARCHIVOS ===

/**
 * Verificar si existe un archivo.
 * @param {string} filePath Ruta del archivo.
 * @returns {Promise<boolean>} True si existe, false si no.
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Leer un archivo JSON.
 * @param {string} filePath Ruta del archivo.
 * @returns {Promise<object>} Contenido del archivo JSON.
 */
async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Error al leer ${filePath}: ${error.message}`);
  }
}

/**
 * Guardar un archivo JSON.
 * @param {string} filePath Ruta del archivo.
 * @param {object} data Datos a guardar.
 * @returns {Promise<void>}
 */
async function saveJsonFile(filePath, data) {
  try {
    const tempFile = `${filePath}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, filePath);
  } catch (error) {
    throw new Error(`Error al guardar ${filePath}: ${error.message}`);
  }
}

// === FUNCIONES DE ANÁLISIS TÉCNICO ===

/**
 * Calcular el RSI (Relative Strength Index).
 * @param {number[]} prices Array de precios.
 * @param {number} period Período para el cálculo.
 * @returns {number} Valor del RSI.
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period) {
    throw new Error(`Se necesitan al menos ${period} precios para calcular RSI.`);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calcular la media móvil exponencial (EMA).
 * @param {number[]} prices Array de precios.
 * @param {number} period Período para el cálculo.
 * @returns {number} Valor de la EMA.
 */
function calculateEMA(prices, period = 14) {
  if (prices.length < period) {
    throw new Error(`Se necesitan al menos ${period} precios para calcular EMA.`);
  }

  const smoothing = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * smoothing + ema;
  }

  return ema;
}

/**
 * Calcular el MACD (Moving Average Convergence Divergence).
 * @param {number[]} prices Array de precios.
 * @param {number} fastPeriod Período rápido.
 * @param {number} slowPeriod Período lento.
 * @param {number} signalPeriod Período de la señal.
 * @returns {object} Objeto con macd, signal y histogram.
 */
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod) {
    throw new Error(`Se necesitan al menos ${slowPeriod} precios para calcular MACD.`);
  }

  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);
  const macdLine = fastEMA - slowEMA;

  const signalLine = calculateEMA([macdLine].flat().filter(v => !isNaN(v)), signalPeriod);
  const histogram = macdLine - signalLine;

  return { macd: macdLine, signal: signalLine, histogram };
}

// === FUNCIONES DE MANEJO DE SEÑALES ===

/**
 * Normalizar confianza de una señal.
 * @param {number} confidence Confianza de la señal.
 * @returns {number} Confianza normalizada entre 0 y 1.
 */
function normalizeConfidence(confidence) {
  return Math.min(1, Math.max(0, confidence));
}

/**
 * Fusionar múltiples señales.
 * @param {object[]} signals Array de señales.
 * @returns {object} Señal fusionada.
 */
function fuseSignals(signals) {
  if (!signals || signals.length === 0) {
    throw new Error('No se proporcionaron señales para fusionar.');
  }

  const validSignals = signals.filter(signal => signal && signal.confidence !== undefined);

  if (validSignals.length === 0) {
    throw new Error('No hay señales válidas para fusionar.');
  }

  const totalConfidence = validSignals.reduce((sum, signal) => sum + signal.confidence, 0);
  const avgConfidence = totalConfidence / validSignals.length;

  const callCount = validSignals.filter(signal => signal.action === 'CALL').length;
  const putCount = validSignals.filter(signal => signal.action === 'PUT').length;

  const action = callCount >= putCount ? 'CALL' : 'PUT';

  return {
    action,
    confidence: normalizeConfidence(avgConfidence),
    source: 'fused',
    signals: validSignals,
  };
}

// === FUNCIONES DE TIEMPO ===

/**
 * Retrasar la ejecución por un tiempo determinado.
 * @param {number} ms Milisegundos de retraso.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Obtener la fecha y hora actual en formato ISO.
 * @returns {string} Fecha y hora actual.
 */
function getCurrentTimestamp() {
  return new Date().toISOString();
}

// === FUNCIONES DE LOGGING ===

/**
 * Configurar un logger estándar.
 * @param {string} moduleName Nombre del módulo.
 * @param {string} logFile Ruta del archivo de log.
 * @returns {object} Instancia de winston logger.
 */
function setupLogger(moduleName, logFile) {
  return winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({ filename: logFile }),
      new winston.transports.Console(),
    ],
    defaultMeta: { module: moduleName },
  });
}

// === EXPORTAR FUNCIONES ===
module.exports = {
  // Manejo de archivos
  fileExists,
  readJsonFile,
  saveJsonFile,

  // Análisis técnico
  calculateRSI,
  calculateEMA,
  calculateMACD,

  // Manejo de señales
  normalizeConfidence,
  fuseSignals,

  // Tiempo
  delay,
  getCurrentTimestamp,

  // Logging
  setupLogger,
};
