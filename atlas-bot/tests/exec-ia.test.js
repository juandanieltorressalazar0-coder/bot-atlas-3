const execIA = require('../exec-ia/exec-ia');

// Mockear las dependencias para aislar el módulo
jest.mock('../utils/helpers', () => ({
  ...jest.requireActual('../utils/helpers'), // Mantener las funciones reales que no queremos mockear
  saveJsonFile: jest.fn().mockResolvedValue(true),
  readJsonFile: jest.fn().mockResolvedValue({ openTrades: [] }),
  fileExists: jest.fn().mockResolvedValue(true),
}));

describe('Execution IA Module (Backtest Mode)', () => {
  beforeEach(async () => {
    // Reiniciar el estado del módulo antes de cada prueba, forzando el modo backtest
    await execIA.init({ backtestMode: true });
    // Limpiar cualquier operación abierta de pruebas anteriores
    execIA.getOpenTrades().length = 0;
  });

  test('placeTrade should simulate a trade in backtest mode', async () => {
    const tradeParams = {
      symbol: 'EURUSD',
      direction: 'CALL',
      stake: 10,
      expiryMinutes: 5,
    };

    const tradeId = await execIA.placeTrade(tradeParams);

    // Verificar que se devolvió un ID de operación simulado
    expect(tradeId).toContain('sim-');

    // Verificar que la operación está en la lista de operaciones abiertas
    const openTrades = execIA.getOpenTrades();
    expect(openTrades).toHaveLength(1);
    expect(openTrades[0].tradeId).toBe(tradeId);
    expect(openTrades[0].symbol).toBe('EURUSD');
    expect(openTrades[0].status).toBe('open');
  });

  test('checkTradeResult should return "open" for a trade that has not expired', async () => {
    const tradeParams = {
      symbol: 'EURUSD',
      direction: 'PUT',
      stake: 25,
      expiryMinutes: 60, // Expira en 1 hora
    };
    await execIA.placeTrade(tradeParams);
    const trade = execIA.getOpenTrades()[0];

    const result = await execIA.checkTradeResult(trade);

    expect(result.status).toBe('open');
  });

  test('checkTradeResult should return "closed" for an expired trade', async () => {
    const tradeParams = {
      symbol: 'EURUSD',
      direction: 'CALL',
      stake: 10,
      expiryMinutes: -1, // Expiró hace 1 minuto
    };
    await execIA.placeTrade(tradeParams);
    const trade = execIA.getOpenTrades()[0];

    const result = await execIA.checkTradeResult(trade);

    expect(result.status).toBe('closed');
    expect(result).toHaveProperty('result'); // 'win' or 'loss'
    expect(result).toHaveProperty('profit');
  });

  test('removeTrade should remove a trade from the openTrades list', async () => {
    const tradeParams = {
      symbol: 'EURUSD',
      direction: 'CALL',
      stake: 10,
      expiryMinutes: 5,
    };
    const tradeId = await execIA.placeTrade(tradeParams);

    expect(execIA.getOpenTrades()).toHaveLength(1);

    await execIA.removeTrade(tradeId);

    expect(execIA.getOpenTrades()).toHaveLength(0);
  });
});
