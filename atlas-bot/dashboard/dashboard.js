/**
 * dashboard.js - Dashboard de Monitoreo para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Mostrar el estado en tiempo real de todos los módulos.
 * - Monitorear señales, ganancias, riesgo, noticias y ejecución.
 * - Actualizar cada 10 segundos.
 * - Ejecutar en consola (CLI) con colores y formato claro.
 */

const fs = require('fs').promises;
const path = require('path');
const colors = require('colors');
const winston = require('winston');

// === CONFIGURACIÓN ===
const config = {
  REFRESH_INTERVAL: 10000, // 10 segundos
  STATE_FILES: {
    exec: path.join(__dirname, '../exec-ia/exec-ia-state.json'),
    risk: path.join(__dirname, '../riskmap-ia/riskmap-ia-state.json'),
    compound: path.join(__dirname, '../compound-logic/compound-state.json'),
    signalrank: path.join(__dirname, '../signalrank-ia/signalrank-ia-state.json'),
    news: path.join(__dirname, '../news-filter/news-filter-state.json'),
  },
  LOG_FILE: path.join(__dirname, 'dashboard.log'),
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

// === ESTADO GLOBAL ===
let dashboardState = {
  lastUpdate: null,
  alerts: [],
};

// === CARGAR ESTADO DE UN MÓDULO ===
async function loadState(file) {
  try {
    if (await fileExists(file)) {
      const data = await fs.readFile(file, 'utf8');
      return JSON.parse(data);
    }
    return null;
  } catch (error) {
    logger.error(`Error al cargar estado de ${path.basename(file)}: ${error.message}`);
    return null;
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

// === OBTENER RESUMEN DE MÓDULOS ===
async function getSummary() {
  const [exec, risk, compound, signalrank, news] = await Promise.all([
    loadState(config.STATE_FILES.exec),
    loadState(config.STATE_FILES.risk),
    loadState(config.STATE_FILES.compound),
    loadState(config.STATE_FILES.signalrank),
    loadState(config.STATE_FILES.news),
  ]);

  // Verificar alertas
  checkAlerts({ exec, risk, compound, signalrank, news });

  return {
    time: new Date().toLocaleTimeString(),
    exec: {
      status: exec ? '✅ Activo'.green : '❌ Inactivo'.red,
      tradeCount: exec?.tradeCount || 0,
      lastUpdate: exec?.lastUpdate || 'N/A',
    },
    risk: {
      status: risk?.isPaused ? '⏸️ Pausado'.yellow : '✅ Activo'.green,
      lossesInRow: risk?.lossesInRow || 0,
      pauseUntil: risk?.pauseUntil ? new Date(risk.pauseUntil).toLocaleTimeString() : 'N/A',
    },
    compound: {
      status: '✅ Activo'.green,
      tradeCount: compound?.tradeCount || 0,
      currentLot: compound?.currentLotSize ? `$${compound.currentLotSize.toFixed(2)}`.green : '$0'.red,
    },
    signalrank: {
      status: '✅ Activo'.green,
      totalSignals: signalrank?.totalSignals || 0,
      filtered: signalrank?.filteredOut || 0,
      avgConfidence: signalrank?.avgConfidence ? `${(signalrank.avgConfidence * 100).toFixed(1)}%`.yellow : '0%'.red,
    },
    news: {
      status: news?.isNewsWindowActive ? '🔴 Activa'.red : '🟢 Inactiva'.green,
      currentEvent: news?.currentEvent?.event || 'Ninguno',
      nextCheck: news?.nextCheck ? new Date(news.nextCheck).toLocaleTimeString() : 'N/A',
    },
  };
}

// === VERIFICAR ALERTAS ===
function checkAlerts(summary) {
  const newAlerts = [];

  // Alertas para RiskMap-IA
  if (summary.risk?.isPaused) {
    newAlerts.push({
      message: `⚠️ RIESGO: Bot pausado por ${summary.risk.lossesInRow} pérdidas seguidas. Reanudación: ${summary.risk.pauseUntil ? new Date(summary.risk.pauseUntil).toLocaleTimeString() : 'N/A'}`.yellow,
      timestamp: new Date().toISOString(),
    });
  }

  // Alertas para SignalRank-IA
  if (summary.signalrank?.avgConfidence < 0.7) {
    newAlerts.push({
      message: `⚠️ SEÑALES: Confianza promedio baja (${(summary.signalrank.avgConfidence * 100).toFixed(1)}%)`.yellow,
      timestamp: new Date().toISOString(),
    });
  }

  // Alertas para News-Filter
  if (summary.news?.isNewsWindowActive) {
    newAlerts.push({
      message: `⚠️ NOTICIAS: Ventana activa por evento "${summary.news.currentEvent || 'desconocido'}"`.red,
      timestamp: new Date().toISOString(),
    });
  }

  // Añadir nuevas alertas al estado
  dashboardState.alerts = [...newAlerts, ...dashboardState.alerts].slice(0, 5);
  dashboardState.lastUpdate = new Date().toISOString();
}

// === FORMATO DE VALORES ===
function formatValue(value, type = 'default') {
  if (value === null || value === undefined) return 'N/A'.gray;

  switch (type) {
    case 'currency':
      return value !== null ? `$${parseFloat(value).toFixed(2)}`.green : 'N/A'.gray;
    case 'percentage':
      return value !== null ? `${(parseFloat(value) * 100).toFixed(1)}%`.yellow : 'N/A'.gray;
    case 'status':
      return value === true || value === '✅ Activo' ? value.toString().green :
             value === false || value === '❌ Inactivo' ? value.toString().red :
             value.toString().gray;
    case 'timestamp':
      return value ? new Date(value).toLocaleTimeString().cyan : 'N/A'.gray;
    default:
      return value.toString();
  }
}

// === MOSTRAR DASHBOARD EN CONSOLA ===
async function renderDashboard() {
  console.clear();
  const summary = await getSummary();

  // Encabezado
  console.log('='.repeat(80));
  console.log('🚀 KAMIKAZE RIP A.T.L.A.S. — DASHBOARD EN TIEMPO REAL'.bold.white);
  console.log(`⏱️  MISIÓN EN CURSO — Última actualización: ${summary.time}`.italic.gray);
  console.log('='.repeat(80));

  // Alertas
  if (dashboardState.alerts.length > 0) {
    console.log('🔔 ALERTAS ACTIVAS'.bgYellow.black);
    dashboardState.alerts.forEach(alert => {
      console.log(`  ${alert.message}`);
    });
    console.log();
  }

  // Módulo de Ejecución
  console.log('🔧 MÓDULO DE EJECUCIÓN (Exec-IA)'.yellow);
  console.log(`   Estado: ${summary.exec.status}`);
  console.log(`   Operaciones: ${summary.exec.tradeCount}`);
  console.log(`   Última actualización: ${formatValue(summary.exec.lastUpdate, 'timestamp')}`);
  console.log();

  // Gestión de Riesgo
  console.log('🛡️ GESTIÓN DE RIESGO (RiskMap-IA)'.red);
  console.log(`   Estado: ${summary.risk.status}`);
  console.log(`   Pérdidas seguidas: ${summary.risk.lossesInRow}`);
  console.log(`   Pausa hasta: ${formatValue(summary.risk.pauseUntil, 'timestamp')}`);
  console.log();

  // Interés Compuesto
  console.log('💰 INTERÉS COMPUESTO (Compound-Logic)'.green);
  console.log(`   Estado: ${summary.compound.status}`);
  console.log(`   Operaciones: ${summary.compound.tradeCount}`);
  console.log(`   Lote actual: ${summary.compound.currentLot}`);
  console.log();

  // Fusión de Señales
  console.log('🔀 FUSIÓN DE SEÑALES (SignalRank-IA)'.blue);
  console.log(`   Estado: ${summary.signalrank.status}`);
  console.log(`   Señales procesadas: ${summary.signalrank.totalSignals}`);
  console.log(`   Señales filtradas: ${summary.signalrank.filtered}`);
  console.log(`   Confianza promedio: ${summary.signalrank.avgConfidence}`);
  console.log();

  // Filtro de Noticias
  console.log('🛑 FILTRO DE NOTICIAS (News-Filter)'.magenta);
  console.log(`   Ventana activa: ${summary.news.status}`);
  console.log(`   Evento actual: ${summary.news.currentEvent}`);
  console.log(`   Próxima verificación: ${formatValue(summary.news.nextCheck, 'timestamp')}`);
  console.log();

  // Pie de página
  console.log('='.repeat(80));
  console.log('📌 PRÓXIMA OPERACIÓN: EN 60 SEGUNDOS'.bold.cyan);
  console.log('✅ Todo listo para la siguiente señal.\n');
}

// === INICIAR MONITOREO ===
async function startDashboard() {
  logger.info('🟢 Dashboard iniciado: Monitoreo en tiempo real activado.');
  await renderDashboard();
  setInterval(renderDashboard, config.REFRESH_INTERVAL);
}

// === EXPORTAR MÓDULO ===
module.exports = {
  startDashboard,
  getSummary,
  renderDashboard,
};

// === EJECUCIÓN DIRECTA ===
if (require.main === module) {
  startDashboard();
}
