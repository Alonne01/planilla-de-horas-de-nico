// v4: se sube la versión a propósito para que el handler de 'activate' borre el cache anterior,
// que en los dispositivos ya instalados tiene adjuntos de /uploads guardados (certificados médicos).
const CACHE_NAME = 'planilla-horas-v4';
const PRECACHE_URLS = [
  '/',
  '/index.html',
];

// Install: precache shell, activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean ALL old caches, claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip cross-origin requests (API on a different port/tunnel)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip Vite HMR / WebSocket upgrades
  if (event.request.headers.get('upgrade') === 'websocket') {
    return;
  }

  // Nunca tocar /uploads: son adjuntos privados (certificados médicos, fotos de tarjetas WENTOP,
  // adjuntos de mensajes). Si los cachea el service worker quedan escritos en el dispositivo,
  // el cache es uno solo para todos los usuarios que usan esa tablet/PC y sobrevive al logout.
  // Sin respondWith los pide el navegador contra el servidor, como cualquier recurso no manejado.
  if (url.pathname.startsWith('/uploads')) {
    return;
  }

  // Never cache /api calls.
  // Si el servidor no contesta (apagado, sin red, corte de luz en la oficina)
  // respondemos un 503 propio: la app lo reconoce y muestra el cartel de
  // "servidor inactivo" en vez de dejar que el usuario cargue datos que se
  // van a perder. Esto funciona aunque el servidor esté completamente caído,
  // porque este código corre en el dispositivo del usuario.
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'SERVIDOR_INACTIVO' }),
          {
            status: 503,
            statusText: 'Servidor inactivo',
            headers: {
              'Content-Type': 'application/json',
              'X-Servidor-Inactivo': '1',
            },
          }
        )
      )
    );
    return;
  }

  // Stale-while-revalidate for JS/CSS — serve cached instantly, update in background
  if (event.request.destination === 'script' || event.request.destination === 'style' ||
      url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached);
          // Keep SW alive for background revalidation
          if (cached) event.waitUntil(fetchPromise);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Cache-first for images/fonts (rarely change)
  if (event.request.destination === 'image' || event.request.destination === 'font') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for navigation (HTML)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
  );
});
