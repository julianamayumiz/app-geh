const CACHE = 'app-geh-v12';
const ARQUIVOS = [
  '/',
  '/index.html',
  '/404.html',
  '/css/style.css',
  '/operador/index.html',
  '/operador/scanner.html',
  '/operador/vender.html',
  '/operador/consultar.html',
  '/caixa/index.html',
  '/caixa/scanner.html',
  '/caixa/carregar.html',
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

// Network first, cache como fallback
self.addEventListener('fetch', e => {
  if (e.request.url.includes('firebaseapp.com') || e.request.url.includes('googleapis')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
