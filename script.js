// script.js — 完成版：人数画面の裏で連続スキャン（多規格＋jsQR強化）/ 最終確認で停止
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  /* ===== ステージ自動スケール（1280×800基準） ===== */
  function fitStage(){
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / 1280, vh / 800);
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  }
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
  window.addEventListener('visibilitychange', fitStage);
  fitStage();

  /* ====== 設定 ====== */
  const USE_FRONT = true;           // 内カメラ優先: true / 外カメラ優先: false
  const ONE_SHOT_DELAY_FRAMES = 2;  // 同じコードを“1枚ずつ”扱うためのクリアフレーム数

  /* ====== 画面参照 ====== */
  const screens = {
    home: $('screen-home'),
    showTimes: $('screen-show-times'),
    personSelect: $('screen-person-select'),
    finalConfirm: $('screen-final-confirm'),
    drawing: $('screen-drawing'),
    loseBBB: $('screen-lose-bbb'),
    losePirates: $('screen-lose-pirates'),
    win: $('screen-win'),
  };

  /* ===== サウンド ===== */
  const createAudio = (src, { volume = 1, loop = false } = {}) => {
    const a = new Audio(src);
    a.preload = 'auto';
    a.volume = volume;
    a.loop = loop;
    return a;
  };

  const sounds = {
    win:  createAudio('./当たり音.mp3'),
    lose: createAudio('./外れ音.mp3'),
    draw: createAudio('./抽選音.mp3', { loop: true }),   // ループだが必要時のみ再生
    tickSrc: './読み込み音.mp3',                         // 読み込み音（WebAudio優先）
  };

  // 抽選音を確実に止める（どこからでも呼べるように定義）
  function stopDraw(){
    try {
      sounds.draw.pause();
      sounds.draw.currentTime = 0;
    } catch {}
  }

  // ★ クリック解錠 + 事前起動（iOS対策）
  let audioUnlocked = false;

  // ---- (A) WebAudio（あればこちらを優先） ----
  let ac = null;           // AudioContext
  let tickBuffer = null;   // 読み込み音のデコード済みバッファ

  async function initWebAudio() {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const res = await fetch(sounds.tickSrc);
      const arr = await res.arrayBuffer();
      // iOSで decodeAudioData が callback 版なことがあるので両対応
      tickBuffer = await new Promise((resolve, reject) => {
        const done = (buf) => resolve(buf);
        const err  = (e)   => reject(e);
        const r = ac.decodeAudioData(arr, done, err);
        if (r && typeof r.then === 'function') r.then(done).catch(err);
      });
    } catch (e) {
      ac = null; tickBuffer = null;
    }
  }

  function playTickWebAudio() {
    if (!ac || !tickBuffer) return false;
    try {
      if (ac.state !== 'running') ac.resume();
      const src  = ac.createBufferSource();
      const gain = ac.createGain();
      gain.gain.value = 1;
      src.buffer = tickBuffer;
      src.connect(gain).connect(ac.destination);
      src.start();
      return true;
    } catch { return false; }
  }

  // ---- (B) HTMLAudio プール（WebAudio失敗時のフォールバック） ----
  const TICK_POOL_SIZE = 6;
  const tickPool = Array.from({ length: TICK_POOL_SIZE }, () => createAudio(sounds.tickSrc));
  let tickIdx = 0;
  function playTickHTMLAudio() {
    const a = tickPool[tickIdx++ % TICK_POOL_SIZE];
    try { a.currentTime = 0; a.play().catch(()=>{}); } catch {}
  }

  // 共通：読み込み音を鳴らす
  function playTick() {
    // 可能ならWebAudio、だめならプール
    if (!playTickWebAudio()) playTickHTMLAudio();
  }

  // 最初のユーザー操作で全て解錠 & 事前起動
  async function unlockAndPrimeAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    // WebAudio 初期化（失敗してもOK）
    await initWebAudio();

    // HTMLAudio も無音で起動しておく（iOSの制限回避）
    const prime = async (a) => {
      try {
        a.muted = true; a.currentTime = 0;
        await a.play();
        a.pause();
        a.muted = false; a.currentTime = 0;
      } catch {}
    };
    await Promise.all([prime(sounds.win), prime(sounds.lose), prime(sounds.draw), ...tickPool.map(prime)]);
  }

  // 任意のユーザー操作で解錠
  const firstGestureUnlock = () => {
    unlockAndPrimeAudio();
    document.removeEventListener('pointerdown', firstGestureUnlock, true);
    document.removeEventListener('keydown', firstGestureUnlock, true);
  };
  document.addEventListener('pointerdown', firstGestureUnlock, true);
  document.addEventListener('keydown', firstGestureUnlock, true);

  // タブが非表示になったら抽選音を保険で停止
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopDraw();
  });

  /* ====== 状態 ====== */
  const selected = { showName:'', showSubtitle:'', showTimeText:'', showTimeStr:'', personCount:0 };
  let inactivityTimer;

  /* ====== 画面遷移 ====== */
  function navigateTo(target) {
    clearTimeout(inactivityTimer);

    // 人数画面から離れる前にカメラ停止
    if (target !== screens.personSelect) stopCamera();

    // ★ drawing（抽選中）以外に行くときは必ず抽選音を停止
    if (target !== screens.drawing) stopDraw();

    Object.values(screens).forEach(s => s?.classList?.add('hidden'));
    target?.classList?.remove('hidden');

    if (target === screens.win) {
      try { sounds.win.currentTime = 0; sounds.win.play(); } catch {}
      setTimeout(() => navigateTo(screens.home), 15000);
    } else if (target === screens.loseBBB || target === screens.losePirates) {
      try { sounds.lose.currentTime = 0; sounds.lose.play(); } catch {}
    }

    if (target === screens.showTimes) {
      inactivityTimer = setTimeout(() => navigateTo(screens.home), 10000);
    }

    if (target === screens.personSelect) startCameraAndScan();
  }

  /* ====== 当たり画面の文言 ====== */
  function setWinTexts() {
    const sub = $('win-show-subtitle-top'), title = $('win-show-title-top');
    const time = $('win-show-time-text'),   count = $('win-ticket-count');
    if (sub) sub.textContent = selected.showSubtitle || '';
    if (title) { title.textContent = selected.showName || ''; title.classList.toggle('long', (selected.showName || '').length > 22); }
    if (time)  time.textContent = selected.showTimeText || '';
    if (count) count.textContent = String(selected.personCount || 1);
  }

  /* ====== ホーム → 時間 ====== */
  document.querySelectorAll('.show-button').forEach(btn => {
    btn.addEventListener('click', () => {
      selected.showName     = btn.dataset.showName || '';
      selected.showSubtitle = btn.dataset.showSubtitle || '';
      $('time-select-title')?.replaceChildren(document.createTextNode(selected.showName));
      const sub = $('time-select-subtitle');
      if (sub) {
        if (selected.showSubtitle) { sub.textContent = selected.showSubtitle; sub.style.display = 'block'; }
        else { sub.style.display = 'none'; }
      }
      generateTimeButtons(selected.showName);
      navigateTo(screens.showTimes);
    });
  });

  /* ====== 開演時刻ボタン ====== */
  function generateTimeButtons(showName) {
    const panel = document.querySelector('#screen-show-times .right-panel-unified-times'); if (!panel) return;
    panel.innerHTML = '';

    const times =
      showName === 'BIG BAND BEAT'
        ? [
            { text: '第2回目公演', str: '13:50' },
            { text: '第3回目公演', str: '15:20' },
            { text: '第4回目公演', str: '17:20' },
            { text: '第5回目公演', str: '18:50' },
          ]
        : [
            { text: '第2回目公演', str: '11:50' },
            { text: '第3回目公演', str: '14:50' },
          ];

    times.forEach(time => {
      const el = document.createElement('div');
      el.className = 'time-button';
      el.innerHTML = `
        <span class="time-marker"></span>
        <span class="time-text">${time.text}</span>
        <span class="time-str">${time.str}</span>`;
      el.addEventListener('click', () => {
        selected.showTimeText = time.text;
        selected.showTimeStr  = time.str;
        selected.personCount  = 0;

        $('person-show-subtitle')?.replaceChildren(document.createTextNode(selected.showSubtitle || ''));
        const pTitle = $('person-show-title');
        if (pTitle) { pTitle.replaceChildren(document.createTextNode(selected.showName || '')); pTitle.classList.toggle('long', (selected.showName || '').length > 22); }
        $('person-badge')?.replaceChildren(document.createTextNode(selected.showTimeText));
        $('person-time')?.replaceChildren(document.createTextNode(selected.showTimeStr));
        $('person-count')?.replaceChildren(document.createTextNode(String(selected.personCount)));

        navigateTo(screens.personSelect);
      });
      panel.appendChild(el);
    });
  }

  /* ====== 人数 → 最終確認 ====== */
  $('to-final-confirm')?.addEventListener('click', () => {
    $('final-confirm-badge')?.replaceChildren(document.createTextNode(selected.showTimeText));
    $('final-confirm-time-str')?.replaceChildren(document.createTextNode(selected.showTimeStr));
    $('final-confirm-count-num')?.replaceChildren(document.createTextNode(String(selected.personCount)));
    $('final-show-subtitle')?.replaceChildren(document.createTextNode(selected.showSubtitle || ''));
    const fTitle = $('final-show-title');
    if (fTitle) { fTitle.replaceChildren(document.createTextNode(selected.showName || '')); fTitle.classList.toggle('long', (selected.showName || '').length > 22); }
    navigateTo(screens.finalConfirm);
  });

  /* ====== 戻る ====== */
  document.querySelectorAll('.back-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.target);
      if (target) navigateTo(target);
    });
  });

  /* ====== はずれ → ホーム ====== */
  ['lose-to-home', 'lose-to-home-bbb', 'lose-to-home-pirates'].forEach(id => {
    $(id)?.addEventListener('click', () => navigateTo(screens.home));
  });

  /* ====== 抽選開始 ====== */
  $('start-lottery')?.addEventListener('click', async () => {
    // 万一の残りを掃除
    stopDraw();

    // すでに再生中なら頭出し、止まってたら再生（多重Play防止）
    try {
      if (sounds.draw.paused) {
        sounds.draw.currentTime = 0;
        await sounds.draw.play();
      } else {
        sounds.draw.currentTime = 0;
      }
    } catch {}

    const sub = $('drawing-show-subtitle'), title = $('drawing-show-name');
    if (sub) {
      if (selected.showSubtitle) { sub.textContent = selected.showSubtitle; sub.style.display = 'block'; }
      else { sub.style.display = 'none'; }
    }
    if (title) title.textContent = selected.showName;

    navigateTo(screens.drawing);

    const isWin = Math.random() < 0.5, delay = isWin ? 1500 : 300;
    setTimeout(() => {
      // navigateTo 内で drawing 以外に遷移すると stopDraw() が実行される
      if (isWin) { setWinTexts(); navigateTo(screens.win); }
      else { navigateTo(selected.showName === "PIRATES SUMMER BATTLE 'GET WET!'" ? screens.losePirates : screens.loseBBB); }
    }, delay);
  });

  /* ====== QR スキャナ ====== */
  const qrVideo  = $('qr-video');
  const qrCanvas = $('qr-canvas');
  const qrCtx    = qrCanvas && qrCanvas.getContext ? qrCanvas.getContext('2d', { willReadFrequently: true }) : null;

  let qrStream = null;
  let scanning = false;
  let awaitingNext = false;
  let clearFrames = 0;

