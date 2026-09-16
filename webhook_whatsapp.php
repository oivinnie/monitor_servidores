<?php
/**
 * Webhook do Grafana para WhatsApp (via CallMeBot)
 * 
 * 1. Coloque este arquivo no seu servidor PHP (ex: junto com api_servidores.php)
 * 2. Configure a URL deste arquivo no Grafana (Contact Points > Webhook)
 */

// === CONFIGURAÇÕES ===
// Coloque o seu número de telefone com DDI e DDD (ex: +5511999999999)
$numero_telefone = "+55SEUNUMERO"; 

// Coloque a API Key que o CallMeBot te enviou no WhatsApp
$api_key = "SUA_API_KEY";
// =====================

// Recebe o JSON do Grafana
$json = file_get_contents('php://input');
$payload = json_decode($json, true);

if (!$payload) {
    die("Nenhum dado recebido.");
}

// Extrai as informações do alerta
$title = isset($payload['title']) ? $payload['title'] : 'Alerta Grafana';
$state = isset($payload['state']) ? $payload['state'] : 'Desconhecido';
$messageBody = isset($payload['message']) ? $payload['message'] : '';

// Monta o texto bonitinho
$texto = "🚨 *{$title}*\nEstado: {$state}\n{$messageBody}";

// Envia para o CallMeBot
$url = "https://api.callmebot.com/whatsapp.php?phone={$numero_telefone}&text=" . urlencode($texto) . "&apikey={$api_key}";

// Faz a requisição ignorando erros de SSL caso o servidor PHP seja antigo
$context = stream_context_create([
    "ssl" => [
        "verify_peer" => false,
        "verify_peer_name" => false,
    ]
]);

$response = file_get_contents($url, false, $context);

echo "Alerta encaminhado com sucesso!";
?>
