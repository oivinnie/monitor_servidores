const express = require('express');
const cors = require('cors');
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let currentQR = '';
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            currentQR = await QRCode.toDataURL(qr);
            isConnected = false;
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = '';
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== 401;
            if (shouldReconnect) {
                console.log('Reconnecting...');
                connectToWhatsApp();
            } else {
                console.log('Connection closed. You are logged out.');
                // Delete auth_info_baileys folder so it can generate a new QR
                if (fs.existsSync('auth_info_baileys')) {
                    fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                }
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = '';
            console.log('WhatsApp connected!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Retorna o status e o QR code
app.get('/api/qr', (req, res) => {
    if (isConnected) {
        res.json({ status: 'connected', qr: null });
    } else if (currentQR) {
        res.json({ status: 'pending', qr: currentQR });
    } else {
        res.json({ status: 'initializing', qr: null });
    }
});

// Desconectar o WhatsApp
app.post('/api/logout', (req, res) => {
    if (sock) {
        sock.logout();
        isConnected = false;
        res.json({ success: true, message: 'Logged out' });
    } else {
        res.status(400).json({ error: 'Not connected' });
    }
});

// Recebe o Webhook do Grafana
app.post('/api/webhook', async (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }

    const payload = req.body;
    
    // Formata o alerta do Grafana
    // Pode ser customizado dependendo de como o Grafana envia o payload
    let title = payload.title || 'Alerta Grafana';
    let messageBody = payload.message || '';
    let state = payload.state || 'Alerting';
    
    const message = `🚨 *${title}* 🚨\nEstado: ${state}\n${messageBody}`;
    
    // O número deve ser passado pela querystring, ex: /api/webhook?number=5511999999999
    // Se não passar, você pode definir um padrão aqui.
    let targetNumber = req.query.number;
    if (!targetNumber) {
        return res.status(400).json({ error: 'Number query parameter is required. Example: ?number=5511999999999' });
    }
    
    // Formata o número para o padrão do Baileys
    targetNumber = targetNumber.includes('@s.whatsapp.net') ? targetNumber : `${targetNumber}@s.whatsapp.net`;
    
    try {
        await sock.sendMessage(targetNumber, { text: message });
        res.json({ success: true });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
    connectToWhatsApp();
});
