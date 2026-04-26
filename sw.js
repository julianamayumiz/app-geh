const CACHE = 'app-geh-v8';
const ARQUIVOS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/operador/index.html',
  '/operador/scanner.html',
  '/operador/vender.html',
  '/operador/consultar.html',
  '/caixa/index.html',
  '/caixa/scanner.html',
  '/caixa/carregar.html',
  '/admin/login.html',
  '/admin/eventos.html',
  '/admin/historico.html',
  '/admin/dashboard.html',
  '/admin/produtos.html',
  '/admin/clientes.html',
  '/admin/compras.html',
  '/admin/relatorio.html',
  '/admin/usuarios.html',
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
