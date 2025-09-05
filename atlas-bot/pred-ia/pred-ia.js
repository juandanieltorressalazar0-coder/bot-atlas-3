/**
 * pred-ia.js - Módulo de Predicción con IA para Kamikaze Rip A.T.L.A.S.
 *
 * Función:
 * - Entrenar un modelo de regresión logística para predecir movimientos de precios.
 * - Usar características técnicas y de sentimiento para generar señales.
 * - Persistir el modelo entrenado en disco.
 * - Proporcionar predicciones en tiempo real.
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { LogisticRegression } = require('ml-logistic-regression');

// === CONFIGURACIÓN ===
const config = {
  MODEL_FILE: path.join(__dirname, 'pred-ia-model.json'),
  LOG_FILE: path.join(__dirname, 'pred-ia.log'),
  TRAINING_DATA_FILE: path.join(__dirname, 'training-data.json'),
  FEATURES: ['rsi', 'ema', 'sentiment', 'volatility'], // Características para el modelo
  TARGET: 'direction', // Variable objetivo (1: CALL, 0: PUT)
  MIN_TRAINING_SAMPLES: 100, // Mínimo de muestras para entrenar
  RETRAIN_INTERVAL: 30, // Cada cuántas operaciones se reentrena el modelo
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

// === ESTADO DEL MÓDULO ===
let state = {
  model: null,
  trainingData: [],
  lastTrained: null,
  accuracy: 0,
  tradeCount: 0,
};

// === CARGAR MODELO DESDE DISCO ===
async function loadModel() {
  try {
    if (await fileExists(config.MODEL_FILE)) {
      const data = await fs.readFile(config.MODEL_FILE, 'utf8');
      const modelData = JSON.parse(data);

      // Cargar modelo entrenado
      const model = new LogisticRegression();
      model.weights = modelData.weights;
      model.bias = modelData.bias;

      state.model = model;
      state.lastTrained = modelData.lastTrained;
      state.accuracy = modelData.accuracy;
      state.trainingDataSize = modelData.trainingDataSize;

      logger.info(`🟢 Pred-IA: Modelo cargado. Precisión: ${(state.accuracy * 100).toFixed(1)}% | Entrenado con ${state.trainingDataSize} muestras.`);
    } else {
      // Crear modelo vacío
      state.model = new LogisticRegression();
      await saveModel();
      logger.info('🆕 Pred-IA: Modelo inicial creado. Necesita entrenamiento.');
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar modelo: ${error.message}`);
    // Crear modelo limpio en caso de error
    state.model = new LogisticRegression();
    await saveModel();
  }
}

// === GUARDAR MODELO EN DISCO ===
async function saveModel() {
  try {
    const modelData = {
      modelType: 'logistic-regression',
      features: config.FEATURES,
      weights: state.model.weights,
      bias: state.model.bias,
      accuracy: state.accuracy,
      lastTrained: state.lastTrained,
      trainingDataSize: state.trainingDataSize,
    };

    const tempFile = `${config.MODEL_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(modelData, null, 2));
    await fs.rename(tempFile, config.MODEL_FILE);
  } catch (error) {
    logger.error(`❌ Error al guardar modelo: ${error.message}`);
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

// === CARGAR DATOS DE ENTRENAMIENTO ===
async function loadTrainingData() {
  try {
    if (await fileExists(config.TRAINING_DATA_FILE)) {
      const data = await fs.readFile(config.TRAINING_DATA_FILE, 'utf8');
      state.trainingData = JSON.parse(data);
      logger.info(`📊 Pred-IA: ${state.trainingData.length} muestras de entrenamiento cargadas.`);
    } else {
      state.trainingData = [];
      await saveTrainingData();
      logger.info('🆕 Pred-IA: Archivo de datos de entrenamiento creado.');
    }
  } catch (error) {
    logger.error(`⚠️ Error al cargar datos de entrenamiento: ${error.message}`);
    state.trainingData = [];
    await saveTrainingData();
  }
}

// === GUARDAR DATOS DE ENTRENAMIENTO ===
async function saveTrainingData() {
  try {
    const tempFile = `${config.TRAINING_DATA_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(state.trainingData, null, 2));
    await fs.rename(tempFile, config.TRAINING_DATA_FILE);
  } catch (error) {
    logger.error(`❌ Error al guardar datos de entrenamiento: ${error.message}`);
  }
}

// === AÑADIR MUESTRA DE ENTRENAMIENTO ===
async function addTrainingSample(sample) {
  try {
    state.trainingData.push(sample);
    await saveTrainingData();
    logger.info(`📈 Pred-IA: Muestra añadida. Total: ${state.trainingData.length}`);
  } catch (error) {
    logger.error(`❌ Error al añadir muestra: ${error.message}`);
  }
}

// === ENTRENAR MODELO ===
async function trainModel() {
  try {
    if (state.trainingData.length < config.MIN_TRAINING_SAMPLES) {
      logger.warn(`⚠️ Pred-IA: No hay suficientes muestras para entrenar (${state.trainingData.length}/${config.MIN_TRAINING_SAMPLES}).`);
      return;
    }

    logger.info('🛠️ Pred-IA: Entrenando modelo...');

    // Preparar datos para entrenamiento
    const X = state.trainingData.map(sample => config.FEATURES.map(feature => sample[feature]));
    const y = state.trainingData.map(sample => sample[config.TARGET]);

    // Entrenar modelo
    state.model.train(X, y);

    // Evaluar precisión (simplificado)
    const predictions = X.map(x => state.model.predict(x));
    const correct = predictions.reduce((acc, pred, i) => acc + (pred === y[i] ? 1 : 0), 0);
    state.accuracy = correct / predictions.length;
    state.lastTrained = new Date().toISOString();
    state.trainingDataSize = state.trainingData.length;

    await saveModel();
    logger.info(`🎯 Pred-IA: Modelo entrenado con ${state.trainingDataSize} muestras. Precisión: ${(state.accuracy * 100).toFixed(1)}%`);
  } catch (error) {
    logger.error(`❌ Error al entrenar modelo: ${error.message}`);
  }
}

// === PREDECIR DIRECCIÓN ===
function predictDirection(features) {
  try {
    if (!state.model) {
      throw new Error('Modelo no entrenado');
    }

    const input = config.FEATURES.map(feature => features[feature]);
    const prediction = state.model.predict(input);

    return {
      direction: prediction === 1 ? 'CALL' : 'PUT',
      confidence: state.accuracy,
      featuresUsed: config.FEATURES,
    };
  } catch (error) {
    logger.error(`❌ Error al predecir: ${error.message}`);
    return {
      direction: 'PUT', // Default conservador
      confidence: 0.5,
      error: error.message,
    };
  }
}

// === INICIALIZAR MÓDULO ===
async function initPredIA() {
  await loadModel();
  await loadTrainingData();
  logger.info('🟢 Pred-IA: Módulo de predicción iniciado.');
}

// === EXPORTAR MÓDULO ===
module.exports = {
  initPredIA,
  addTrainingSample,
  trainModel,
  predictDirection,
  getState: () => ({ ...state }),
};
