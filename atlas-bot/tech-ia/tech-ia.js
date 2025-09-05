/**
 * tech-ia.js - Módulo de Análisis Técnico (Versión Refactorizada)
 *
 * Función:
 * - Proporcionar una función pura para calcular un conjunto de indicadores técnicos
 *   a partir de datos de mercado (OHLCV).
 * - Este módulo es stateless y no guarda información en disco.
 */

const { RSI, EMA, MACD, ATR } = require('technicalindicators');

/**
 * Calcula un conjunto de indicadores técnicos para una serie de datos de mercado.
 *
 * @param {object} ohlcv - Objeto que contiene arrays de datos de mercado.
 * @param {number[]} ohlcv.open - Precios de apertura.
 * @param {number[]} ohlcv.high - Precios máximos.
 * @param {number[]} ohlcv.low - Precios mínimos.
 * @param {number[]} ohlcv.close - Precios de cierre.
 * @param {number[]} ohlcv.volume - Volúmenes.
 * @param {object} params - Parámetros para los indicadores.
 * @param {number} params.rsiPeriod - Período para el RSI.
 * @param {number[]} params.emaPeriods - Array de períodos para las EMAs.
 * @param {object} params.macdParams - Parámetros para el MACD.
 * @param {number} params.atrPeriod - Período para el ATR.
 * @returns {object} - Un objeto con los valores más recientes de los indicadores calculados.
 */
function computeIndicators(ohlcv, params) {
  if (!ohlcv || !ohlcv.close || ohlcv.close.length === 0) {
    throw new Error('Los datos de entrada (ohlcv.close) son insuficientes para calcular indicadores.');
  }

  const results = {};

  // Calcular RSI
  if (params.rsiPeriod && ohlcv.close.length > params.rsiPeriod) {
    const rsiInput = { values: ohlcv.close, period: params.rsiPeriod };
    const rsiResult = RSI.calculate(rsiInput);
    results.rsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;
  }

  // Calcular EMAs
  if (params.emaPeriods && params.emaPeriods.length > 0) {
    results.emas = {};
    params.emaPeriods.forEach(period => {
      if (ohlcv.close.length > period) {
        const emaInput = { values: ohlcv.close, period };
        const emaResult = EMA.calculate(emaInput);
        results.emas[`ema${period}`] = emaResult.length > 0 ? emaResult[emaResult.length - 1] : null;
      }
    });
  }

  // Calcular MACD
  if (params.macdParams && ohlcv.close.length > params.macdParams.slowPeriod) {
    const macdInput = {
      values: ohlcv.close,
      ...params.macdParams,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    };
    const macdResult = MACD.calculate(macdInput);
    results.macd = macdResult.length > 0 ? macdResult[macdResult.length - 1] : null;
  }

  // Calcular ATR
  if (params.atrPeriod && ohlcv.high && ohlcv.low && ohlcv.close.length > params.atrPeriod) {
    const atrInput = {
      high: ohlcv.high,
      low: ohlcv.low,
      close: ohlcv.close,
      period: params.atrPeriod,
    };
    const atrResult = ATR.calculate(atrInput);
    results.atr = atrResult.length > 0 ? atrResult[atrResult.length - 1] : null;
  }

  /*
   * NOTA PARA FUTURA EXPANSIÓN (Multi-Timeframe):
   * Para implementar análisis Multi-Timeframe (MTF), esta función podría ser llamada
   * varias veces con datos de diferentes temporalidades (ej. M15, H1).
   *
   * Ejemplo:
   * const m15_data = await getMarketData('EURUSD', '15m');
   * const h1_data = await getMarketData('EURUSD', '1h');
   *
   * const m15_indicators = computeIndicators(m15_data, params);
   * const h1_indicators = computeIndicators(h1_data, params);
   *
   * Luego, un módulo de nivel superior combinaría estos resultados para determinar una tendencia general.
   */

  return results;
}

// === EXPORTAR MÓDULO ===
module.exports = {
  computeIndicators,
};
