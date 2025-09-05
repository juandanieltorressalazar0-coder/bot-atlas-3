/**
 * riskmap-ia.js - Módulo de Gestión de Riesgo para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Gestionar el riesgo de las operaciones.
 * - Pausar el bot después de 3 pérdidas consecutivas.
 * - Limitar el tamaño de las operaciones al 10% del balance.
 * - Monitorear el drawdown máximo.
 * - Persistir el estado en disco.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'riskmap-ia-state.json'),
  LOG_FILE: path.join(__dirname, 'riskmap-ia.log'),
  MAX_LOSS_STREAK: 3, // Número máximo de pérdidas consecutivas antes de pausar
  PAUSE_DURATION: 15, // Minutos de pausa después de alcanzar MAX_LOSS_STREAK
  RISK_PERCENT: 0.10, // 10% del balance por operación
  MAX_DRAWDOWN_PERCENT: 0.20, // 20% de drawdown máximo permitido
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
  isPaused: false,
  lossesInRow: 0,
  tradeCount: 0,
  maxLossStreak: 0,
  pauseUntil: null,
  lastUpdate: null,
  balance: 0,
  initialBalance: 0,
  maxDrawdown: 0,
  maxDrawdownPercent: 0,
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.isPaused = saved.isPaused || false;
      state.lossesInRow = saved.lossesInRow || 0;
      state.tradeCount = saved.tradeCount || 0;
      state.maxLossStreak = saved.maxLossStreak || 0;
      state.pauseUntil = saved.pauseUntil || null;
      state.lastUpdate = saved.lastUpdate || null;
      state.balance = saved.balance || 0;
      state.initialBalance = saved.initialBalance || 0;
      state.maxDrawdown = saved.maxDrawdown || 0;
      state.maxDrawdownPercent = saved.maxDrawdownPercent || 0;

      logger.info(`🟢 RiskMap-IA: Estado cargado. Pérdidas consecutivas: ${state.lossesInRow}/${config.MAX_LOSS_STREAK}`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 RiskMap-IA: Estado inicial creado.');
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar estado de riskmap-ia: ${error.message}`);
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

// === ACTUALIZAR BALANCE ===
async function updateBalance(newBalance) {
  try {
    const previousBalance = state.balance;
    state.balance = newBalance;

    // Calcular drawdown
    const drawdown = previousBalance - newBalance;
    const drawdownPercent = drawdown / state.initialBalance;

    if (drawdown > state.maxDrawdown) {
      state.maxDrawdown = drawdown;
      state.maxDrawdownPercent = drawdownPercent;
      logger.warn(`⚠️ RiskMap-IA: Nuevo drawdown máximo: $${drawdown.toFixed(2)} (${(drawdownPercent * 100).toFixed(1)}%)`);
    }

    // Verificar si se supera el drawdown máximo permitido
    if (drawdownPercent > config.MAX_DRAWDOWN_PERCENT) {
      state.isPaused = true;
      state.pauseUntil = new Date(Date.now() + 3600000).toISOString(); // Pausar 1 hora
      logger.error(`🛑 RiskMap-IA: Drawdown máximo superado (${(drawdownPercent * 100).toFixed(1)}%). Bot pausado por 1 hora.`);
    }

    await saveState();
  } catch (error) {
    logger.error(`❌ Error al actualizar balance: ${error.message}`);
  }
}

// === REGISTRAR OPERACIÓN ===
async function registerTrade(result) {
  try {
    state.tradeCount++;

    if (result === 'loss') {
      state.lossesInRow++;
      if (state.lossesInRow > state.maxLossStreak) {
        state.maxLossStreak = state.lossesInRow;
      }

      // Verificar si se alcanza el máximo de pérdidas consecutivas
      if (state.lossesInRow >= config.MAX_LOSS_STREAK) {
        state.isPaused = true;
        state.pauseUntil = new Date(Date.now() + config.PAUSE_DURATION * 60000).toISOString();
        logger.warn(`⏸️ RiskMap-IA: ${config.MAX_LOSS_STREAK} pérdidas consecutivas. Bot pausado por ${config.PAUSE_DURATION} minutos.`);
      }
    } else {
      state.lossesInRow = 0;
    }

    await saveState();
  } catch (error) {
    logger.error(`❌ Error al registrar operación: ${error.message}`);
  }
}

// === VERIFICAR ESTADO ACTUAL ===
function checkStatus() {
  if (state.isPaused) {
    const now = new Date();
    const pauseUntil = new Date(state.pauseUntil);

    if (now >= pauseUntil) {
      state.isPaused = false;
      state.pauseUntil = null;
      state.lossesInRow = 0;
      logger.info('▶️ RiskMap-IA: Pausa finalizada. Bot reanudado.');
      saveState();
    }
  }

  return {
    isPaused: state.isPaused,
    pauseUntil: state.pauseUntil,
    lossesInRow: state.lossesInRow,
    maxLossStreak: state.maxLossStreak,
    tradeCount: state.tradeCount,
    balance: state.balance,
    maxDrawdown: state.maxDrawdown,
    maxDrawdownPercent: state.maxDrawdownPercent,
  };
}

// === INICIALIZAR BALANCE ===
async function initBalance(initialBalance) {
  try {
    state.balance = initialBalance;
    state.initialBalance = initialBalance;
    await saveState();
    logger.info(`💰 RiskMap-IA: Balance inicial establecido en $${initialBalance.toFixed(2)}`);
  } catch (error) {
    logger.error(`❌ Error al inicializar balance: ${error.message}`);
  }
}

// === INICIALIZAR MÓDULO ===
async function initRiskMapIA() {
  await loadState();
  logger.info('🟢 RiskMap-IA: Módulo de gestión de riesgo iniciado.');
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initRiskMapIA,
  initBalance,
  updateBalance,
  registerTrade,
  checkStatus,
  getState: () => ({ ...state }),
};
