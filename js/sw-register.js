// Registra o service worker e recarrega a aba quando uma nova versao assume
// o controle. Sem isso, uma aba ja aberta continua rodando o JS antigo em
// memoria mesmo depois de um deploy trocar o SW — controllerchange so avisa
// que a troca aconteceu, nao recarrega a pagina sozinho.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}
