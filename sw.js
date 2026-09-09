// Service worker minimale per FormaCheck: mette in cache solo la "shell"
// dell'app (questa pagina + manifest + icone). Strategia "prima la rete":
// ogni apertura prova a scaricare la versione più recente, e usa la cache
// solo come riserva se la rete non risponde — così un aggiornamento
// pubblicato si vede già alla prima apertura successiva, non dopo due.
// Il modello di rilevamento posa e le librerie esterne (MediaPipe) restano
// SEMPRE scaricati dalla rete, non vengono mai messi in cache qui: sono
// grossi e si aggiornano per conto loro.
const CACHE_NAME = 'formacheck-shell-v2';
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

// --- Promemoria allenamento (best-effort, nessun backend) --------------
// index.html non può passare dati direttamente qui: specchia lo stato che
// serve (obiettivo settimanale, allenamenti fatti questa settimana, data
// dell'ultimo allenamento) in IndexedDB ogni volta che cambia (vedi
// syncGoalSignals() in index.html), perché un service worker non ha
// accesso a localStorage. periodicsync è supportato solo da una minoranza
// di browser (in pratica Chrome/Android, PWA installata con uso
// frequente) e il sistema decide se e quando richiamarlo — nessuna
// garanzia di orario. Su tutti gli altri browser il promemoria resta
// solo quello mostrato quando l'utente riapre l'app (gestito in
// index.html, non qui).
function openReminderDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('formacheck-reminder', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('state'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function readReminderState(){
  return openReminderDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readonly');
    const req = tx.objectStore('state').get('goal');
    req.onsuccess = () => { resolve(req.result || null); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  }));
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'training-reminder') return;
  event.waitUntil(
    readReminderState().then((state) => {
      if (!state) return;
      const DAY = 86400000;
      const daysSince = state.lastTrainedTs ? (Date.now() - state.lastTrainedTs) / DAY : Infinity;
      const missing = Math.max(0, (state.weeklyTarget || 3) - (state.weekCount || 0));
      if (daysSince < 2 || missing <= 0) return; // non è passato abbastanza tempo, o l'obiettivo è già raggiunto
      return self.registration.showNotification('FormaCheck', {
        body: 'Non ti alleni da un po\' — ti manca' + (missing === 1 ? '' : 'no') + ' ' + missing + (missing === 1 ? ' allenamento' : ' allenamenti') + ' per l\'obiettivo di questa settimana.',
        icon: 'icon-192.png',
        tag: 'training-reminder'
      });
    }).catch(() => { /* IndexedDB non disponibile o mai popolato: nessun problema, si riprova al prossimo giro */ })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) { if ('focus' in client) return client.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // solo la shell stesso-origine, mai i CDN esterni

  // Prima la rete, così un aggiornamento pubblicato è visibile alla primissima
  // apertura successiva (non a quella dopo). La cache serve solo come riserva
  // se la rete non risponde (offline, connessione assente).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
