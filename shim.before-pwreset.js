/* 아인이 공부방 — Supabase 연결층.
   예전 claude.ai 런타임(window.claude.use)과 같은 모양의 db·user·assets·downloads를 Supabase로 제공한다.
   파일은 비공개 Storage(files/blob/<id>)에 있고, 화면에는 잠깐 쓰는 서명 주소로 보여 준다. */
(() => {
  'use strict';
  const SB_URL = 'https://gtboiiedozrgemoebtdz.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Ym9paWVkb3pyZ2Vtb2VidGR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NzE2NDIsImV4cCI6MjEwODA0NzY0Mn0.SirPDQ_gtyHWnuGDrahgHKmT9h8BOU6ztdsHAedcm5s';
  const BUCKET = 'files';
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ain-auth' } });

  const AIN = window.AIN = { sb, member: null, isAdmin: false, email: '' };
  let rerender = () => { if (typeof window.__ainRender === 'function') window.__ainRender(); };

  /* ---------- 파일: 서명 주소 ---------- */
  const BL = { map: {}, q: new Set(), t: null, waiters: {}, busy: false };
  const TTL = 60 * 60 * 12; // 12시간
  function queueBlob(id) { if (!id || BL.map[id] && BL.map[id].exp > Date.now()) return; BL.q.add(id); clearTimeout(BL.t); BL.t = setTimeout(flushBlobs, 25); }
  async function flushBlobs() {
    if (!AIN.ready) return;
    const ids = [...BL.q]; BL.q.clear(); if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      let rows = [];
      try { const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(part.map(x => 'blob/' + x), TTL); if (!error && data) rows = data; } catch (e) {}
      const exp = Date.now() + (TTL - 600) * 1000;
      part.forEach((id, k) => {
        const r = rows[k]; const url = r && r.signedUrl ? r.signedUrl : '';
        if (url) BL.map[id] = { url, exp };
        (BL.waiters[id] || []).forEach(f => f(url)); delete BL.waiters[id];
      });
    }
    rerender();
  }
  const blobUrl = (id) => { if (!id) return ''; const e = BL.map[id]; if (e && e.exp > Date.now()) return e.url; queueBlob(id); return ''; };
  const ensureBlob = (id) => { const u = blobUrl(id); if (u) return Promise.resolve(u); return new Promise(res => { (BL.waiters[id] = BL.waiters[id] || []).push(res); queueBlob(id); }); };
  const idOf = (s) => typeof s === 'string' && s.startsWith('/_blob/') ? s.slice(7) : null;
  AIN.blobUrl = blobUrl;
  AIN.ensureBlob = ensureBlob;
  AIN.blobSrc = (s) => { const id = idOf(s); return id ? blobUrl(id) : s; };
  AIN.setSrc = (el, s) => { const id = idOf(s); if (!id) { el.src = s; return; } const u = blobUrl(id); if (u) el.src = u; else ensureBlob(id).then(x => { if (x) el.src = x; }); };
  AIN.blobFetch = async (id) => { const u = await ensureBlob(id); if (!u) return { ok: false, status: 404 }; return fetch(u); };
  // 자료가 들어오면 거기 걸린 파일 주소를 미리 받아 둔다(아이폰에서 누르자마자 재생되도록)
  function prefetchFrom(data) {
    if (!data || typeof data !== 'object') return;
    if (data.assetId) queueBlob(data.assetId);
    const a = idOf(data.src); if (a) queueBlob(a);
    const b = data.audio && idOf(data.audio.src); if (b) queueBlob(b);
  }

  /* ---------- 데이터 ---------- */
  const cache = {}, subs = {}, loading = {};
  const emit = (col) => {
    const m = cache[col]; if (!m) return;
    const docs = [...m.entries()].map(([id, data]) => ({ id, data: () => data }));
    (subs[col] || []).forEach(s => { try { s.cb({ docs }); } catch (e) { console.error(e); } });
  };
  async function load(col) {
    if (loading[col]) return loading[col];
    loading[col] = (async () => {
      const all = []; let from = 0;
      for (;;) {
        const { data, error } = await sb.from('docs').select('id,data').eq('collection', col).range(from, from + 999);
        if (error) throw error;
        all.push(...data); if (data.length < 1000) break; from += 1000;
      }
      cache[col] = new Map(all.map(r => [r.id, r.data]));
      all.forEach(r => prefetchFrom(r.data));
      emit(col);
    })().finally(() => { delete loading[col]; });
    return loading[col];
  }
  const reloadAll = () => Object.keys(subs).forEach(c => load(c).catch(() => {}));
  const local = (col, id, data) => { if (!cache[col]) return; if (data === null) cache[col].delete(id); else { cache[col].set(id, data); prefetchFrom(data); } emit(col); };
  const rid = () => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(20)); r.forEach(x => s += a[x % a.length]); return s; };
  const fail = (error) => { if (error) { const e = new Error(error.message || 'db_error'); e.code = error.code; throw e; } };
  function collection(col) {
    const docRef = (id) => ({
      id,
      async set(data) { const { error } = await sb.from('docs').upsert({ collection: col, id, data }); fail(error); local(col, id, data); },
      async update(patch) { const { error } = await sb.rpc('docs_merge', { p_collection: col, p_id: id, p_patch: patch }); fail(error); const cur = cache[col] && cache[col].get(id); if (cur) local(col, id, { ...cur, ...patch }); },
      async delete() { const { error } = await sb.from('docs').delete().eq('collection', col).eq('id', id); fail(error); local(col, id, null); },
      async get() { const { data, error } = await sb.from('docs').select('data').eq('collection', col).eq('id', id).maybeSingle(); fail(error); return { id, exists: !!data, data: () => data ? data.data : undefined }; }
    });
    return {
      doc: docRef,
      async add(data) { const id = rid(); await docRef(id).set(data); return { id }; },
      onSnapshot(cb, onErr) {
        const s = { cb }; (subs[col] = subs[col] || []).push(s);
        if (cache[col]) emit(col); else load(col).catch(e => { onErr && onErr(e); });
        return () => { subs[col] = (subs[col] || []).filter(x => x !== s); };
      }
    };
  }
  let channel = null;
  function startRealtime() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('docs-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, (p) => {
        const row = p.eventType === 'DELETE' ? p.old : p.new; if (!row || !row.collection || !cache[row.collection]) return;
        local(row.collection, row.id, p.eventType === 'DELETE' ? null : row.data);
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') reloadAll(); });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && AIN.ready) { reloadAll(); if (!channel || channel.state !== 'joined') startRealtime(); } });

  /* ---------- 파일 올리기·저장 ---------- */
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  const assets = {
    async upload(file, opt) {
      if (file.size > 50 * 1024 * 1024) { const e = new Error('too_large'); e.code = 'too_large'; throw e; }
      const id = hex(16);
      const { error } = await sb.storage.from(BUCKET).upload('blob/' + id, file, { contentType: (opt && opt.type) || file.type || 'application/octet-stream', upsert: false });
      fail(error); return { id, sizeBytes: file.size };
    },
    async delete(id) { await sb.storage.from(BUCKET).remove(['blob/' + id]); }
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS && navigator.canShare) {
        const f = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
        if (navigator.canShare({ files: [f] })) {
          try { await navigator.share({ files: [f], title: filename }); return; }
          catch (e) { if (e && e.name === 'AbortError') { const x = new Error('declined'); x.code = 'declined'; throw x; } }
        }
      }
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  /* ---------- 로그인 ---------- */
  let readyResolve; const ready = new Promise(r => { readyResolve = r; });
  const css = `
  .ain-gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px 16px;background:var(--bg,#EEF1E7);}
  .ain-card{width:min(380px,100%);background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:22px;padding:28px 22px;box-shadow:var(--shadow);display:grid;gap:14px;color:var(--ink,#222);font-family:var(--f-ui,system-ui)}
  .ain-card .mark{width:52px;height:52px;border-radius:16px 16px 16px 5px;background:var(--sun,#F2B33D);color:#3A2A05;display:grid;place-items:center;font-family:var(--f-read,serif);font-weight:700;font-size:26px;margin:0 auto}
  .ain-card h1{font-family:var(--f-read,serif);font-size:22px;text-align:center;margin:0}
  .ain-card p{margin:0;color:var(--muted,#666);font-size:14px;text-align:center;line-height:1.5}
  .ain-card label{display:grid;gap:6px;font-size:13.5px;color:var(--muted,#666)}
  .ain-card input{-webkit-user-select:text;user-select:text;-webkit-appearance:none;appearance:none;pointer-events:auto;font:inherit;font-size:16px;padding:12px 14px;border-radius:12px;border:1px solid var(--line,#ccc);background:var(--bg,#fff);color:var(--ink,#222)}
  .ain-card button{font:inherit;font-size:16px;padding:13px;border-radius:999px;border:0;background:var(--accent,#3E7560);color:var(--accent-ink,#fff);cursor:pointer}
  .ain-card button[disabled]{opacity:.6}
  .ain-card .msg{min-height:20px;font-size:13.5px;color:var(--danger,#C2554A);text-align:center}
  .ain-who{position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom) + 76px);z-index:50}
  @media (min-width:900px){.ain-who{bottom:14px}}
  .ain-who button{font:inherit;font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--muted);cursor:pointer;opacity:.85}`;
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  const NAMES = { ain: '아인이', dad: '아빠', mom: '엄마' };
  function gate(msg) {
    let g = document.querySelector('.ain-gate');
    if (!g) {
      g = document.createElement('div'); g.className = 'ain-gate';
      g.innerHTML = `<form class="ain-card" autocomplete="on"><div class="mark">아</div><h1>아인이 공부방</h1><p>우리 가족만 들어올 수 있어요.<br>이메일과 비밀번호로 로그인해 주세요.</p>
        <label>이메일<input name="email" type="email" autocomplete="username" required></label>
        <label>비밀번호<input name="pw" type="password" autocomplete="current-password" required></label>
        <div class="msg" role="status"></div><button type="submit">들어가기</button></form>`;
      document.body.append(g);
      const f = g.querySelector('form');
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); const b = f.querySelector('button'); const m = f.querySelector('.msg');
        b.disabled = true; m.textContent = '';
        const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.pw.value });
        b.disabled = false;
        if (error) { m.textContent = '이메일이나 비밀번호가 맞지 않아요.'; return; }
        location.reload();
      });
    }
    g.querySelector('.msg').textContent = msg || '';
    // 아이폰 홈 화면 앱에서는 코드로 미리 포커스를 주면 이후 눌러도 키보드가 안 뜨는 문제가 있어 자동 포커스를 하지 않음
  }
  AIN.signOut = async () => { try { await sb.auth.signOut(); } catch (e) {} try { localStorage.removeItem('ain-member'); } catch (e) {} location.reload(); };
  function whoChip() {
    const w = document.createElement('div'); w.className = 'ain-who';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = (NAMES[AIN.member] || '') + ' · 로그아웃';
    b.onclick = () => { if (confirm('로그아웃할까요?')) AIN.signOut(); };
    w.append(b); document.body.append(w);
  }
  (async () => {
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    if (!session) { gate(); return; }
    AIN.email = session.user.email || '';
    const { data: fam, error } = await sb.from('family').select('member,is_admin').eq('email', AIN.email.toLowerCase()).maybeSingle();
    if (error || !fam) { gate(error ? '연결이 불안정해요. 잠시 뒤 다시 시도해 주세요.' : '가족 명단에 없는 계정이에요. 아빠에게 말해 주세요.'); if (!error) await sb.auth.signOut(); return; }
    AIN.member = fam.member; AIN.isAdmin = !!fam.is_admin; AIN.ready = true;
    try { if (localStorage.getItem('ain-member') !== JSON.stringify(fam.member)) { localStorage.setItem('ain-member', JSON.stringify(fam.member)); if (!localStorage.getItem('ain-me')) { localStorage.setItem('ain-me', JSON.stringify(fam.member)); location.reload(); return; } } } catch (e) {}
    whoChip();
    startRealtime();
    flushBlobs();
    readyResolve(true);
  })();

  /* ---------- 예전 런타임과 같은 입구 ---------- */
  const user = { canEdit: async () => AIN.isAdmin, id: () => AIN.member };
  const db = { collection };
  window.claude = {
    use: async (name) => {
      await ready;
      if (name === 'db') return db;
      if (name === 'user') return user;
      if (name === 'assets') return AIN.isAdmin ? assets : null;
      if (name === 'downloads') return downloads;
      throw new Error('unknown');
    }
  };

  /* ---------- 홈 화면 앱(PWA) ---------- */
  if ('serviceWorker' in navigator) window.addEventListener('load', () => {
    const hadCtl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      // 앱을 다시 화면에 띄울 때마다 새 버전이 있는지 확인
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    // 새 버전이 설치되면, 시험·뷰어 같은 창이 열려 있지 않을 때 한 번 새로고침해 바로 반영
    let reloaded = false;
    const tryReload = () => { if (reloaded) return; if (document.querySelector('.viewer, .scrim, .ain-gate')) { setTimeout(tryReload, 5000); return; } reloaded = true; location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtl) tryReload(); });
  });
})();
