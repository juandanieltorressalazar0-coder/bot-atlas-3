/**
 * atlas-automation.js - Módulo Principal de Automatización para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Coordinar todos los módulos del sistema.
 * - Gestionar las fases de calibración (demo) y ejecución real.
 * - Monitorear el estado general del sistema.
 * - Generar informes de ejecución.
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { delay } = require('./utils/helpers-ia');

// === MÓDULOS ===
const execIA = require('./exec-ia/exec-ia');
const riskMapIA = require('./riskmap-ia/riskmap-ia');
const signalRankIA = require('./signalrank-ia/signalrank-ia');
const techIA = require('./tech-ia/tech-ia');
const sentIA = require('./sent-ia/sent-ia');
const volIA = require('./vol-ia/vol-ia');
const geoEUR = require('./geo-eur/geo-eur');
const geoUSA = require('./geo-usa/geo-usa');
const newsFilter = require('./news-filter/news-filter');
const scraping = require('./scraping/scraping-forexfactory');

// === CONFIGURACIÓN ===
const config = {
  PHASE: process.env.PHASE || 'demo', // demo o real
  PAIR: process.env.PAIR || 'EURUSD',
  DURATION: parseInt(process.env.DURATION) || 3, // horas
  TOTAL_OPERATIONS: parseInt(process.env.TOTAL_OPERATIONS) || 180,
  OPERATION_INTERVAL: parseInt(process.env.OPERATION_INTERVAL) || 60000, // 1 minuto
  LOG_FILE: path.join(__dirname, 'logs', 'automation.log'),
  REPORT_DIR: path.join(__dirname, 'reports'),
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

// === ESTADO DEL SISTEMA ===
let systemState = {
  phase: config.PHASE,
  pair: config.PAIR,
  duration: config.DURATION,
  totalOperations: config.TOTAL_OPERATIONS,
  operationCount: 0,
  winCount: 0,
  lossCount: 0,
  startTime: null,
  endTime: null,
  status: 'initializing',
  errors: [],
  modules: {
    'exec-ia': { status: 'idle' },
    'riskmap-ia': { status: 'idle' },
    'signalrank-ia': { status: 'idle' },
    'tech-ia': { status: 'idle' },
    'sent-ia': { status: 'idle' },
    'vol-ia': { status: 'idle' },
    'geo-eur': { status: 'idle' },
    'geo-usa': { status: 'idle' },
    'news-filter': { status: 'idle' },
    'scraping': { status: 'idle' },
  },
};

// === INICIALIZAR MÓDULOS ===
async function initModules() {
  try {
    logger.info('🚀 Inicializando módulos...');

    // Inicializar módulos en paralelo
    await Promise.all([
      execIA.initExecutionModule(),
      riskMapIA.initRiskMapIA(),
      signalRankIA.initSignalRankIA(),
      techIA.initTechIA(),
      sentIA.initSentIA(),
      volIA.initVolIA(),
      geoEUR.initGeoEUR(),
      geoUSA.initGeoUSA(),
      newsFilter.initNewsFilter(),
      scraping.initScraping(),
    ]);

    // Actualizar estado del sistema
    systemState.status = 'modules_ready';
    Object.keys(systemState.modules).forEach(module => {
      systemState.modules[module].status = 'active';
    });

    logger.info('✅ Todos los módulos inicializados correctamente.');
  } catch (error) {
    logger.error(`❌ Error al inicializar módulos: ${error.message}`);
    systemState.status = 'initialization_error';
    systemState.errors.push({ message: error.message, timestamp: new Date().toISOString() });
    throw error;
  }
}

// === EJECUTAR FASE DE CALIBRACIÓN (DEMO) ===
async function runDemoPhase() {
  try {
    logger.info('🎯 Iniciando fase de calibración (DEMO)...');
    systemState.status = 'demo_running';
    systemState.startTime = new Date().toISOString();

    // Simular balance inicial
    const initialBalance = 1000;
    await riskMapIA.initBalance(initialBalance);

    // Ejecutar operaciones de demo
    for (let i = 0; i < config.TOTAL_OPERATIONS; i++) {
      systemState.operationCount = i + 1;

      // Verificar si el bot está pausado
      const riskStatus = riskMapIA.checkStatus();
      if (riskStatus.isPaused) {
        logger.warn(`⏸️ Operación ${i + 1}: Bot pausado hasta ${riskStatus.pauseUntil}.`);
        await delay(60000); // Esperar 1 minuto
        continue;
      }

      // Obtener señales de todos los módulos
      const techSignal = techIA.getCurrentSignal();
      const sentSignal = sentIA.getCurrentSentiment();
      const volSignal = volIA.getCurrentSignal();
      const geoEURSignal = geoEUR.getCurrentSignal();
      const geoUSASignal = geoUSA.getCurrentSignal();

      // Fusionar señales
      const signals = [
        { ...techSignal, source: 'tech-ia' },
        { action: sentSignal.sentiment === 'positive' ? 'CALL' : 'PUT', confidence: sentSignal.confidence, source: 'sent-ia' },
        { action: volSignal.recommendation === 'reduce_lot_size' ? 'PUT' : 'CALL', confidence: volSignal.confidence, source: 'vol-ia' },
        { ...geoEURSignal, source: 'geo-eur' },
        { ...geoUSASignal, source: 'geo-usa' },
      ];

      const fusedSignal = signalRankIA.fuseSignals(signals);

      // Verificar ventana de noticias
      const newsStatus = newsFilter.getCurrentStatus();
      if (newsStatus.isNewsWindowActive) {
        logger.warn(`📰 Operación ${i + 1}: Ventana de noticias activa. Operación cancelada.`);
        continue;
      }

      // Ejecutar operación
      const operation = await execIA.executeTrade(fusedSignal);

      // Registrar resultado
      if (operation.result === 'win') {
        systemState.winCount++;
      } else {
        systemState.lossCount++;
      }

      // Actualizar balance y estado de riesgo
      const newBalance = await execIA.getBalance();
      await riskMapIA.updateBalance(newBalance);
      riskMapIA.registerTrade(operation.result);

      logger.info(`📊 Operación ${i + 1}: ${operation.result.toUpperCase()}. Balance: $${newBalance.toFixed(2)}`);

      // Esperar intervalo entre operaciones
      if (i < config.TOTAL_OPERATIONS - 1) {
        await delay(config.OPERATION_INTERVAL);
      }
    }

    // Finalizar fase de demo
    systemState.status = 'demo_completed';
    systemState.endTime = new Date().toISOString();
    const finalBalance = await execIA.getBalance();

    logger.info(`🏁 Fase de calibración (DEMO) completada. Operaciones: ${config.TOTAL_OPERATIONS}. Ganadas: ${systemState.winCount}. Perdidas: ${systemState.lossCount}. Balance final: $${finalBalance.toFixed(2)}`);

    // Generar informe
    await generateReport('demo');
  } catch (error) {
    logger.error(`❌ Error en fase de calibración: ${error.message}`);
    systemState.status = 'demo_error';
    systemState.errors.push({ message: error.message, timestamp: new Date().toISOString() });
    throw error;
  }
}

// === EJECUTAR FASE REAL ===
async function runRealPhase() {
  try {
    logger.info('🚀 Iniciando fase real...');
    systemState.status = 'real_running';
    systemState.startTime = new Date().toISOString();

    // Obtener balance inicial real
    const initialBalance = await execIA.getBalance();
    await riskMapIA.initBalance(initialBalance);

    // Ejecutar operaciones en tiempo real
    for (let i = 0; i < config.TOTAL_OPERATIONS; i++) {
      systemState.operationCount = i + 1;

      // Verificar si el bot está pausado
      const riskStatus = riskMapIA.checkStatus();
      if (riskStatus.isPaused) {
        logger.warn(`⏸️ Operación ${i + 1}: Bot pausado hasta ${riskStatus.pauseUntil}.`);
        await delay(60000); // Esperar 1 minuto
        continue;
      }

      // Obtener señales de todos los módulos
      const techSignal = techIA.getCurrentSignal();
      const sentSignal = sentIA.getCurrentSentiment();
      const volSignal = volIA.getCurrentSignal();
      const geoEURSignal = geoEUR.getCurrentSignal();
      const geoUSASignal = geoUSA.getCurrentSignal();

      // Fusionar señales
      const signals = [
        { ...techSignal, source: 'tech-ia' },
        { action: sentSignal.sentiment === 'positive' ? 'CALL' : 'PUT', confidence: sentSignal.confidence, source: 'sent-ia' },
        { action: volSignal.recommendation === 'reduce_lot_size' ? 'PUT' : 'CALL', confidence: volSignal.confidence, source: 'vol-ia' },
        { ...geoEURSignal, source: 'geo-eur' },
        { ...geoUSASignal, source: 'geo-usa' },
      ];

      const fusedSignal = signalRankIA.fuseSignals(signals);

      // Verificar ventana de noticias
      const newsStatus = newsFilter.getCurrentStatus();
      if (newsStatus.isNewsWindowActive) {
        logger.warn(`📰 Operación ${i + 1}: Ventana de noticias activa. Operación cancelada.`);
        continue;
      }

      // Ejecutar operación
      const operation = await execIA.executeTrade(fusedSignal);

      // Registrar resultado
      if (operation.result === 'win') {
        systemState.winCount++;
      } else {
        systemState.lossCount++;
      }

      // Actualizar balance y estado de riesgo
      const newBalance = await execIA.getBalance();
      await riskMapIA.updateBalance(newBalance);
      riskMapIA.registerTrade(operation.result);

      logger.info(`📊 Operación ${i + 1}: ${operation.result.toUpperCase()}. Balance: $${newBalance.toFixed(2)}`);

      // Esperar intervalo entre operaciones
      if (i < config.TOTAL_OPERATIONS - 1) {
        await delay(config.OPERATION_INTERVAL);
      }
    }

    // Finalizar fase real
    systemState.status = 'real_completed';
    systemState.endTime = new Date().toISOString();
    const finalBalance = await execIA.getBalance();

    logger.info(`🏁 Fase real completada. Operaciones: ${config.TOTAL_OPERATIONS}. Ganadas: ${systemState.winCount}. Perdidas: ${systemState.lossCount}. Balance final: $${finalBalance.toFixed(2)}`);

    // Generar informe
    await generateReport('real');
  } catch (error) {
    logger.error(`❌ Error en fase real: ${error.message}`);
    systemState.status = 'real_error';
    systemState.errors.push({ message: error.message, timestamp: new Date().toISOString() });
    throw error;
  }
}

// === GENERAR INFORME ===
async function generateReport(phase) {
  try {
    const report = {
      mission: `Kamikaze Rip A.T.L.A.S. - Fase ${phase === 'demo' ? 'de Calibración (DEMO)' : 'Real'}`,
      phase,
      pair: config.PAIR,
      duration: config.DURATION,
      totalOperations: config.TOTAL_OPERATIONS,
      startTime: systemState.startTime,
      endTime: systemState.endTime,
      status: `${phase}_completed`,
      errors: systemState.errors,
      summary: {
        totalTrades: systemState.operationCount,
        winTrades: systemState.winCount,
        lossTrades: systemState.lossCount,
        winRate: systemState.winCount / systemState.operationCount,
        initialBalance: await execIA.getBalance() - (await riskMapIA.getState()).profit,
        finalBalance: await execIA.getBalance(),
        profit: (await riskMapIA.getState()).profit,
        maxDrawdown: (await riskMapIA.getState()).maxDrawdown,
      },
      riskmap: await riskMapIA.getState(),
      compound: { tradeCount: systemState.operationCount },
      signalrank: await signalRankIA.getCurrentState(),
      exec: await execIA.getState(),
      modules: {
        'geo-eur': await geoEUR.getState(),
        'geo-usa': await geoUSA.getState(),
        'tech-ia': await techIA.getState(),
        'sent-ia': await sentIA.getState(),
        'vol-ia': await volIA.getState(),
        'news-filter': await newsFilter.getState(),
      },
    };

    // Crear directorio de informes si no existe
    if (!(await fileExists(config.REPORT_DIR))) {
      await fs.mkdir(config.REPORT_DIR, { recursive: true });
    }

    // Guardar informe
    const reportFile = path.join(config.REPORT_DIR, `report-${phase}-${new Date().toISOString().split('T')[0]}.json`);
    await saveJsonFile(reportFile, report);

    logger.info(`📄 Informe generado: ${reportFile}`);
  } catch (error) {
    logger.error(`❌ Error al generar informe: ${error.message}`);
    throw error;
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

// === GUARDAR ARCHIVO JSON ===
async function saveJsonFile(filePath, data) {
  try {
    const tempFile = `${filePath}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, filePath);
  } catch (error) {
    throw new Error(`Error al guardar ${filePath}: ${error.message}`);
  }
}

// === INICIAR AUTOMATIZACIÓN ===
async function startAutomation() {
  try {
    logger.info('🌐 Iniciando automatización de Kamikaze Rip A.T.L.A.S.');

    // Inicializar módulos
    await initModules();

    // Ejecutar fase según configuración
    if (config.PHASE === 'demo') {
      await runDemoPhase();
    } else {
      await runRealPhase();
    }

    logger.info('🎉 Automatización finalizada.');
  } catch (error) {
    logger.error(`❌ Error en automatización: ${error.message}`);
    process.exit(1);
  }
}

// === INICIAR ===
startAutomation();
