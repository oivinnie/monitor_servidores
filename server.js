const express = require('express');
const cors = require('cors');
const { makeWASocket, useMultiFileAuthState, makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cria o armazenamento em memória para guardar sessões de chaves de grupos (corrige "No sessions")
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
store.readFromFile('./baileys_store.json');
setInterval(() => {
    store.writeToFile('./baileys_store.json');
}, 10_000);

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
    
    store.bind(sock.ev);

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

// Proxy para consultar/adicionar servidores no SAPU
app.post('/api/servidores', async (req, res) => {
    const { acao, provedor, regiao, nome, ip, link_grafana } = req.body;
    
    try {
        const token = 'Sapu2024AdmToken';
        const apiUrl = 'https://www.suportedksoft.com.br/sapu/adm/acoes/api_servidores.php';
        
        const formData = new URLSearchParams();
        formData.append('token', token);
        formData.append('acao', acao || 'listar');
        
        if (acao === 'adicionar' || acao === 'editar') {
            formData.append('provedor', provedor);
            formData.append('regiao', regiao);
            formData.append('nome', nome);
            formData.append('ip', ip);
            if (req.body.nome_antigo) formData.append('nome_antigo', req.body.nome_antigo);
            if (req.body.link_grafana) formData.append('link_grafana', req.body.link_grafana);
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Erro na API de servidores:', error);
        res.status(500).json({ status: 'error', message: 'Falha na comunicação com a API' });
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

// Retorna o último erro de webhook para debug
app.get('/api/lasterror', (req, res) => {
    try {
        const error = fs.readFileSync('last_webhook_error.txt', 'utf8');
        res.send(`<pre>${error}</pre>`);
    } catch (e) {
        res.send('Nenhum erro registrado.');
    }
});

// Recebe o Webhook do Grafana
app.post('/api/webhook', (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }

    // Responder ao Grafana IMEDIATAMENTE para evitar timeout (Erro 500 InternalError no Grafana)
    res.json({ success: true, message: 'Webhook recebido, processando em segundo plano' });

    // Processar o envio em background
    (async () => {
        try {
            const payload = req.body;
            let title = payload.title || 'Alerta Grafana';
            let messageBody = payload.message || '';
            let state = payload.state || 'Alerting';
            
            const message = `🚨 *${title}* 🚨\nEstado: ${state}\n${messageBody}`;
            
            let targetNumber = req.query.number;
            if (!targetNumber) return;
            
            targetNumber = targetNumber.trim();
            if (!targetNumber.includes('@')) {
                if (targetNumber.length > 15) {
                    targetNumber = `${targetNumber}@g.us`;
                } else {
                    targetNumber = `${targetNumber}@s.whatsapp.net`;
                }
            }

            // Se for grupo, força sincronização
            if (targetNumber.includes('@g.us')) {
                try {
                    await sock.groupMetadata(targetNumber);
                    await sock.presenceSubscribe(targetNumber); // Força inscrição de presença
                    await new Promise(resolve => setTimeout(resolve, 2500)); // Tempo maior de respiro
                } catch (metaErr) {
                    console.log('Metadados do grupo erro:', metaErr.message);
                }
            }

            await sock.sendMessage(targetNumber, { text: message });
            // Sucesso! Limpa o log de erro se houver
            if (fs.existsSync('last_webhook_error.txt')) {
                fs.unlinkSync('last_webhook_error.txt');
            }
        } catch (error) {
            console.error('Erro ao enviar mensagem em background:', error);
            fs.writeFileSync('last_webhook_error.txt', `${new Date().toLocaleString()} - Erro: ${error.message}\n${error.stack}`);
        }
    })();
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
    connectToWhatsApp();
});
