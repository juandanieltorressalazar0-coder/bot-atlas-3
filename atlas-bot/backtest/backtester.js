/**
 * backtester.js - Motor de Backtesting para A.T.L.A.S.
 *
 * Función:
 * - Descargar datos históricos de precios desde Alpha Vantage.
 * - Simular la estrategia de trading del bot sobre los datos históricos.
 * - Evaluar y reportar el rendimiento de la estrategia.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const { fetchWithRetry } = require('../utils/network-helpers');
const { computeIndicators } = require('../tech-ia/tech-ia');
const { getFinalScore } = require('../signalrank-ia/signalrank-ia');
const { assessRisk } = require('../riskmap-ia/riskmap-ia');
const { calculateStake } = require('../compound-logic/compound-logic');
const { fileExists, setupLogger } = require('../utils/helpers');

// === CONFIGURACIÓN ===
const config = {
  apiKey: process.env.ALPHAVANTAGE_KEY,
  dataDir: path.join(__dirname, 'data'),
  // Parámetros para la simulación
  backtestParams: {
    symbol: 'EURUSD',
    timeframe: '15min', // Ej: 1min, 5min, 15min, 30min, 60min
    outputSize: 'full', // 'compact' o 'full'
    initialBankroll: 1000,
    expiryCandles: 4, // Operación expira después de 4 velas de 15min = 1 hora
  },
  // Parámetros para los indicadores
  indicatorParams: {
    rsiPeriod: 14,
    emaPeriods: [20, 50],
    macdParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    atrPeriod: 14,
  },
};

const logger = setupLogger('backtester', path.join(__dirname, 'logs', 'backtester.log'));

/**
 * Descarga y cachea datos históricos de Alpha Vantage.
 * @param {string} symbol - Símbolo del par, ej: 'EURUSD'.
 * @param {string} timeframe - Temporalidad, ej: '15min'.
 * @returns {Promise<object>} - Datos OHLCV en el formato correcto.
 */
