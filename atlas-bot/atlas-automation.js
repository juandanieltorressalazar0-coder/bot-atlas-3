/**
 * atlas-automation.js - Módulo Orquestador Principal para A.T.L.A.S. (Versión Integrada)
 */

// === 1. IMPORTS Y CONFIGURACIÓN INICIAL ===
require('dotenv').config();
const express = require('express');
const path = require('path');
const { readJsonFile, saveJsonFile, fileExists, setupLogger, delay } = require('./utils/helpers');
const { fetchWithRetry } = require('./utils/network-helpers');

// Importar todos los módulos de IA y ejecución
const execIA = require('./exec-ia/exec-ia');
const signalRankIA = require('./signalrank-ia/signalrank-ia');
const riskmapIA = require('./riskmap-ia/riskmap-ia');
const techIA = require('./tech-ia/tech-ia');
const compoundLogic = require('./compound-logic/compound-logic');
const scraping = require('./scraping/scraping-forexfactory');


// === 2. CONFIGURACIÓN CENTRALIZADA ===
const config = {
  port: process.env.PORT || 3000,
  backtestMode: process.env.BACKTEST_MODE === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  operationInterval: parseInt(process.env.OPERATION_INTERVAL, 10) || 60000,
  minSignalScore: parseFloat(process.env.MIN_SIGNAL_SCORE) || 0.7,
  stateFilePath: path.join(__dirname, 'automation-state.json'),
  logFilePath: path.join(__dirname, 'logs', 'automation.log'),
  symbol: process.env.SYMBOL || 'EURUSD',
  bankroll: parseFloat(process.env.DEFAULT_BANKROLL) || 1000,
};

// === 3. LOGGER ===
const logger = setupLogger('atlas-automation', config.logFilePath);
logger.level = config.logLevel;

// === 4. GESTIÓN DE ESTADO ===
let systemState = {
  lastRun: null,
  isCycleRunning: false,
  // El estado de las operaciones abiertas se gestiona en exec-ia,
  // pero podríamos tener un resumen aquí si fuera necesario.
  stats: { wins: 0, losses: 0, total: 0 },
  version: '2.1.0', // Versión integrada
};

// === 5. LÓGICA DE TRADING (CICLO ÚNICO) ===
async function runTradingCycle() {
  if (systemState.isCycleRunning) {
    logger.warn('El ciclo de trading anterior todavía está en ejecución. Omitiendo este ciclo.');
    return;
  }
  systemState.isCycleRunning = true;
  logger.info(`--- Iniciando nuevo ciclo de trading para ${config.symbol} ---`);

  try {
    // 1. Chequear resultados de operaciones abiertas
    const openTrades = execIA.getOpenTrades();
    for (const trade of openTrades) {
      const result = await execIA.checkTradeResult(trade);
      if (result.status === 'closed') {
        logger.info(`Operación ${trade.tradeId} cerrada. Resultado: ${result.result}, Ganancia: ${result.profit}`);
        systemState.stats.total++;
        if (result.result === 'win') systemState.stats.wins++; else systemState.stats.losses++;
        config.bankroll += result.profit; // Actualizar bankroll
        await execIA.removeTrade(trade.tradeId);
      }
    }

    // 2. Obtener datos y señales
    const upcomingEvents = await scraping.getUpcomingHighImpactEvents(60);
    // Para una implementación real, aquí se obtendrían datos OHLCV frescos.
    // Para este ejemplo, asumimos que techIA puede obtenerlos o se le pasan.
    // const ohlcv = await getFreshOHLCV();
    const indicators = techIA.computeIndicators(/* ohlcv */); // Placeholder

    // 3. Evaluar riesgo
    const riskAssessment = riskmapIA.assessRisk({ upcomingEvents, indicators });
    if (!riskAssessment.allowed) {
      logger.warn(`Operación denegada por gestor de riesgo: ${riskAssessment.reason}`);
      systemState.isCycleRunning = false;
      return;
    }

    // 4. Obtener puntuación de la señal
    const finalSignal = signalRankIA.getFinalScore({
      signals: { tech: { score: 0.8, direction: 'CALL' } }, // Placeholder de señal
      openTrades: execIA.getOpenTrades(),
      // lastTradeTimes se debería gestionar en el estado del sistema
      symbol: config.symbol,
    });

    // 5. Decidir y ejecutar
    if (finalSignal.finalScore >= config.minSignalScore) {
      logger.info(`Señal fuerte (${finalSignal.finalScore.toFixed(2)}) y riesgo aceptado. Procediendo a operar.`);

      const stake = compoundLogic.calculateStake({
        bankroll: config.bankroll,
        recommendedStakePct: riskAssessment.recommendedStakePct,
      });

      await execIA.placeTrade({
        symbol: config.symbol,
        direction: finalSignal.direction,
        stake,
        expiryMinutes: 5,
      });

    } else {
      logger.info(`La puntuación de la señal (${finalSignal.finalScore.toFixed(2)}) no supera el umbral (${config.minSignalScore}).`);
    }

  } catch (error) {
    logger.error('Ocurrió un error durante el ciclo de trading.', error);
  } finally {
    systemState.lastRun = new Date().toISOString();
    systemState.isCycleRunning = false;
    logger.info('--- Ciclo de trading finalizado ---');
  }
}

// === 6. SERVIDOR WEB (EXPRESS) ===
const app = express();
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', ...systemState }));
app.get('/status', (req, res) => res.status(200).json({ systemState, openTrades: execIA.getOpenTrades() }));

// === 7. ARRANQUE Y APAGADO SEGURO ===
async function start() {
  logger.info('*** Iniciando A.T.L.A.S. ***');

  // Cargar estado de los módulos que lo necesiten
  await execIA.init();
  await scraping.initScraping();
  // ... otros inits si fueran necesarios

  // Iniciar el ciclo de trading programado
  setInterval(runTradingCycle, config.operationInterval);

  // Iniciar el servidor web
  app.listen(config.port, () => {
    logger.info(`Servidor escuchando en http://localhost:${config.port}`);
    logger.info(`Bot operando en modo: ${config.backtestMode ? 'BACKTEST' : 'LIVE'}`);
  });
}

async function gracefulShutdown() {
  logger.warn('Iniciando apagado seguro del sistema...');
  await saveJsonFile(config.stateFilePath, systemState);
  // Aquí también se podrían guardar los estados de otros módulos si fuera necesario.
  logger.info('Apagado completado.');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// === 8. INICIAR EL BOT ===
start().catch(error => {
  logger.error('Fallo catastrófico durante el arranque.', error);
  process.exit(1);
});
