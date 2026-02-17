/**
 * Node.js сервер для приёма данных от ESP8266/STM32
 *
 * Функции:
 * - HTTP сервер на порту 3000
 * - Приём JSON данных от ESP
 * - Логирование данных в консоль
 * - Будущее: веб-интерфейс, управление моторами
 *
 * Установка:
 *   npm install express
 *
 * Запуск:
 *   node server.js
 */

const express = require('express');
const app = express();
const PORT = 3000;

// Middleware для парсинга JSON
app.use(express.json());

// Middleware для логирования запросов
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// ============================================================================
// МАРШРУТЫ (ROUTES)
// ============================================================================

/**
 * Главная страница
 */
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>STM32 Robot Server</title>
            <style>
                body { font-family: monospace; margin: 40px; background: #1e1e1e; color: #d4d4d4; }
                h1 { color: #4ec9b0; }
                code { background: #2d2d2d; padding: 2px 6px; border-radius: 3px; color: #ce9178; }
                .box { background: #252526; padding: 20px; border-radius: 5px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <h1>🤖 STM32 Robot Control Server</h1>
            <div class="box">
                <h2>Status: ✅ Running</h2>
                <p>Server listening on port <code>${PORT}</code></p>
                <p>Waiting for data from ESP8266...</p>
            </div>
            <div class="box">
                <h3>Available endpoints:</h3>
                <ul>
                    <li><code>GET /</code> - This page</li>
                    <li><code>POST /data</code> - Receive telemetry data</li>
                    <li><code>GET /status</code> - Server status</li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

/**
 * Эндпоинт для приёма данных от ESP (STM32)
 */
app.post('/data', (req, res) => {
    const timestamp = new Date().toISOString();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[${timestamp}] 📦 Получены данные от STM32:`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Красивый вывод данных
    if (req.body) {
        console.log(JSON.stringify(req.body, null, 2));

        // Специальная обработка для разных типов данных
        if (req.body.button !== undefined) {
            console.log(`\n🔘 Кнопка ${req.body.button}: ${req.body.state}`);
        }

        if (req.body.motor !== undefined) {
            console.log(`\n🔧 Мотор ${req.body.motor}:`);
            console.log(`   Направление: ${req.body.direction || 'N/A'}`);
            console.log(`   Скорость: ${req.body.speed || 0}%`);
        }

        if (req.body.motors) {
            console.log('\n🚗 Состояние всех моторов:');
            req.body.motors.forEach((motor, index) => {
                console.log(`   Мотор ${index}: ${motor.state} (${motor.speed}%)`);
            });
        }

        if (req.body.rpm !== undefined) {
            console.log(`\n⚡ RPM: ${req.body.rpm}`);
        }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Отправка ответа ESP
    res.json({
        status: 'OK',
        message: 'Data received',
        timestamp: timestamp
    });
});

/**
 * Статус сервера
 */
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

/**
 * 404 - Not Found
 */
app.use((req, res) => {
    res.status(404).send('404 - Not Found');
});

// ============================================================================
// ЗАПУСК СЕРВЕРА
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.clear();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 STM32 Robot Control Server');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n✅ Server running on: http://localhost:${PORT}`);
    console.log(`📡 Network address: http://${getLocalIP()}:${PORT}`);
    console.log(`\n📝 Waiting for data from ESP8266...\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// ============================================================================
// УТИЛИТЫ
// ============================================================================

/**
 * Получить локальный IP адрес
 */
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Пропускаем внутренние (localhost) и IPv6 адреса
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }

    return '0.0.0.0';
}

// ============================================================================
// ОБРАБОТКА ОШИБОК
// ============================================================================

process.on('uncaughtException', (error) => {
    console.error('\n❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('\n❌ Unhandled Rejection:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down server...');
    process.exit(0);
});
