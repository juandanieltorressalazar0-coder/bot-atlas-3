/**
 * network-helpers.js - Funciones de utilidad para peticiones de red.
 */

const axios = require('axios');

/**
 * Retrasar la ejecución por un tiempo determinado.
 * @param {number} ms Milisegundos de retraso.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Realizar una petición HTTP con reintentos en caso de fallo.
 * @param {string} url URL a la que hacer la petición.
 * @param {object} opts Opciones para axios (ej. method, headers, data).
 * @param {number} retries Número de reintentos.
 * @param {number} backoff Tiempo de espera inicial en ms.
 * @returns {Promise<object>} La respuesta completa de axios.
 */
async function fetchWithRetry(url, opts = {}, retries = 3, backoff = 500) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await axios({ url, ...opts });
      return response;
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        // eslint-disable-next-line no-await-in-loop
        await delay(backoff * (i + 1)); // Backoff exponencial
      }
    }
  }
  // Lanza un error enriquecido si todos los reintentos fallan
  const errorContext = new Error(`Fallo al ejecutar fetch para ${url} después de ${retries} intentos.`);
  errorContext.originalError = lastError;
  errorContext.url = url;
  errorContext.retries = retries;
  throw errorContext;
}

module.exports = {
  fetchWithRetry,
};
