const express = require('express');
const cors = require('cors');
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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
    
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            currentQR = await QRCode.toDataURL(qr);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Connection closed. You are logged out.');
                if (fs.existsSync('auth_info_baileys')) {
                    fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                }
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = '';
        }
    });
}

connectToWhatsApp();

app.get('/api/qr', (req, res) => {
    if (isConnected) {
        res.json({ status: 'connected', user: sock?.user?.id });
    } else if (currentQR) {
        res.json({ status: 'pending', qr: currentQR });
    } else {
        res.json({ status: 'initializing' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ success: false, error: 'E-mail e senha so obrigatrios.' });
    }

    try {
        const token = 'Sapu2024AdmToken';
        const apiUrl = 'https://www.suportedksoft.com.br/sapu/adm/APILoginSapu.php';
        
        const formData = new URLSearchParams();
        formData.append('email', email);
        formData.append('senha', senha);
        formData.append('token', token);

        const response = await fetch(apiUrl, { method: 'POST', body: formData });
        const text = await response.text();

        if (text.includes('1')) {
            res.json({ success: true, email });
        } else {
            res.json({ success: false, error: 'Credenciais invlidas' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro de conexo.' });
    }
});

app.post('/api/servidores', async (req, res) => {
    const payload = req.body;
    payload.token = 'Sapu2024AdmToken';

    try {
        const response = await fetch('https://www.suportedksoft.com.br/sapu/adm/acoes/api_servidores.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro de conexo com servidor SAPU' });
    }
});

app.get('/api/grupos', async (req, res) => {
    if (!isConnected || !sock) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }
    try {
        const chats = await sock.groupFetchAllParticipating();
        const groups = Object.values(chats).map(group => ({
            id: group.id,
            subject: group.subject
        }));
        res.json({ groups });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch groups', details: err.message });
    }
});

app.post('/api/logout', (req, res) => {
    if (sock) {
        sock.logout();
        isConnected = false;
        res.json({ success: true, message: 'Logged out' });
    } else {
        res.status(400).json({ error: 'Not connected' });
    }
});

app.post('/api/webhook', async (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }

    const payload = req.body;
    let title = payload.title || 'Alerta Grafana';
    let messageBody = payload.message || '';
    let state = payload.state || 'Alerting';
    
    const message = `🚨 *${title}* 🚨\nEstado: ${state}\n${messageBody}`;
    
    let targetNumber = req.query.number;
    if (!targetNumber) {
        return res.status(400).json({ error: 'Number query parameter is required.' });
    }
    
    targetNumber = targetNumber.trim();
    if (!targetNumber.includes('@')) {
        targetNumber = targetNumber.length > 15 ? `${targetNumber}@g.us` : `${targetNumber}@s.whatsapp.net`;
    }

    try {
        // Se for grupo, ignora erros de fetch metadata
        if (targetNumber.includes('@g.us')) {
            try {
                await sock.groupMetadata(targetNumber);
            } catch (metaErr) {}
        }
        await sock.sendMessage(targetNumber, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send message', details: error.message || error.toString() });
    }
});

app.listen(3000, () => {
    console.log('API Server running on port 3000');
});
