<?php
session_start();

$login_error = '';

// Verifica se o usuário enviou o formulário de login
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['email']) && isset($_POST['senha'])) {
    $email = urlencode($_POST['email']);
    $senha = urlencode($_POST['senha']);
    $token = 'Sapu2024AdmToken';
    
    // Faz a requisição para a API do SAPU
    $api_url = "https://suportedksoft.com.br/sapu/adm/APILoginSapu.php?email={$email}&senha={$senha}&token={$token}";
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $api_url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    // Ignorar verificação SSL se houver problemas (não recomendado para produção, mas útil se der erro no cURL local)
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($response) {
        $data = json_decode($response, true);
        if (isset($data['status']) && $data['status'] === 'success') {
            $_SESSION['sapu_logged_in'] = true;
            $_SESSION['sapu_email'] = $_POST['email'];
            header("Location: " . $_SERVER['PHP_SELF']);
            exit;
        } else {
            $login_error = isset($data['message']) ? $data['message'] : 'E-mail ou senha incorretos.';
        }
    } else {
        $login_error = 'Erro ao conectar na API de Login do SAPU.';
    }
}

// Verifica se o usuário quer deslogar
if (isset($_GET['logout'])) {
    session_destroy();
    header("Location: " . $_SERVER['PHP_SELF']);
    exit;
}

