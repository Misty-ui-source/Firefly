/* PWA 注册：仅在安全上下文（https / localhost）注册 service worker */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function (err) {
      console.warn('[pwa] service worker 注册失败:', err);
    });
  });
})();
