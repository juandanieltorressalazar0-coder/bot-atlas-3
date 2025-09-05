/**
 * riskmap-ia.js - Módulo de Evaluación de Riesgo de Mercado (Versión Refactorizada)
 *
 * Función:
 * - Evaluar el riesgo de una potencial operación ANTES de que se ejecute.
 * - Considerar la volatilidad del mercado (ATR) y los eventos de noticias de alto impacto.
 * - Determinar si una operación está permitida y recomendar el porcentaje de capital a arriesgar.
 * - Este módulo es stateless.
 */

require('dotenv').config();
const path = require('path');
const { setupLogger } = require('../utils/helpers');

// === CONFIGURACIÓN ===
const config = {
  // Ventana de tiempo (en minutos) antes y después de una noticia para no operar.
  newsWindowMinutes: parseInt(process.env.NEWS_WINDOW_MINUTES, 10) || 30,
  // Porcentaje de riesgo por defecto, tomado del .env
  defaultRiskPct: parseFloat(process.env.MAX_RISK_PCT) || 1.0,
  // Porcentaje de riesgo reducido cuando la volatilidad es alta.
  reducedRiskPct: (parseFloat(process.env.MAX_RISK_PCT) || 1.0) / 2,
  // Umbral de ATR (ej. en pips * 10) para considerar la volatilidad como alta.
  // Este valor es muy dependiente del par y del timeframe, necesita calibración.
  maxAtrThreshold: parseFloat(process.env.MAX_ATR_THRESHOLD) || 150,
};

const logger = setupLogger('riskmap-ia', path.join(__dirname, 'logs', 'riskmap-ia.log'));

/**
 * Evalúa el riesgo de una operación propuesta basándose en las condiciones del mercado.
 *
 * @param {object} assessmentParams - Parámetros para la evaluación.
 * @param {object} assessmentParams.signal - La señal de trading propuesta. (Actualmente no se usa, pero se pasa para futuro)
 * @param {Array} assessmentParams.upcomingEvents - Array de eventos de noticias de alto impacto.
 * @param {object} assessmentParams.indicators - Objeto con los valores de los indicadores técnicos.
 * @param {number} assessmentParams.indicators.atr - Valor actual del Average True Range (ATR).
 *
 * @returns {{allowed: boolean, reason: string, recommendedStakePct: number}} - El resultado de la evaluación de riesgo.
 */
function assessRisk({ signal, upcomingEvents, indicators }) {
  const now = new Date();

  // 1. Comprobar ventana de noticias de alto impacto
  if (upcomingEvents && upcomingEvents.length > 0) {
    for (const event of upcomingEvents) {
      const eventTime = new Date(event.timeUTC);
      const diffMinutes = Math.abs((eventTime - now) / (1000 * 60));

      if (diffMinutes <= config.newsWindowMinutes) {
        const reason = `Operación denegada: Noticia de alto impacto "${event.event}" para ${event.currency} en ${diffMinutes.toFixed(1)} minutos.`;
        logger.warn(reason);
        return {
          allowed: false,
          reason,
          recommendedStakePct: 0,
        };
      }
    }
  }

  // 2. Comprobar volatilidad excesiva (ATR)
  let recommendedStakePct = config.defaultRiskPct;
  let reason = 'Riesgo normal. Stake por defecto.';

  if (indicators && indicators.atr && indicators.atr > config.maxAtrThreshold) {
    recommendedStakePct = config.reducedRiskPct;
    reason = `Volatilidad alta detectada (ATR: ${indicators.atr.toFixed(2)} > ${config.maxAtrThreshold}). Stake reducido.`;
    logger.warn(reason);
  }

  // 3. Si todas las comprobaciones pasan, la operación está permitida.
  return {
    allowed: true,
    reason,
    recommendedStakePct,
  };
}

module.exports = {
  assessRisk,
};
