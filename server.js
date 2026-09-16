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

// Rota de Login (substitui o PHP)
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ success: false, error: 'E-mail e senha são obrigatórios.' });
    }

    try {
        const token = 'Sapu2024AdmToken';
        const apiUrl = 'https://www.suportedksoft.com.br/sapu/adm/APILoginSapu.php';
        
        const formData = new URLSearchParams();
        formData.append('email', email);
        formData.append('senha', senha);
        formData.append('token', token);

        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        const data = await response.json();

        if (data && data.status === 'success') {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: data.message || 'E-mail ou senha incorretos.' });
        }
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ success: false, error: 'Erro ao conectar na API de Login do SAPU.' });
    }
});

// Retorna o status e o QR code
app.get('/api/qr', (req, res) => {
    if (isConnected) {
        let connectedNumber = '';
        if (sock && sock.user && sock.user.id) {
            // Remove o sufixo e possíveis : device IDs
            connectedNumber = sock.user.id.split(':')[0].split('@')[0];
        }
        res.json({ status: 'connected', qr: null, user: connectedNumber });
    } else if (currentQR) {
        res.json({ status: 'pending', qr: currentQR });
    } else {
        res.json({ status: 'initializing', qr: null });
    }
});

// Retorna os grupos que o WhatsApp participa (para descobrir o ID do grupo)
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
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: 'Failed to fetch groups' });
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
    
    // Verifica se já possui o sufixo de grupo (@g.us) ou usuário (@s.whatsapp.net)
    if (!targetNumber.includes('@')) {
        targetNumber = `${targetNumber}@s.whatsapp.net`;
    }

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