$is_logged_in = isset($_SESSION['sapu_logged_in']) && $_SESSION['sapu_logged_in'] === true;
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor Servidores</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; background-color: #f4f7f6; }
        header { background-color: #2c3e50; color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; }
        header h1 { margin: 0; font-size: 20px; }
        
        /* Estilos do Login */
        .login-container { display: flex; justify-content: center; align-items: center; flex: 1; }
        .login-box { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
        .login-box h2 { margin-top: 0; text-align: center; color: #333; }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; color: #666; }
        .form-group input { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .error-msg { color: #e74c3c; margin-bottom: 15px; text-align: center; font-size: 14px; }
        .btn-submit { width: 100%; padding: 10px; background: #3498db; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
        .btn-submit:hover { background: #2980b9; }

        /* Estilos do Dashboard */
        .dashboard-container { display: flex; flex: 1; overflow: hidden; }
        .sidebar { width: 300px; background: white; padding: 20px; border-right: 1px solid #ddd; overflow-y: auto; box-shadow: 2px 0 5px rgba(0,0,0,0.05); z-index: 10;}
        .main-content { flex: 1; display: flex; flex-direction: column; }
        .qr-container { text-align: center; margin-top: 20px; padding: 15px; background: #f9f9f9; border-radius: 8px; border: 1px dashed #ccc;}
        #qr-image { max-width: 100%; height: auto; }
        iframe { width: 100%; height: 100%; border: none; flex: 1; }
        .btn { padding: 8px 15px; background: #e74c3c; color: white; border: none; cursor: pointer; border-radius: 4px; text-decoration: none; font-size: 14px; }
        .btn:hover { background: #c0392b; }
        .status { margin-top: 10px; font-weight: bold; color: #555; }
        .webhook-info { background: #e8f4f8; padding: 10px; border-radius: 4px; font-size: 12px; word-break: break-all; border-left: 4px solid #3498db; margin-top:15px;}
    </style>
</head>
<body>
    <header>
        <h1>Monitor de Servidores</h1>
        <?php if ($is_logged_in): ?>
            <div>
                <span style="margin-right: 15px; font-size: 14px;"><?php echo htmlspecialchars($_SESSION['sapu_email']); ?></span>
                <a href="?logout=1" class="btn">Sair</a>
            </div>
        <?php endif; ?>
    </header>

    <?php if (!$is_logged_in): ?>
        <!-- Tela de Login -->
        <div class="login-container">
            <div class="login-box">
                <h2>Acesso Restrito</h2>
                <?php if ($login_error): ?>
                    <div class="error-msg"><?php echo htmlspecialchars($login_error); ?></div>
                <?php endif; ?>
                <form method="POST" action="">
                    <div class="form-group">
                        <label for="email">E-mail</label>
                        <input type="email" id="email" name="email" required placeholder="Seu e-mail do SAPU">
                    </div>
                    <div class="form-group">
                        <label for="senha">Senha</label>
                        <input type="password" id="senha" name="senha" required placeholder="Sua senha">
                    </div>
                    <button type="submit" class="btn-submit">Entrar</button>
                </form>
            </div>
        </div>
    <?php else: ?>
        <!-- Tela do Dashboard -->
        <div class="dashboard-container">
            <div class="sidebar">
                <h3 style="margin-top: 0;">WhatsApp (Alertas)</h3>
                <p style="font-size: 14px; color: #666;">Leia o QR Code com seu WhatsApp para ativar o envio de alertas do Grafana.</p>
                
                <div class="qr-container">
                    <img id="qr-image" style="display:none;" />
                    <div id="status-text" class="status">Iniciando...</div>
                    <button id="logout-btn" class="btn" style="display:none; margin-top: 15px; width: 100%;" onclick="logoutWhatsApp()">Desconectar WhatsApp</button>
                </div>
                
                <hr style="margin: 20px 0; border: 0; border-top: 1px solid #ddd;">
                
                <h3>Webhook Grafana</h3>
                <p style="font-size: 14px; color: #666;">Configure esta URL no Grafana (Contact Points > Webhook):</p>
                <div class="webhook-info">
                    <strong>URL:</strong><br>
                    http://SEU_DOMINIO:3000/api/webhook?number=5511999999999<br><br>
                    <em>* Substitua o número pelo telefone que receberá as mensagens (com DDI e DDD).</em>
                </div>
            </div>
            <div class="main-content">
                <iframe src="https://broadpapaya3272.grafana.net/public-dashboards/17ca6c96b1c44651800aefb8ca4367b2" title="Grafana Dashboard"></iframe>
            </div>
        </div>

        <script>
            // Mude para o domínio/IP onde o Node.js está rodando.
            // Para testes locais, pode deixar http://localhost:3000/api
            const API_BASE = 'http://localhost:3000/api'; 

            async function checkQR() {
                try {
                    const response = await fetch(`${API_BASE}/qr`);
                    const data = await response.json();
                    
                    const qrImage = document.getElementById('qr-image');
                    const statusText = document.getElementById('status-text');
                    const logoutBtn = document.getElementById('logout-btn');

                    if (data.status === 'connected') {
                        qrImage.style.display = 'none';
                        statusText.innerText = '✅ WhatsApp Conectado!';
                        statusText.style.color = '#27ae60';
                        logoutBtn.style.display = 'block';
                    } else if (data.status === 'pending' && data.qr) {
                        qrImage.src = data.qr;
                        qrImage.style.display = 'inline-block';
                        statusText.innerText = 'Aguardando leitura do QR Code...';
                        statusText.style.color = '#f39c12';
                        logoutBtn.style.display = 'none';
                    } else {
                        qrImage.style.display = 'none';
                        statusText.innerText = 'Inicializando serviço...';
                        statusText.style.color = '#7f8c8d';
                        logoutBtn.style.display = 'none';
                    }
                } catch (err) {
                    console.error(err);
                    document.getElementById('status-text').innerText = 'Serviço do WhatsApp offline.';
                    document.getElementById('status-text').style.color = '#c0392b';
                }
            }

            async function logoutWhatsApp() {
                if(!confirm('Tem certeza que deseja desconectar o WhatsApp?')) return;
                try {
                    await fetch(`${API_BASE}/logout`, { method: 'POST' });
                    document.getElementById('status-text').innerText = 'Desconectando...';
                    setTimeout(checkQR, 2000);
                } catch (err) {
                    console.error('Erro ao deslogar:', err);
                }
            }

            // Inicia o polling a cada 3 segundos
            setInterval(checkQR, 3000);
            checkQR();
        </script>
    <?php endif; ?>
</body>
</html>
