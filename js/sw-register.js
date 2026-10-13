// Registra o service worker e recarrega a aba quando uma nova versao assume
// o controle. Sem isso, uma aba ja aberta continua rodando o JS antigo em
// memoria mesmo depois de um deploy trocar o SW — controllerchange so avisa
// que a troca aconteceu, nao recarrega a pagina sozinho.
//
// O PDV (operador/caixa) mantem camera e transacoes na mesma pagina: se uma
// transacao esta em andamento (window.pdvOcupado), espera ela terminar antes
// de recarregar. Carrinho/valores ja ficam salvos em localStorage.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
  let refreshing = false;
  const ocupado = () => { try { return !!(window.pdvOcupado && window.pdvOcupado()); } catch { return false; } };
  const recarregarQuandoOcioso = () => {
    if (ocupado()) { setTimeout(recarregarQuandoOcioso, 2000); return; }
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    recarregarQuandoOcioso();
  });
}
