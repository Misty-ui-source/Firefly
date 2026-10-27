/* Alexander Console PWA service worker
 * 只缓存页面外壳（html/css/js/图标），所有接口一律走网络：
 * /api/*、GitHub、R2、Umami 都不进缓存，保证打开看到的永远是新鲜数据。
 * 同源静态资源走 network-first：有网永远拿最新版，断网才用缓存兜底。
 */
const CACHE = 'console-shell-v18';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './app.js',
  './media.js',
  './gallery.js',
  './pwa.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 只接管同源 GET；接口、跨域请求（GitHub/R2/Umami）全部直连网络，不走缓存
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;
  e.respondWith(
    /* cache:'no-cache' 强制回源校验：绕开浏览器 4 小时 HTTP 长缓存，否则 network-first 会被本地缓存截胡 */
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
