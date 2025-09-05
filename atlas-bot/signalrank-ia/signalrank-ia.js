/**
 * signalrank-ia.js - Módulo de Ranking de Señales y Decisión (Versión Refactorizada)
 *
 * Función:
 * - Combinar las puntuaciones de múltiples módulos de análisis en una única puntuación final.
 * - Aplicar una fórmula de ponderación configurable.
 * - Implementar lógica de cooldown y de-duplicación para evitar sobreoperar.
 * - Este módulo es stateless.
 */

require('dotenv').config();

// === CONFIGURACIÓN ===
const config = {
  // Pesos para cada fuente de señal. La suma no tiene por qué ser 1.
  weights: {
    tech: parseFloat(process.env.WEIGHT_TECH) || 0.5,
    sent: parseFloat(process.env.WEIGHT_SENT) || 0.2,
    pred: parseFloat(process.env.WEIGHT_PRED) || 0.2,
    // La volatilidad no es una señal, sino un penalizador.
    volatilityPenalty: parseFloat(process.env.WEIGHT_VOL_PENALTY) || 0.1,
  },
  // Umbral mínimo para considerar una operación.
  minSignalScore: parseFloat(process.env.MIN_SIGNAL_SCORE) || 0.7,
  // Minutos a esperar antes de abrir otra operación en el mismo par y dirección.
  cooldownMinutes: parseInt(process.env.COOLDOWN_MINUTES, 10) || 15,
};

/**
 * Calcula la puntuación final para una oportunidad de trading.
 *
 * @param {object} params - Parámetros para el cálculo.
 * @param {object} params.signals - Objeto con las señales de los diferentes módulos.
 *   Ej: { tech: { score: 0.8, direction: 'CALL' }, sent: { score: 0.6 }, ... }
 * @param {Array} params.openTrades - Array de operaciones actualmente abiertas.
 *   Ej: [{ symbol: 'EURUSD', direction: 'CALL', ... }]
 * @param {object} params.lastTradeTimes - Objeto que mapea 'symbol-direction' a un timestamp.
 *   Ej: { 'EURUSD-CALL': 1678886400000 }
 * @param {string} params.symbol - El símbolo del activo a evaluar, ej: 'EURUSD'.
 *
 * @returns {{finalScore: number, direction: string, reason: string}}
 */
function getFinalScore({ signals, openTrades = [], lastTradeTimes = {}, symbol }) {
  // La dirección principal la dicta la señal técnica, que es la más fuerte.
  const primaryDirection = signals.tech?.direction;
  if (!primaryDirection || primaryDirection === 'HOLD') {
    return { finalScore: 0, direction: 'HOLD', reason: 'La señal técnica principal es HOLD.' };
  }

  // 1. De-duplicación: No operar si ya hay una operación abierta en la misma dirección.
  const hasOpenTrade = openTrades.some(
    trade => trade.symbol === symbol && trade.direction === primaryDirection
  );
  if (hasOpenTrade) {
    return { finalScore: 0, direction: 'HOLD', reason: `Ya hay una operación ${primaryDirection} abierta para ${symbol}.` };
  }

  // 2. Cooldown: No operar si se ha hecho una operación reciente en la misma dirección.
  const cooldownKey = `${symbol}-${primaryDirection}`;
  const lastTradeTime = lastTradeTimes[cooldownKey];
  if (lastTradeTime) {
    const now = Date.now();
    const diffMinutes = (now - lastTradeTime) / (1000 * 60);
    if (diffMinutes < config.cooldownMinutes) {
      return {
        finalScore: 0,
        direction: 'HOLD',
        reason: `Cooldown activo para ${symbol} ${primaryDirection}. Esperando ${(config.cooldownMinutes - diffMinutes).toFixed(1)} min.`,
      };
    }
  }

  // 3. Algoritmo de Puntuación Ponderada
  let finalScore = 0;
  let reason = 'Puntuación base:';

  // Normalizar scores: si la dirección de una señal secundaria no coincide, su score se vuelve negativo.
  const techScore = signals.tech?.score || 0;
  const sentScore = (signals.sent?.direction === primaryDirection ? 1 : -1) * (signals.sent?.score || 0);
  const predScore = (signals.pred?.direction === primaryDirection ? 1 : -1) * (signals.pred?.score || 0);

  finalScore =
    (config.weights.tech * techScore) +
    (config.weights.sent * sentScore) +
    (config.weights.pred * predScore);

  reason += ` | Tech: ${(config.weights.tech * techScore).toFixed(2)}`;
  reason += ` | Sent: ${(config.weights.sent * sentScore).toFixed(2)}`;
  reason += ` | Pred: ${(config.weights.pred * predScore).toFixed(2)}`;

  // 4. Aplicar penalizador de volatilidad (si existe)
  // Se asume que vol.penalty es un valor entre 0 y 1.
  const volPenalty = signals.vol?.penalty || 0;
  finalScore -= (config.weights.volatilityPenalty * volPenalty);
  reason += ` | Vol Penalty: ${-(config.weights.volatilityPenalty * volPenalty).toFixed(2)}`;

  // 5. Normalizar el score final para que esté entre 0 y 1.
  const normalizedScore = Math.max(0, Math.min(1, finalScore));

  // 6. Aplicar el umbral final
  if (normalizedScore < config.minSignalScore) {
    reason = `Puntuación final (${normalizedScore.toFixed(2)}) por debajo del umbral (${config.minSignalScore}). | ` + reason;
    return { finalScore: normalizedScore, direction: 'HOLD', reason };
  }

  return { finalScore: normalizedScore, direction: primaryDirection, reason };
}

module.exports = {
  getFinalScore,
};
