/* Slowedfy Service Worker - Offline Shell & Fast Asset Caching */
const CACHE_NAME = 'slowedfy-v10';
const MEDIA_NOTIFICATION_TAG = 'slowedfy-media-controls';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.png',
  '/logo.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Pre-cache error (non-fatal):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Do NOT intercept heavy media/audio streams, Google Drive proxy, Range requests, YouTube, dynamic playlist sync, analytics, or covers
  if (
    url.pathname.startsWith('/api/stream') ||
    url.pathname.startsWith('/api/artwork') ||
    url.pathname.startsWith('/api/playlist') ||
    url.pathname.startsWith('/api/analytics') ||
    url.pathname.startsWith('/covers/') ||
    url.pathname.includes('/audio_cache/') ||
    url.hostname.includes('drive.google.com') ||
    url.hostname.includes('drive.usercontent.google.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.hostname.includes('googlevideo.com') ||
    url.hostname.includes('youtube.com') ||
    url.hostname.includes('youtube-nocookie.com') ||
    request.headers.get('range') ||
    request.destination === 'audio' ||
    request.destination === 'video'
  ) {
    return;
  }

  // 1. Navigation requests (App Shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  // 2. API Routes: Network-first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 3. YouTube Image Thumbnails: Cache-first with network fallback
  if (url.hostname.includes('ytimg.com')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 408, statusText: 'Offline' }));
      })
    );
    return;
  }

  // 4. Static UI assets: Cache-first, network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// Mobile Notification Bar Media Controls (Repeat One / Repeat All + Prev / Next)
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SHOW_MEDIA_REPEAT_NOTIFICATION') {
    const title = data.title || 'Slowedfy';
    const artist = data.artist || 'Beat Badge x Slowedfy';
    const repeatMode = data.repeatMode || 'all';
    const isPlaying = Boolean(data.isPlaying);
    const repeatStatusText =
      repeatMode === 'one'
        ? 'Repeat One'
        : repeatMode === 'all'
        ? 'Repeat All'
        : 'Repeat Off';
    const repeatActionTitle =
      repeatMode === 'one'
        ? 'Repeat: One'
        : repeatMode === 'all'
        ? 'Repeat: All'
        : 'Repeat: Off';

    const options = {
      body: `${artist} • ${isPlaying ? 'Playing' : 'Paused'} • ${repeatStatusText}`,
      icon: data.artwork || '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: MEDIA_NOTIFICATION_TAG,
      silent: true,
      renotify: false,
      requireInteraction: false,
      data: {
        trackId: data.trackId || '',
        repeatMode,
        url: '/'
      },
      actions: [
        { action: 'prev', title: 'Prev' },
        { action: 'toggle-repeat', title: repeatActionTitle },
        { action: 'next', title: 'Next' }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(title, options).catch(() => {})
    );
    return;
  }

  if (data.type === 'CLEAR_MEDIA_REPEAT_NOTIFICATION') {
    event.waitUntil(
      self.registration
        .getNotifications({ tag: MEDIA_NOTIFICATION_TAG })
        .then((list) => {
          list.forEach((n) => n.close());
        })
        .catch(() => {})
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  const action = event.action || '';

  if (action === 'toggle-repeat' || action === 'prev' || action === 'next' || action === 'toggle-play') {
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          clientList.forEach((client) => {
            try {
              client.postMessage({
                type: 'SLOWEDFY_NOTIFICATION_ACTION',
                action
              });
            } catch (e) {}
          });
        })
    );
    return;
  }

  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
  );
});

