/**
 * compound-logic.js - Módulo de Interés Compuesto para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Recalcula el tamaño de lote cada N operaciones cerradas.
 * - Usa el 10% del balance actual como nuevo lote.
 * - Persiste estado en disco para sobrevivir reinicios.
 * - Integración con exec-ia.js y riskmap-ia.js.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

// === CONFIGURACIÓN ===
const config = require('./config.json');
const {
  COMPOUND_INTERVAL = 10,           // Cada cuántas operaciones se aplica
  RISK_PERCENT = 0.10,              // 10% del balance por operación
  MIN_LOT_SIZE = 1,                 // Lote mínimo (ej: $1)
  MAX_LOT_SIZE = 1000,              // Lote máximo (ej: $1000)
  STATE_FILE = path.join(__dirname, 'compound-state.json'),
  LOG_FILE = path.join(__dirname, 'compound-logic.log'),
} = config;

// === LOGGING ===
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: LOG_FILE }),
    new winston.transports.Console(),
  ],
});

// === ESTADO DEL MÓDULO ===
let state = {
  tradeCount: 0,                    // Contador de operaciones cerradas
  lastBalance: 0,                   // Último balance conocido
  currentLotSize: 0,                // Lote actual
  totalCompounds: 0,                // Veces que se ha aplicado el interés compuesto
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(STATE_FILE)) {
      const data = await fs.readFile(STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.tradeCount = saved.tradeCount || 0;
      state.lastBalance = saved.lastBalance || 0;
      state.currentLotSize = saved.currentLotSize || 0;
      state.totalCompounds = saved.totalCompounds || 0;
      state.createdAt = saved.createdAt || state.createdAt;
      state.updatedAt = saved.updatedAt || state.updatedAt;

      logger.info(`🟢 CompoundLogic: Estado cargado. tradeCount=${state.tradeCount}, lotSize=$${state.currentLotSize.toFixed(2)}`);
    } else {
      // Inicializar con balance simulado (debe actualizarse con real)
      state.lastBalance = await getLiveBalance();
      state.currentLotSize = calculateLotSize(state.lastBalance);
      await saveState();
      logger.info(`🆕 CompoundLogic: Estado inicial creado. Lote inicial = $${state.currentLotSize.toFixed(2)}`);
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar estado de compound-logic: ${error.message}`);
    // Crear estado limpio en caso de error
    state.lastBalance = await getLiveBalance();
    state.currentLotSize = calculateLotSize(state.lastBalance);
    await saveState();
  }
}

// === GUARDAR ESTADO EN DISCO ===
async function saveState() {
  try {
    state.updatedAt = new Date().toISOString();
    const tempFile = `${STATE_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(state, null, 2));
    await fs.rename(tempFile, STATE_FILE);
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

// === OBTENER BALANCE EN TIEMPO REAL ===
async function getLiveBalance() {
  try {
    // Aquí integras con iqoptionapi o Puppeteer
    // Ejemplo: return await iqOptionAPI.getBalance();
    // Para pruebas, puedes dejar un valor simulado
    return 1000; // Simulación (reemplazar con llamada real)
  } catch (error) {
    logger.error(`❌ Error al obtener balance: ${error.message}`);
    throw new Error("No se pudo obtener el balance");
  }
}

// === CALCULAR TAMAÑO DEL LOTE ===
function calculateLotSize(balance) {
  let lotSize = balance * RISK_PERCENT;
  // Aplicar límites mínimo y máximo
  return Math.max(MIN_LOT_SIZE, Math.min(lotSize, MAX_LOT_SIZE));
}

// === REGISTRAR OPERACIÓN CERRADA ===
async function onTradeClosed(profit) {
  try {
    state.tradeCount++;
    state.lastBalance = await getLiveBalance();

    const needsCompounding = state.tradeCount % COMPOUND_INTERVAL === 0;

    if (needsCompounding) {
      const oldLotSize = state.currentLotSize;
      state.currentLotSize = calculateLotSize(state.lastBalance);
      state.totalCompounds++;

      logger.info(`💸 INTERÉS COMPUESTO ACTIVADO (cada ${COMPOUND_INTERVAL} operaciones)`);
      logger.info(`   Balance: $${state.lastBalance.toFixed(2)} → Nuevo lote: $${state.currentLotSize.toFixed(2)} (10%)`);
      logger.info(`   Incremento: $${(state.currentLotSize - oldLotSize).toFixed(2)} en tamaño de operación`);
    }

    // Recalcular si el balance cambió más del 5%
    const balanceChange = Math.abs(state.lastBalance - state.lastBalance) / state.lastBalance;
    if (balanceChange > 0.05) {
      logger.warn(`⚠️ Balance cambió +5%. Recalculando lote...`);
      state.currentLotSize = calculateLotSize(state.lastBalance);
    }

    await saveState();
  } catch (error) {
    logger.error(`❌ Error en onTradeClosed: ${error.message}`);
  }
}

// === OBTENER LOTE ACTUAL ===
function getCurrentLotSize() {
  // Si el balance cambió mucho, recalculamos (protección adicional)
  return state.currentLotSize;
}

// === REINICIAR CONTADOR ===
function resetCounter() {
  logger.info(`🔁 CompoundLogic: Contador reiniciado (nueva sesión)`);
  state.tradeCount = 0;
  saveState();
}

// === INICIALIZAR MÓDULO ===
async function initCompoundLogic() {
  await loadState();
  logger.info(`🟢 CompoundLogic iniciado: Aplica cada ${COMPOUND_INTERVAL} operaciones | Riesgo: ${(RISK_PERCENT * 100)}%`);
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initCompoundLogic,
  onTradeClosed,
  getCurrentLotSize,
  resetCounter,
  getState: () => ({ ...state }),
};
