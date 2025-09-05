/**
 * dashboard-web.js - Servidor Web para el Dashboard de Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Servir una interfaz web para monitorear el estado del bot en tiempo real.
 * - Proporcionar una API REST para obtener el estado actual.
 * - Actualizar datos cada 5 segundos.
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const cors = require('cors');

// === CONFIGURACIÓN ===
const config = {
  PORT: process.env.PORT || 3000,
  REFRESH_INTERVAL: 5000, // 5 segundos
  STATE_FILES: {
    exec: path.join(__dirname, '../exec-ia/exec-ia-state.json'),
    risk: path.join(__dirname, '../riskmap-ia/riskmap-ia-state.json'),
    compound: path.join(__dirname, '../compound-logic/compound-state.json'),
    signalrank: path.join(__dirname, '../signalrank-ia/signalrank-ia-state.json'),
    news: path.join(__dirname, '../news-filter/news-filter-state.json'),
  },
  LOG_FILE: path.join(__dirname, 'dashboard-web.log'),
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

// === SERVIDOR WEB ===
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

  // Calcular confianza promedio de SignalRank
  const avgConf = signalrank?.confidenceHistory
    ? signalrank.confidenceHistory.reduce((a, b) => a + b, 0) / signalrank.confidenceHistory.length
    : 0;

  // Calcular tiempo hasta la próxima operación
  const countdown = exec?.lastUpdate
    ? Math.max(0, Math.round((new Date(exec.lastUpdate).getTime() + 60000 - Date.now()) / 1000))
    : null;

  // Verificar alertas
  const alerts = checkAlerts({ exec, risk, compound, signalrank, news, avgConf });

  return {
    time: new Date().toLocaleTimeString(),
    exec: {
      status: exec ? '✅ Activo' : '❌ Inactivo',
      tradeCount: exec?.tradeCount || 0,
      lastUpdate: exec?.lastUpdate || 'N/A',
    },
    risk: {
      status: risk?.isPaused ? '⏸️ Pausado' : '✅ Activo',
      lossesInRow: risk?.lossesInRow || 0,
      pauseUntil: risk?.pauseUntil ? new Date(risk.pauseUntil).toLocaleTimeString() : 'N/A',
    },
    compound: {
      status: compound ? '✅ Activo' : '❌ Inactivo',
      tradeCount: compound?.tradeCount || 0,
      currentLot: compound?.currentLotSize ? `$${compound.currentLotSize.toFixed(2)}` : '$0',
    },
    signalrank: {
      status: signalrank ? '✅ Activo' : '❌ Inactivo',
      totalSignals: signalrank?.totalSignals || 0,
      filtered: signalrank?.filteredOut || 0,
      avgConfidence: avgConf ? `${(avgConf * 100).toFixed(1)}%` : '0%',
    },
    news: {
      status: news?.isNewsWindowActive ? '🔴 Activa' : '🟢 Inactiva',
      currentEvent: news?.currentEvent?.event || 'Ninguno',
      nextCheck: news?.nextCheck ? new Date(news.nextCheck).toLocaleTimeString() : 'N/A',
    },
    countdown,
    alerts,
  };
}

// === VERIFICAR ALERTAS ===
function checkAlerts(summary) {
  const alerts = [];

  if (summary.risk?.isPaused) {
    alerts.push({
      message: `⚠️ RIESGO: Bot pausado por ${summary.risk.lossesInRow} pérdidas seguidas. Reanudación: ${summary.risk.pauseUntil ? new Date(summary.risk.pauseUntil).toLocaleTimeString() : 'N/A'}`,
    });
  }

  if (summary.signalrank?.avgConfidence < 0.7) {
    alerts.push({
      message: `⚠️ SEÑALES: Confianza promedio baja (${(summary.signalrank.avgConfidence * 100).toFixed(1)}%).`,
    });
  }

  if (summary.news?.isNewsWindowActive) {
    alerts.push({
      message: `⚠️ NOTICIAS: Ventana activa por evento "${summary.news.currentEvent}" hasta ${summary.news.nextCheck}.`,
    });
  }

  return alerts;
}

// === RUTAS DE LA API ===
app.get('/api/state', async (req, res) => {
  try {
    const summary = await getSummary();
    res.json(summary);
  } catch (error) {
    logger.error(`Error al obtener estado: ${error.message}`);
    res.status(500).json({ error: 'Error al obtener estado' });
  }
});

// === SERVIR ARCHIVOS ESTÁTICOS ===
app.use('/', express.static(path.join(__dirname, 'public')));

// === INICIAR SERVIDOR ===
function startWebDashboard() {
  app.listen(config.PORT, () => {
    logger.info(`🌐 Dashboard web iniciado en http://localhost:${config.PORT}`);
  });
}

// === EXPORTAR MÓDULO ===
module.exports = {
  startWebDashboard,
  getSummary,
};

// === EJECUCIÓN DIRECTA ===
if (require.main === module) {
  startWebDashboard();
}
