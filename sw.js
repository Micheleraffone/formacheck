// Service worker minimale per FormaCheck: mette in cache solo la "shell"
// dell'app (questa pagina + manifest + icone), così l'interfaccia si apre
// subito anche con rete lenta o assente. Il modello di rilevamento posa e le
// librerie esterne (MediaPipe) restano SEMPRE scaricati dalla rete, non
// vengono mai messi in cache qui: sono grossi e si aggiornano per conto loro.
const CACHE_NAME = 'formacheck-shell-v1';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* se la rete non è disponibile in fase di install, si prosegue comunque */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // solo la shell stesso-origine, mai i CDN esterni

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline: usa la cache se la rete fallisce
      return cached || network;
    })
  );
});
