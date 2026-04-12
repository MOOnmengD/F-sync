const CACHE_VERSION = 'v1'
const STATIC_CACHE = `f-sync-static-${CACHE_VERSION}`
const RUNTIME_CACHE = `f-sync-runtime-${CACHE_VERSION}`

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons.svg',
  '/pwa-192.png',
  '/pwa-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      await cache.addAll(STATIC_ASSETS)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key)
          }
          return Promise.resolve()
        }),
      )
      await self.clients.claim()
    })(),
  )
})

function isSameOrigin(request) {
  try {
    const url = new URL(request.url)
    return url.origin === self.location.origin
  } catch {
    return false
  }
}

function isNavigationRequest(request) {
  return request.mode === 'navigate'
}

function isCacheableAsset(request) {
  if (request.method !== 'GET') return false
  if (!isSameOrigin(request)) return false
  const url = new URL(request.url)
  if (url.pathname === '/' || url.pathname === '/index.html') return true
  return /\.(js|css|svg|png|jpg|jpeg|webp|gif|ico|woff2?)$/i.test(url.pathname)
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request)
          const cache = await caches.open(RUNTIME_CACHE)
          cache.put('/', networkResponse.clone())
          return networkResponse
        } catch {
          const cached = await caches.match('/')
          if (cached) return cached
          return caches.match('/index.html')
        }
      })(),
    )
    return
  }

  if (!isCacheableAsset(request)) return

  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) {
        event.waitUntil(
          (async () => {
            try {
              const res = await fetch(request)
              const cache = await caches.open(RUNTIME_CACHE)
              await cache.put(request, res.clone())
            } catch {}
          })(),
        )
        return cached
      }

      try {
        const res = await fetch(request)
        const cache = await caches.open(RUNTIME_CACHE)
        await cache.put(request, res.clone())
        return res
      } catch (err) {
        throw err
      }
    })(),
  )
})
