const fs = require('fs').promises;
const path = require('path');
const { saveJsonFile, readJsonFile, fileExists } = require('../utils/helpers');

describe('File Helper Functions', () => {
  const testDir = path.join(__dirname, 'test-data');
  const testFilePath = path.join(testDir, 'test.json');

  beforeAll(async () => {
    // Crear un directorio de prueba
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    // Limpiar el directorio de prueba
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('saveJsonFile should write a file that can be read by readJsonFile', async () => {
    const testData = {
      id: 1,
      message: 'Hello, World!',
      nested: {
        value: true,
      },
    };

    // 1. Guardar el archivo JSON
    await saveJsonFile(testFilePath, testData);

    // 2. Verificar que el archivo existe
    const exists = await fileExists(testFilePath);
    expect(exists).toBe(true);

    // 3. Leer el archivo y verificar su contenido
    const readData = await readJsonFile(testFilePath);
    expect(readData).toEqual(testData);
  });

  test('readJsonFile should throw an error for a non-existent file', async () => {
    const nonExistentPath = path.join(testDir, 'non-existent.json');
    // Se espera que la promesa sea rechazada (lance un error)
    await expect(readJsonFile(nonExistentPath)).rejects.toThrow();
  });

  test('fileExists should return false for a non-existent file', async () => {
    const nonExistentPath = path.join(testDir, 'non-existent.json');
    const exists = await fileExists(nonExistentPath);
    expect(exists).toBe(false);
  });
});
