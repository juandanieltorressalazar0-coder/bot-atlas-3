/**
 * exec-ia.js - Módulo de Ejecución de Operaciones (Versión Refactorizada)
 *
 * Función:
 * - Abstraer la lógica de ejecución de operaciones, soportando modo real y de simulación.
 * - Conectar con el broker (IQ Option) en modo real.
 * - Simular operaciones en modo de backtesting.
 * - Gestionar el estado de las operaciones abiertas.
 */

require('dotenv').config();
const path = require('path');
const { saveJsonFile, readJsonFile, fileExists, setupLogger } = require('../utils/helpers');

// === CONFIGURACIÓN ===
const config = {
  // Valores por defecto que pueden ser sobreescritos por la función init
  backtestMode: process.env.BACKTEST_MODE === 'true',
  email: process.env.IQ_OPTION_EMAIL,
  password: process.env.IQ_OPTION_PASSWORD,
  stateFilePath: path.join(__dirname, 'exec-ia-state.json'),
};

const logger = setupLogger('exec-ia', path.join(__dirname, 'logs', 'exec-ia.log'));

// === ESTADO Y CONEXIÓN ===
let state = {
  openTrades: [],
};
let iqOptionClient = null;
let IqOption; // Se cargará dinámicamente

/**
 * Carga dinámicamente la librería de IQ Option que es un ES Module.
 */
async function loadIqOptionLibrary() {
  if (IqOption) return;
  try {
    const module = await import('@mvh/iqoption');
    console.log('Inspecting @mvh/iqoption module:', module);
    IqOption = module.default; // Probable fix: ES modules often use a default export
  } catch (error) {
    logger.error('No se pudo cargar la librería @mvh/iqoption. Asegúrate de que está instalada.', error);
    throw error;
  }
}

/**
 * Inicializa el módulo de ejecución.
 * Carga el estado y, si no está en modo backtest, conecta con el broker.
 */
async function init(options = {}) {
  // Sobrescribir config por defecto con las opciones pasadas
  config.backtestMode = options.backtestMode !== undefined ? options.backtestMode : config.backtestMode;

  await loadState();

  if (!config.backtestMode) {
    try {
      await loadIqOptionLibrary();
      logger.info('Modo LIVE: Conectando a IQ Option...');
      iqOptionClient = new IqOption(config.email, config.password);
      await iqOptionClient.connect();
      logger.info('Conectado a IQ Option con éxito.');
    } catch (error) {
      logger.error('Fallo catastrófico al conectar con IQ Option.', error);
      // Re-lanzar el error para que el orquestador principal decida cómo manejarlo.
      throw error;
    }
  } else {
    logger.info('Modo BACKTEST: El módulo de ejecución no se conectará al broker.');
  }
}

/**
 * Coloca una nueva operación (real o simulada).
 * @param {{symbol: string, direction: 'CALL'|'PUT', stake: number, expiryMinutes: number}} tradeParams
 * @returns {Promise<string>} El ID de la operación colocada.
 */
async function placeTrade({ symbol, direction, stake, expiryMinutes }) {
  const trade = {
    symbol,
    direction,
    stake,
    placedAt: new Date().toISOString(),
    expiryAt: new Date(Date.now() + expiryMinutes * 60000).toISOString(),
    status: 'open',
  };

  if (config.backtestMode) {
    trade.tradeId = `sim-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    logger.info(`[BACKTEST] Simulando operación: ${trade.tradeId} para ${symbol}.`);
  } else {
    if (!iqOptionClient || !iqOptionClient.isConnected) {
      throw new Error('No conectado a IQ Option. Imposible colocar operación real.');
    }
    try {
      const result = await iqOptionClient.buy(stake, symbol, direction, expiryMinutes);
      trade.tradeId = result.id;
      logger.info(`[LIVE] Operación real colocada: ${trade.tradeId} para ${symbol}.`);
    } catch (error) {
      logger.error('Fallo al colocar operación real en IQ Option.', error);
      throw error; // Re-lanzar para que el orquestador lo maneje.
    }
  }

  state.openTrades.push(trade);
  await saveState();
  return trade.tradeId;
}

/**
 * Verifica el resultado de una operación abierta.
 * @param {object} trade - El objeto de la operación a verificar.
 * @returns {Promise<{status: 'open'|'closed', result?: 'win'|'loss', profit?: number}>}
 */
async function checkTradeResult(trade) {
  if (new Date() < new Date(trade.expiryAt)) {
    return { status: 'open' }; // La operación aún no ha expirado.
  }

  if (config.backtestMode) {
    // Simulación simple: 50% de probabilidad de ganar.
    const isWin = Math.random() < 0.5;
    const profit = isWin ? trade.stake * 0.85 : -trade.stake; // Asumir un payout del 85%
    logger.info(`[BACKTEST] Resultado de ${trade.tradeId}: ${isWin ? 'win' : 'loss'}`);
    return { status: 'closed', result: isWin ? 'win' : 'loss', profit };
  } else {
    if (!iqOptionClient) throw new Error('No conectado a IQ Option.');
    try {
      const result = await iqOptionClient.getTradeResult(trade.tradeId);
      logger.info(`[LIVE] Resultado de ${trade.tradeId}: ${result.result}`);
      return { status: 'closed', result: result.result, profit: result.profit };
    } catch (error) {
      logger.error(`Fallo al verificar resultado de ${trade.tradeId}.`, error);
      // Si falla la API, asumimos que sigue abierta para reintentar.
      return { status: 'open' };
    }
  }
}

/**
 * Carga el estado desde exec-ia-state.json
 */
async function loadState() {
  if (await fileExists(config.stateFilePath)) {
    try {
      const loadedState = await readJsonFile(config.stateFilePath);
      state = { ...state, ...loadedState };
      logger.info(`Estado de ejecución cargado. ${state.openTrades.length} operaciones abiertas.`);
    } catch (error) {
      logger.error('No se pudo cargar el estado de ejecución.', error);
    }
  }
}

/**
 * Guarda el estado en exec-ia-state.json
 */
async function saveState() {
  await saveJsonFile(config.stateFilePath, state);
}

module.exports = {
  init,
  placeTrade,
  checkTradeResult,
  // Exportar para que el orquestador pueda acceder a las operaciones abiertas.
  getOpenTrades: () => state.openTrades,
  // Exportar para actualizar el estado después de cerrar una operación.
  removeTrade: async (tradeId) => {
    state.openTrades = state.openTrades.filter(t => t.tradeId !== tradeId);
    await saveState();
  },
};
