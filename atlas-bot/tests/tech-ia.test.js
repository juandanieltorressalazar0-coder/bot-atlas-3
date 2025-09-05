const { computeIndicators } = require('../tech-ia/tech-ia');
const mockOhlcv = require('./mock-data/ohlcv.json');

describe('Technical Analysis IA Module', () => {
  test('computeIndicators should calculate all indicators correctly', () => {
    const params = {
      rsiPeriod: 14,
      emaPeriods: [10, 20],
      macdParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      atrPeriod: 14,
    };

    const indicators = computeIndicators(mockOhlcv, params);

    // Verificar que todos los indicadores solicitados se calcularon
    expect(indicators).toHaveProperty('rsi');
    expect(indicators).toHaveProperty('emas');
    expect(indicators).toHaveProperty('macd');
    expect(indicators).toHaveProperty('atr');

    // Verificar que los valores calculados son números y están en rangos lógicos.
    // No se comprueba el valor exacto para que la prueba no sea frágil.
    expect(typeof indicators.rsi).toBe('number');
    expect(indicators.rsi).toBeGreaterThanOrEqual(0);
    expect(indicators.rsi).toBeLessThanOrEqual(100);
    expect(typeof indicators.emas.ema10).toBe('number');
    expect(typeof indicators.emas.ema20).toBe('number');
    expect(indicators.macd).toHaveProperty('MACD');
    expect(indicators.macd).toHaveProperty('signal');
    expect(indicators.macd).toHaveProperty('histogram');
    expect(indicators.atr).toBeGreaterThan(0);
  });

  test('computeIndicators should handle insufficient data', () => {
    const insufficientData = {
      close: [1, 2, 3, 4, 5],
      high: [1, 2, 3, 4, 5],
      low: [1, 2, 3, 4, 5],
    };
    const params = { rsiPeriod: 14 };

    const indicators = computeIndicators(insufficientData, params);

    // Con datos insuficientes, los indicadores no deben calcularse
    expect(indicators.rsi).toBeUndefined();
  });

  test('computeIndicators should throw error for empty data', () => {
    // Probar que la función lanza un error si la entrada es inválida
    expect(() => computeIndicators({})).toThrow();
    expect(() => computeIndicators({ close: [] })).toThrow();
  });
});
