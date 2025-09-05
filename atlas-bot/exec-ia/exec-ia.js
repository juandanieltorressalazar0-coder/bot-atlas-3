/**
 * exec-ia.js - Módulo de Ejecución para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Ejecutar operaciones en IQ Option.
 * - Gestionar el ciclo de operaciones (1 por minuto).
 * - Integrar con SignalRank-IA para recibir señales.
 * - Aplicar cierre anticipado y gestión de riesgo.
 * - Persistir estado en disco.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { IQOptionAPI } = require('iqoption-api'); // Asegúrate de instalar: npm install iqoption-api
const { delay } = require('../utils/helpers');

// === CONFIGURACIÓN ===
const config = {
  STATE_FILE: path.join(__dirname, 'exec-ia-state.json'),
  LOG_FILE: path.join(__dirname, 'exec-ia.log'),
  IQ_OPTION_EMAIL: process.env.IQ_OPTION_EMAIL,
  IQ_OPTION_PASSWORD: process.env.IQ_OPTION_PASSWORD,
  TOTAL_OPERATIONS: 180,
  OPERATION_INTERVAL: 60000, // 1 minuto en milisegundos
  TARGET_PAIR: 'EURUSD',
  DURATION: 1, // Duración de la operación en minutos
  RISK_PERCENT: 0.10, // 10% del balance por operación
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
  tradeCount: 0,
  balance: 0,
  lastUpdate: null,
  lastTrade: null,
  operations: [],
  status: 'idle',
  iqOption: null,
  isConnected: false,
};

// === CARGAR ESTADO DESDE DISCO ===
async function loadState() {
  try {
    if (await fileExists(config.STATE_FILE)) {
      const data = await fs.readFile(config.STATE_FILE, 'utf8');
      const saved = JSON.parse(data);

      // Restaurar solo campos clave con validación
      state.tradeCount = saved.tradeCount || 0;
      state.balance = saved.balance || 0;
      state.lastUpdate = saved.lastUpdate || null;
      state.lastTrade = saved.lastTrade || null;
      state.operations = saved.operations || [];
      state.status = saved.status || 'idle';

      logger.info(`🟢 Exec-IA: Estado cargado. tradeCount=${state.tradeCount}, balance=$${state.balance.toFixed(2)}`);
    } else {
      // Inicializar con valores por defecto
      await saveState();
      logger.info('🆕 Exec-IA: Estado inicial creado.');
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar estado de exec-ia: ${error.message}`);
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

// === CONECTAR A IQ OPTION ===
async function connectToIQOption() {
  try {
    if (state.isConnected) {
      logger.info('🔄 Exec-IA: Ya conectado a IQ Option.');
      return;
    }

    logger.info('🔌 Exec-IA: Conectando a IQ Option...');

    const iqOption = new IQOptionAPI({
      email: config.IQ_OPTION_EMAIL,
      password: config.IQ_OPTION_PASSWORD,
    });

    await iqOption.connect();
    await iqOption.getProfile();

    state.iqOption = iqOption;
    state.isConnected = true;
    state.balance = await getBalance();

    logger.info(`✅ Exec-IA: Conectado a IQ Option. Balance: $${state.balance.toFixed(2)}`);
    await saveState();
  } catch (error) {
    logger.error(`❌ Exec-IA: Error al conectar a IQ Option: ${error.message}`);
    state.isConnected = false;
    state.iqOption = null;
    await saveState();
    throw error;
  }
}

// === OBTENER BALANCE ACTUAL ===
async function getBalance() {
  try {
    if (!state.isConnected || !state.iqOption) {
      await connectToIQOption();
    }
    const balance = await state.iqOption.getBalance();
    state.balance = balance;
    await saveState();
    return balance;
  } catch (error) {
    logger.error(`❌ Exec-IA: Error al obtener balance: ${error.message}`);
    throw error;
  }
}

// === CALCULAR TAMAÑO DEL LOTE ===
function calculateLotSize() {
  return state.balance * config.RISK_PERCENT;
}

// === EJECUTAR OPERACIÓN ===
async function executeTrade(signal) {
  try {
    if (!state.isConnected) {
      await connectToIQOption();
    }

    const lotSize = calculateLotSize();
    const { action, entryPrice } = signal;

    logger.info(`🎯 Exec-IA: Ejecutando operación ${state.tradeCount + 1}/${config.TOTAL_OPERATIONS}`);
    logger.info(`   → Par: ${config.TARGET_PAIR} | Acción: ${action} | Lote: $${lotSize.toFixed(2)}`);

    // Ejecutar operación en IQ Option
    const operation = await state.iqOption.buy({
      amount: lotSize,
      asset: config.TARGET_PAIR,
      direction: action.toLowerCase(),
      duration: config.DURATION,
      duration_unit: 'm',
    });

    // Registrar operación
    const trade = {
      id: `OP-${state.tradeCount + 1}-${Date.now()}`,
      pair: config.TARGET_PAIR,
      action,
      amount: lotSize,
      entryPrice,
      entryTime: new Date().toISOString(),
      status: 'open',
      operationId: operation.id,
    };

    state.operations.push(trade);
    state.tradeCount++;
    state.lastTrade = new Date().toISOString();
    await saveState();

    logger.info(`✅ Exec-IA: Operación ${trade.id} ejecutada con éxito. ID: ${operation.id}`);

    // Esperar a que la operación se cierre
    const result = await waitForTradeClose(operation.id);

    // Actualizar resultado de la operación
    trade.exitTime = new Date().toISOString();
    trade.result = result.profit > 0 ? 'win' : 'loss';
    trade.profit = result.profit;
    trade.status = 'closed';

    await saveState();
    logger.info(`📊 Exec-IA: Operación ${trade.id} cerrada. Resultado: ${trade.result} | Ganancia: $${trade.profit.toFixed(2)}`);

    return {
      ...trade,
      outcome: trade.result,
      profit: trade.profit,
    };
  } catch (error) {
    logger.error(`❌ Exec-IA: Error al ejecutar operación: ${error.message}`);
    throw error;
  }
}

// === ESPERAR CIERRE DE OPERACIÓN ===
async function waitForTradeClose(operationId) {
  try {
    const startTime = Date.now();
    const durationMs = config.DURATION * 60 * 1000; // Convertir minutos a milisegundos

    while (Date.now() - startTime < durationMs) {
      await delay(1000); // Esperar 1 segundo

      const operation = await state.iqOption.getPosition(operationId);
      if (operation.status === 'closed') {
        return {
          profit: operation.profit,
          status: operation.status,
        };
      }
    }

    // Si llega aquí, la operación no se cerró automáticamente
    const operation = await state.iqOption.closePosition(operationId);
    return {
      profit: operation.profit,
      status: operation.status,
    };
  } catch (error) {
    logger.error(`❌ Exec-IA: Error al esperar cierre de operación: ${error.message}`);
    throw error;
  }
}

// === INICIALIZAR MÓDULO ===
async function initExecutionModule() {
  await loadState();
  await connectToIQOption();
  logger.info('🟢 Exec-IA: Módulo de ejecución iniciado y listo para operar.');
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initExecutionModule,
  executeTrade,
  getBalance,
  getState: () => ({ ...state }),
};

// === FUNCIÓN DE RETRASO ===
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
