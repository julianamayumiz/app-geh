const CACHE = 'app-geh-v13';
const ARQUIVOS = [
  '/',
  '/index.html',
  '/404.html',
  '/css/style.css',
  '/js/vendor/html5-qrcode.min.js',
  '/operador/index.html',
  '/operador/scanner.html',
  '/operador/vender.html',
  '/operador/consultar.html',
  '/caixa/index.html',
  '/caixa/scanner.html',
  '/caixa/carregar.html',
  '/caixa/transferir.html',
  '/recepcao/index.html',
  '/recepcao/conferencia.html',
  '/recepcao/venda-porta.html',
  '/admin/login.html',
  '/admin/eventos.html',
  '/admin/historico.html',
  '/admin/dashboard.html',
  '/admin/produtos.html',
  '/admin/clientes.html',
  '/admin/estoque.html',
  '/admin/relatorio.html',
  '/admin/usuarios.html',
  '/admin/ajuste-saldo.html',
  '/admin/convites-antecipados.html',
  '/admin/recepcao-painel.html',
  '/admin/historico-recepcao.html',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Estrategia por tipo de request:
// - Firestore/Auth/Functions: SW nao toca (deixa o Firebase SDK gerenciar)
// - Estaticos (HTML, CSS, JS, libs): cache-first com revalidacao em segundo
//   plano. Sao todos versionados via CACHE -> em deploy, bumpar a versao
//   invalida tudo. Isso da resposta instantanea no evento mesmo com Wi-Fi
//   ruim. Antes era network-first, o que adicionava 100-500ms em cada
//   recurso quando a rede do evento estava lenta.
// - Outros (Firestore via REST por algum motivo, gstatic, etc): network-first
//   com fallback pra cache, mantendo o comportamento antigo.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Deixa Firebase passar direto (Firestore tem cache proprio, App Check
  // precisa de respostas frescas).
  if (url.hostname.includes('firebaseapp.com')
   || url.hostname.includes('googleapis.com')
   || url.hostname.includes('firebaseio.com')
   || url.hostname.includes('firebase.com')) {
    return;
  }

  // Cache-first para mesmo origem (nossos estaticos) e GET apenas.
  const mesmoOrigem = url.origin === self.location.origin;
  if (mesmoOrigem && e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) {
          // Revalida em segundo plano pra proxima visita ter a versao mais
          // recente. Se a rede falhar, ok — o cache ja foi servido.
          fetch(e.request).then(resp => {
            if (resp && resp.ok) {
              caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
            }
          }).catch(() => {});
          return cached;
        }
        // Nao tem em cache — busca da rede e cacheia pra proxima.
        return fetch(e.request).then(resp => {
          if (resp && resp.ok && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return resp;
        }).catch(() => caches.match('/index.html'));
      })
    );
    return;
  }

  // Cross-origin (gstatic, unpkg legacy, etc): network-first com fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
