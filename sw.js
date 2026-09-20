// Service Worker mínimo de Novedades El Foamy.
// Solo permite instalar la tienda como app en el celular. A propósito NO guarda
// nada en caché: así el cliente siempre ve precios y existencias al día.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* sin caché: todo va directo a la red */ });
