/**
 * compound-logic.js - Módulo de Cálculo de Tamaño de Operación (Versión Refactorizada)
 *
 * Función:
 * - Proporcionar una función pura para calcular el tamaño de la apuesta (stake)
 *   para una operación, basado en el capital y el riesgo recomendado.
 * - Aplicar límites de seguridad absolutos.
 * - Este módulo es stateless.
 */

require('dotenv').config();

// === CONFIGURACIÓN ===
// Se cargan los valores desde las variables de entorno para la configuración centralizada.
const config = {
  // El capital por defecto si no se proporciona uno en tiempo real.
  defaultBankroll: parseFloat(process.env.DEFAULT_BANKROLL) || 1000,
  // Límites absolutos para el tamaño de la operación, como medida de seguridad.
  minStakeAbsolute: parseFloat(process.env.MIN_STAKE_ABSOLUTE) || 1,
  maxStakeAbsolute: parseFloat(process.env.MAX_STAKE_ABSOLUTE) || 100,
};

/**
 * Calcula el tamaño de la apuesta (stake) para una operación.
 *
 * @param {object} params - Parámetros para el cálculo.
 * @param {number} params.bankroll - El capital actual disponible. Si no se proporciona, se usa el valor por defecto.
 * @param {number} params.recommendedStakePct - El porcentaje de riesgo recomendado por el riskmap-ia (ej. 1.0 para 1%).
 *
 * @returns {number} - El tamaño de la apuesta final, ajustado a los límites de seguridad.
 */
function calculateStake({ bankroll = config.defaultBankroll, recommendedStakePct }) {
  if (typeof bankroll !== 'number' || bankroll <= 0) {
    throw new Error(`El capital (bankroll) proporcionado no es válido: ${bankroll}`);
  }
  if (typeof recommendedStakePct !== 'number' || recommendedStakePct < 0) {
    throw new Error(`El porcentaje de riesgo recomendado no es válido: ${recommendedStakePct}`);
  }

  // 1. Calcular el stake basado en el porcentaje de riesgo.
  // Se divide por 100 para convertir el porcentaje (ej. 1.0) a un multiplicador (0.01).
  const rawStake = bankroll * (recommendedStakePct / 100);

  // 2. Aplicar los límites de seguridad (mínimo y máximo absoluto).
  const clampedStake = Math.max(config.minStakeAbsolute, Math.min(rawStake, config.maxStakeAbsolute));

  // 3. Redondear a 2 decimales, ya que se trata de dinero.
  const finalStake = Math.round(clampedStake * 100) / 100;

  return finalStake;
}

module.exports = {
  calculateStake,
};