async function fetchHistoricalData(symbol, timeframe) {
  const cachePath = path.join(config.dataDir, `${symbol}_${timeframe}.json`);

  // 1. Intentar cargar desde la caché local
  if (await fileExists(cachePath)) {
    try {
      logger.info(`Cargando datos históricos desde la caché: ${cachePath}`);
      const cachedData = await fs.readFile(cachePath, 'utf8');
      return JSON.parse(cachedData);
    } catch (error) {
      logger.warn(`No se pudo leer el archivo de caché ${cachePath}. Se descargará de nuevo.`, error);
    }
  }

  // 2. Si no está en caché, descargar desde Alpha Vantage
  if (!config.apiKey) {
    throw new Error('La API Key de Alpha Vantage (ALPHAVANTAGE_KEY) no está configurada en .env');
  }
  logger.info(`Descargando datos históricos para ${symbol} (${timeframe}) desde Alpha Vantage...`);

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=${timeframe}&outputsize=${config.backtestParams.outputSize}&apikey=${config.apiKey}&datatype=json`;

  try {
    const response = await fetchWithRetry(url);
    const rawData = response.data;
    const timeSeriesKey = `Time Series (${timeframe})`;
    const timeSeries = rawData[timeSeriesKey];

    if (!timeSeries) {
      throw new Error(`Respuesta inesperada de Alpha Vantage: ${JSON.stringify(rawData)}`);
    }

    // 3. Parsear y transformar los datos al formato OHLCV
    const dates = Object.keys(timeSeries).sort(); // Ordenar de más antiguo a más reciente
    const ohlcv = { open: [], high: [], low: [], close: [], volume: [] };

    for (const date of dates) {
      ohlcv.open.push(parseFloat(timeSeries[date]['1. open']));
      ohlcv.high.push(parseFloat(timeSeries[date]['2. high']));
      ohlcv.low.push(parseFloat(timeSeries[date]['3. low']));
      ohlcv.close.push(parseFloat(timeSeries[date]['4. close']));
      ohlcv.volume.push(parseInt(timeSeries[date]['5. volume'], 10));
    }

    // 4. Guardar en caché para futuros usos
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(ohlcv, null, 2));
    logger.info(`Datos guardados en caché: ${cachePath}`);

    return ohlcv;
  } catch (error) {
    logger.error('Fallo al descargar o procesar los datos históricos.', error.originalError || error);
    throw error;
  }
}

/**
 * Ejecuta el motor de backtesting.
 */
async function runBacktest() {
  logger.info('*** Iniciando Backtest de la Estrategia A.T.L.A.S. ***');

  // 1. Obtener datos
  const ohlcv = await fetchHistoricalData(config.backtestParams.symbol, config.backtestParams.timeframe);
  const totalCandles = ohlcv.close.length;
  logger.info(`Datos cargados: ${totalCandles} velas.`);

  if (totalCandles < 100) { // Necesitamos un mínimo de datos para los indicadores
    logger.error('No hay suficientes datos históricos para ejecutar el backtest.');
    return;
  }

  // 2. Inicializar variables de simulación
  let bankroll = config.backtestParams.initialBankroll;
  const trades = [];
  const history = []; // Para registrar el equity

  // 3. Iterar a través de las velas (dejando espacio para que los indicadores se calienten)
  for (let i = 100; i < totalCandles - config.backtestParams.expiryCandles; i++) {
    const currentSlice = {
      open: ohlcv.open.slice(0, i + 1),
      high: ohlcv.high.slice(0, i + 1),
      low: ohlcv.low.slice(0, i + 1),
      close: ohlcv.close.slice(0, i + 1),
      volume: ohlcv.volume.slice(0, i + 1),
    };

    // Simular el ciclo de decisión
    const indicators = computeIndicators(currentSlice, config.indicatorParams);
    // Para este backtest, asumimos que no hay noticias y la señal de sentimiento/predicción es neutral
    const risk = assessRisk({ upcomingEvents: [], indicators });

    if (!risk.allowed) continue;

    const signal = getFinalScore({
        signals: { tech: { score: indicators.rsi > 50 ? 0.7 : 0.3, direction: indicators.rsi > 50 ? 'CALL' : 'PUT' } }, // Lógica de señal simplificada para backtest
        symbol: config.backtestParams.symbol,
    });

    if (signal.finalScore > 0.7) {
      const stake = calculateStake({ bankroll, recommendedStakePct: risk.recommendedStakePct });
      const entryPrice = ohlcv.close[i];
      const exitPrice = ohlcv.close[i + config.backtestParams.expiryCandles];

      let result = 'loss';
      if ((signal.direction === 'CALL' && exitPrice > entryPrice) || (signal.direction === 'PUT' && exitPrice < entryPrice)) {
        result = 'win';
      }

      const profit = result === 'win' ? stake * 0.85 : -stake;
      bankroll += profit;

      trades.push({ index: i, direction: signal.direction, result, profit, bankroll });
    }
    history.push(bankroll);
  }

  // 4. Reportar resultados
  logger.info('*** Resultados del Backtest ***');
  const wins = trades.filter(t => t.result === 'win').length;
  const losses = trades.filter(t => t.result === 'loss').length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  logger.info(`Período de prueba: ${trades.length} operaciones`);
  logger.info(`- Aciertos: ${wins}`);
  logger.info(`- Fallos: ${losses}`);
  logger.info(`- Tasa de Acierto (Win Rate): ${winRate.toFixed(2)}%`);
  logger.info(`- Beneficio/Pérdida Final: ${(bankroll - config.backtestParams.initialBankroll).toFixed(2)}`);
  logger.info(`- Capital Final: ${bankroll.toFixed(2)}`);
}

// Para ejecutar el backtester desde la línea de comandos: node atlas-bot/backtest/backtester.js
if (require.main === module) {
  runBacktest().catch(error => {
    logger.error("El backtest ha fallado de forma inesperada.", error);
  });
}

module.exports = {
  runBacktest,
  fetchHistoricalData,
};
