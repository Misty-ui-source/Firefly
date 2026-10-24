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

/* 安装入口：顶栏「📲 安装 App」按钮（所有页面常驻）
 * - 捕获 beforeinstallprompt：点击时调原生安装弹窗
 * - 无 prompt（iOS Safari / OPPO 等国产自带浏览器 / Chrome 尚未触发）：点击弹手动添加说明
 * - 已以独立窗口运行或安装完成后：按钮隐藏
 */
(function () {
  var btn = document.getElementById('btn-install');
  if (!btn) return;
  var deferred = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }
  function sync() {
    btn.classList.toggle('hidden', isStandalone());
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); /* 拦下浏览器自带的迷你信息栏，改由按钮触发 */
    deferred = e;
    sync();
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    btn.classList.add('hidden');
  });
  if (window.matchMedia) {
    var mq = window.matchMedia('(display-mode: standalone)');
    if (mq.addEventListener) mq.addEventListener('change', sync);
  }

  function showInstallHelp() {
    if (document.querySelector('.pwa-install-mask')) return;
    var m = document.createElement('div');
    m.className = 'modal-mask pwa-install-mask';
    m.innerHTML = '<div class="modal-card">' +
      '<h3>📲 安装 Alexander Console</h3>' +
      '<p class="hint">把控制台添加到主屏幕，就能像 App 一样点开：</p>' +
      '<p>· <b>安卓 Chrome</b>：右上角 ⋮ 菜单 →「安装应用」</p>' +
      '<p>· <b>OPPO / 国产自带浏览器</b>：底部菜单 →「添加到桌面」</p>' +
      '<p>· <b>iPhone / iPad Safari</b>：分享按钮 →「添加到主屏幕」</p>' +
      '<div class="modal-ops"><button class="btn" type="button">知道了</button></div>' +
      '</div>';
    document.body.appendChild(m);
    var close = function () { m.remove(); };
    m.querySelector('.btn').onclick = close;
    m.addEventListener('mousedown', function (ev) { if (ev.target === m) close(); });
  }

  btn.addEventListener('click', function () {
    if (!deferred) { showInstallHelp(); return; }
    var p = deferred;
    deferred = null; /* prompt 只能用一次 */
    p.prompt();
    if (p.userChoice) {
      p.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') btn.classList.add('hidden');
      }).catch(function () { /* 用户关掉弹窗等情况，按钮留着可再点 */ });
    }
  });

  sync();
})();