// script.js の ensureJsQR を差し替え
const ensureJsQR = () => new Promise((resolve, reject) => {
  if (window.jsQR) return resolve();

  // 1) ローカル優先（オフライン対応）
  const s1 = document.createElement('script');
  s1.src = './lib/jsQR.min.js';
  s1.onload = () => window.jsQR ? resolve() : fallbackCDN();
  s1.onerror = fallbackCDN;
  document.head.appendChild(s1);

  function fallbackCDN() {
    if (window.jsQR) return resolve();
    const s2 = document.createElement('script');
    s2.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s2.onload = () => window.jsQR ? resolve() : reject(new Error('jsQR load error'));
    s2.onerror = () => reject(new Error('jsQR load error'));
    document.head.appendChild(s2);
  }
});


  async function getPreferredDeviceId(preferFront = true) {
    try {
      // 権限付与で label が埋まる
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(s => s.getTracks().forEach(t => t.stop()))
        .catch(()=>{});
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      if (!cams.length) return undefined;

      // ラベル/IDで front / back を推定
      const isFront = (d) => /front|user|selfie/i.test(d.label || '') || /front|user|selfie/i.test(d.deviceId || '');
      const isBack  = (d) => /back|environment|rear|world/i.test(d.label || '') || /back|environment|rear|world/i.test(d.deviceId || '');

      const pick = preferFront
        ? (cams.find(isFront) || cams[0])
        : (cams.find(isBack)  || cams[0]);

      return pick?.deviceId;
    } catch { return undefined; }
  }

  async function openStreamWithFallback(deviceId, preferFront = true) {
    const facingMode = preferFront ? 'user' : 'environment';
    const tryList = [
      { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}, facingMode },
      { width:{ideal:1280}, height:{ideal:720},  frameRate:{ideal:30}, facingMode },
      { width:{ideal:640},  height:{ideal:480},  frameRate:{ideal:30}, facingMode },
      {}
    ];
    let lastErr;
    for (const c of tryList) {
      try {
        const constraints = deviceId ? { deviceId:{ exact: deviceId }, ...c } : c;
        const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
        return stream;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  async function startCameraAndScan() {
    if (scanning) return;
    scanning = true; awaitingNext = false; clearFrames = 0;

    if (!navigator.mediaDevices?.getUserMedia) { scanning = false; return; }

    try {
      const deviceId = await getPreferredDeviceId(USE_FRONT);
      qrStream = await openStreamWithFallback(deviceId, USE_FRONT);

      if (qrVideo) {
        qrVideo.setAttribute('playsinline','');
        qrVideo.setAttribute('autoplay','');
        qrVideo.setAttribute('muted','');
        qrVideo.muted = true;
        qrVideo.srcObject = qrStream;
        try { await qrVideo.play(); } catch {}
      }
    } catch { scanning = false; return; }

    // BarcodeDetector（多規格）→ jsQR の順で試す
    let detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const wanted = [
          'qr_code','aztec','pdf417','data_matrix',
          'code_128','code_39','ean_13','ean_8','upc_a','upc_e'
        ];
        let formats = wanted;
        if (typeof BarcodeDetector.getSupportedFormats === 'function') {
          const supported = await BarcodeDetector.getSupportedFormats();
          formats = wanted.filter(f => supported.includes(f));
        }
        detector = new window.BarcodeDetector({ formats });
        console.log('[barcode] formats:', formats);
      } catch { detector = null; }
    }
    if (!detector) { try { await ensureJsQR(); } catch {} }

    const loop = async () => {
      if (!scanning) return;
      let hasCode = false;

      try {
        // 1) BarcodeDetector
        if (detector) {
          try {
            const codes = await detector.detect(qrVideo);
            if (codes && codes.length) { hasCode = true; if (!awaitingNext) onOneTicketDetected(); }
          } catch (e) {
            console.warn('[barcode] detect() error, fallback to jsQR', e);
            detector = null;
          }
        }

        // 2) jsQR（マルチパス：ROI/拡大/回転）
        if (!detector && window.jsQR && qrCtx) {
          const vw = qrVideo.videoWidth  || 1280;
          const vh = qrVideo.videoHeight || 720;

          qrCtx.imageSmoothingEnabled = false; // にじみ防止

          const passes = [
            { roi: 1.00, scale: 3, rotate: 0 },
            { roi: 0.85, scale: 3, rotate: 0 },
            { roi: 0.70, scale: 2, rotate: 0 },
            { roi: 1.00, scale: 2, rotate: 90 }, // 角度対策
          ];

          let code = null;
          for (const p of passes) {
            const roiW = Math.floor(vw * p.roi);
            const roiH = Math.floor(vh * p.roi);
            const roiX = Math.floor((vw - roiW) / 2);
            const roiY = Math.floor((vh - roiH) / 2);

            const outW = Math.floor(roiW * p.scale);
            const outH = Math.floor(roiH * p.scale);

            qrCanvas.width  = (p.rotate % 180 === 0) ? outW : outH;
            qrCanvas.height = (p.rotate % 180 === 0) ? outH : outW;

            qrCtx.save();
            if (p.rotate % 180 === 0) {
              qrCtx.drawImage(qrVideo, roiX, roiY, roiW, roiH, 0, 0, outW, outH);
            } else {
              qrCtx.translate(qrCanvas.width/2, qrCanvas.height/2);
              qrCtx.rotate((p.rotate * Math.PI) / 180);
              qrCtx.drawImage(qrVideo, roiX, roiY, roiW, roiH, -outW/2, -outH/2, outW, outH);
            }
            qrCtx.restore();

            const img  = qrCtx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
            const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
            if (code && code.data) { hasCode = true; if (!awaitingNext) onOneTicketDetected(); break; }
          }
        }
      } catch {}

      // “1枚ずつ”ゲート制御
      if (hasCode) {
        awaitingNext = true;
        clearFrames = 0;
      } else {
        clearFrames++;
        if (awaitingNext && clearFrames >= ONE_SHOT_DELAY_FRAMES) {
          awaitingNext = false;
          clearFrames = 0;
        }
      }

      setTimeout(() => requestAnimationFrame(loop), 120);
    };

    requestAnimationFrame(loop);
  }

  function stopCamera() {
    scanning = false;
    try { qrVideo?.pause(); } catch {}
    if (qrStream) {
      try { qrStream.getTracks().forEach(t => t.stop()); } catch {}
      qrStream = null;
    }
  }

  function onOneTicketDetected() {
    const el = document.getElementById('person-count');
    selected.personCount = Math.min(99, (selected.personCount || 0) + 1);
    if (el) {
      el.textContent = String(selected.personCount);
      playTick(); // 読み込み音（WebAudio優先）
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
  }

  /* ====== 初期表示 ====== */
  navigateTo(screens.home);
});
