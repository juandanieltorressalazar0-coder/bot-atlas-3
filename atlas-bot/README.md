# A.T.L.A.S. Bot - Sistema de Trading Automatizado

Este documento describe la arquitectura y el funcionamiento del bot de trading A.T.L.A.S. (Automated Trading & Logical Analysis System).

## ✨ Descripción General

A.T.L.A.S. es un bot de trading diseñado para operar en mercados financieros de forma autónoma. Su arquitectura es modular y se basa en un ciclo de decisión continuo que integra múltiples fuentes de análisis para tomar decisiones informadas.

El sistema está diseñado para ser robusto y funcionar de manera continua en plataformas como Replit, gracias a un servidor web integrado que asegura que el proceso no se detenga.

## 🚀 Arquitectura

El bot opera sobre un orquestador central (`atlas-automation.js`) que ejecuta un ciclo de trading a intervalos regulares. En cada ciclo, el bot:
1.  **Recolecta Datos:** Obtiene información de mercado, noticias económicas, etc.
2.  **Analiza:** Procesa los datos a través de varios módulos de IA (Análisis Técnico, de Sentimiento, etc.).
3.  **Puntúa la Señal:** El módulo `signalrank-ia` combina todos los análisis en una única puntuación de confianza.
4.  **Evalúa el Riesgo:** El módulo `riskmap-ia` evalúa las condiciones del mercado (volatilidad, noticias) para aprobar o denegar la operación y recomendar un nivel de riesgo.
5.  **Calcula el Stake:** El módulo `compound-logic` determina el tamaño de la operación basándose en el capital y el riesgo recomendado.
6.  **Ejecuta:** Si la señal es fuerte y el riesgo es aceptable, el módulo `exec-ia` coloca la operación (ya sea en modo real o simulado).

## 🔧 Instalación y Configuración

Sigue estos pasos para poner en marcha el bot:

**1. Dependencias:**
Asegúrate de tener Node.js (v18 o superior) instalado.

**2. Clonar y Navegar:**
```bash
# Clona este repositorio (si no lo has hecho)
# git clone ...
cd atlas-bot
```

**3. Instalar Paquetes:**
```bash
npm install
```
Este comando instalará todas las dependencias listadas en `package.json`.

**4. Configurar Variables de Entorno:**
Crea un archivo `.env` en el directorio `atlas-bot/`. Puedes copiar la plantilla `env.example` para empezar:
```bash
cp .env.example .env
```
Ahora, edita el archivo `.env` y rellena todas las variables con tus propios valores (API keys, credenciales del broker, etc.).

**Variables Clave:**
- `BACKTEST_MODE`: Ponlo en `true` para simulación y `false` para operar en vivo (con cuenta demo primero).
- `ALPHAVANTAGE_KEY`: Necesaria para el backtester.
- `IQ_OPTION_EMAIL` / `IQ_OPTION_PASSWORD`: Para el modo en vivo.
- `MIN_SIGNAL_SCORE`: El umbral de confianza para abrir una operación (ej. `0.7`).

## 🏃‍♀️ Cómo Ejecutar el Bot

### Modo de Producción (Continuo)
Este comando inicia el bot como un servicio continuo. Usará el servidor web para mantenerse activo.
```bash
npm start
```
El bot comenzará a ejecutar su ciclo de trading según el `OPERATION_INTERVAL` definido en el `.env`.

### Modo de Desarrollo
Este comando usa `nodemon` para reiniciar el bot automáticamente cada vez que guardas un cambio en el código.
```bash
npm run dev
```

### Ejecutar el Backtester
Para probar la estrategia sobre datos históricos, ejecuta el siguiente comando. El backtester descargará los datos necesarios de Alpha Vantage y reportará el rendimiento.
```bash
node backtest/backtester.js
```
Asegúrate de que tu `ALPHAVANTAGE_KEY` esté configurada en el archivo `.env`.

## 🔬 Módulos Principales

- **`atlas-automation.js`**: El corazón del bot. Orquesta todos los demás módulos.
- **`utils/`**: Contiene funciones de ayuda, como el logger y el fetch con reintentos.
- **`scraping/`**: Módulo para extraer el calendario económico de Forex Factory.
- **`tech-ia/`**: Calcula indicadores técnicos (RSI, EMA, etc.) a partir de datos de mercado.
- **`riskmap-ia/`**: Evalúa el riesgo de una operación antes de ejecutarla.
- **`compound-logic/`**: Calcula el tamaño de la operación.
- **`signalrank-ia/`**: El cerebro que combina todas las señales y genera una puntuación final.
- **`exec-ia/`**: El "brazo" que ejecuta las operaciones en el broker o en modo de simulación.
- **`backtest/`**: El motor para simular y evaluar la estrategia sobre datos históricos.
