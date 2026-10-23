/* 아인이 공부방 서비스워커: 홈 화면 앱으로 설치되게 하고, 앱 화면(껍데기)만 오프라인용으로 보관합니다.
   언제나 네트워크를 먼저 쓰고(새 버전이 바로 반영되도록), 연결이 끊겼을 때만 보관본을 씁니다.
   교재·음성 같은 자료는 보관하지 않습니다(서명 주소로 매번 새로 받음). */
const SHELL = 'ain-shell-v20261023170114';
const FILES = ['./', './index.html', './supabase.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const SCOPE = new URL('./', self.location).pathname;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;
  const isApp = req.mode === 'navigate' && (url.pathname === SCOPE || url.pathname === SCOPE + 'index.html');
  const isShell = isApp || FILES.some(f => new URL(f, self.location).pathname === url.pathname);
  // 앱 화면은 브라우저 임시 보관(최대 10분)을 건너뛰고 서버에 새 버전이 있는지 매번 확인
  const net = isShell ? fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req);
  e.respondWith(net.then(r => {
    if (r.ok && isShell) {
      const copy = r.clone(); caches.open(SHELL).then(c => c.put(isApp ? './index.html' : req, copy));
    }
    return r;
  }).catch(() => caches.match(isApp ? './index.html' : req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
