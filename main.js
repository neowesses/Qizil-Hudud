/* =========================================================
   QIZIL HUDUD — main.js
   3D scroll на canvas (кадры из папки photo), GSAP + ScrollTrigger, Lenis
   ========================================================= */

/* ====================== НАСТРОЙКИ ====================== */

// Кнопка FREE TO PLAY — папка с игрой на Google Drive
const DOWNLOAD_URL = 'https://drive.google.com/drive/folders/1GnDFUyceRZAilmkRGIKrrbHG2oMOSOr4?usp=drive_link';

// Telegram-бот для заявок COMMERCIAL OFFERS (инструкция — в README.txt)
const TELEGRAM_BOT_TOKEN = '';   // токен НЕ хранится в публичном репозитории — см. README
const TELEGRAM_CHAT_ID = '6508479737';   // ваш чат с ботом

// Безопасная отправка через сервер (api/lead.php, токен скрыт). Пусто — отправка напрямую в Telegram.
const LEAD_ENDPOINT = '';   // например: 'api/lead.php' (см. README.txt, «Безопасность»)

// Кадры 3D-скролла (website-photo: fire.0070 … fire.0140 → 001 … 071)
const FRAME_COUNT = 71;
const framePath = (i, mobile) => `frames/${mobile ? 'mobile' : 'desktop'}/${String(i).padStart(3, '0')}.webp`;

/* ======================================================= */

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
gsap.registerPlugin(ScrollTrigger);

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = matchMedia('(max-width: 768px)').matches;
const isPhone = matchMedia('(max-width: 600px)').matches;   // телефон: hero как на старом сайте
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- Ссылки на скачивание ---------- */
document.querySelectorAll('[data-download], .dl__go').forEach((a) => { a.href = DOWNLOAD_URL; a.target = '_blank'; a.rel = 'noopener'; });

/* ---------- Плавный скролл ---------- */
let lenis = null;
if (!reduceMotion && window.Lenis) {
  lenis = new window.Lenis({ duration: 1.2, smoothWheel: true, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop();                       // пока идёт загрузка
}
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const id = a.getAttribute('href');
  if (id.length < 2) return;
  e.preventDefault();
  lenis ? lenis.scrollTo(id, { duration: 1.6 }) : document.querySelector(id).scrollIntoView({ behavior: 'smooth' });
}));

/* =========================================================
   1. ЗАГРУЗКА КАДРОВ + ЭКРАН ЗАГРУЗКИ
   ========================================================= */
const frames = [];
function preload() {
  if (isPhone) {
    // На телефоне 3D-кадры не нужны — грузим только картинку hero
    return new Promise((resolve) => {
      const fill = document.querySelector('.loader__fill');
      const img = document.querySelector('.mhero__bg');
      const end = () => { gsap.to(fill, { scaleX: 1, duration: 0.6, ease: 'power2.out', onComplete: resolve }); };
      gsap.fromTo(fill, { scaleX: 0 }, { scaleX: 0.7, duration: 1, ease: 'power2.out' });
      if (img.complete) end(); else { img.onload = end; img.onerror = end; }
    });
  }
  return new Promise((resolve) => {
    let done = 0;
    const fill = document.querySelector('.loader__fill');
    const shown = { v: 0 };
    const tick = () => {
      const target = done / FRAME_COUNT;
      gsap.to(shown, { v: target, duration: 0.45, overwrite: true, onUpdate: () => {
        fill.style.transform = `scaleX(${shown.v})`;                       // полоса загрузки
      } });
    };
    for (let i = 1; i <= FRAME_COUNT; i++) {
      const img = new Image();
      img.decoding = 'async';
      const finish = () => { done++; tick(); if (done === FRAME_COUNT) resolve(); };
      img.onload = () => (img.decode ? img.decode().catch(() => {}).finally(finish) : finish());
      if (i === 1) img.addEventListener('load', () => { lastDrawn = -1; renderHero(); });
      img.onerror = finish;
      img.src = framePath(i, isMobile);
      frames.push(img);
    }
  });
}

async function runLoader() {
  const minTime = new Promise((r) => setTimeout(r, 1400));
  await Promise.all([preload(), minTime, document.fonts.ready.catch(() => {})]);
  if (!isPhone) { lastDrawn = -1; renderHero(); }                          // первый кадр сразу после загрузки
  await new Promise((r) => setTimeout(r, 350));          // даём счётчику дойти до 100
  const loader = document.querySelector('.loader');
  const tl = gsap.timeline({ onComplete: () => { loader.remove(); } });
  tl.to(['.loader__track', '.loader__text'], { opacity: 0, y: 20, duration: 0.5, stagger: 0.06, ease: 'power3.in' }, '+=0.2')
    .add(() => { loader.classList.add('is-done'); document.body.classList.remove('is-loading'); if (lenis) lenis.start(); startHeroIntro(); })
    .to(loader, { opacity: 0, duration: 0.9, ease: 'power2.inOut' }, '<');
}

/* =========================================================
   2. HERO — 3D scroll: кадры на canvas «собираются» при прокрутке
   (техника Cyberfiction: scaleImage + scrub по кадрам,
    плюс плавное смешивание соседних кадров)
   ========================================================= */
const canvas = document.querySelector('.hero__canvas');
const ctx = canvas.getContext('2d');
const seq = { frame: 0 };            // дробный индекс 0 … FRAME_COUNT-1
let heroDark = 0;

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  renderHero();
}

function drawCover(img, alpha = 1) {
  if (!img || !img.complete || !img.naturalWidth) return;
  const W = canvas.width, H = canvas.height, iw = img.naturalWidth, ih = img.naturalHeight;
  ctx.globalAlpha = alpha;
  const r = Math.max(W / iw, H / ih);                    // cover: кадр заполняет экран
  const w = iw * r, h = ih * r;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

let lastDrawn = -1;
function renderHero() {
  const f = seq.frame;
  if (Math.abs(f - lastDrawn) < 0.002 && heroDark === renderHero.lastDark) return;
  lastDrawn = f; renderHero.lastDark = heroDark;
  const a = Math.floor(f), b = Math.min(a + 1, FRAME_COUNT - 1), t = f - a;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCover(frames[a]);
  if (t > 0.01 && b !== a) drawCover(frames[b], t);       // мягкий переход между кадрами
  if (heroDark > 0) { ctx.fillStyle = `rgba(5,6,7,${heroDark})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
}

const progressEl = document.querySelector('.hero__progress');
const frameNumEl = document.querySelector('.hero__frame');

function initHero() {
  sizeCanvas();
  document.querySelectorAll('.hero__line').forEach((l) => splitChars(l));
  if (!reduceMotion) { gsap.set('.hero__title .char', { color: 'rgba(179,0,0,0)' }); document.querySelector('.hero__script').classList.add('is-masked'); }
  window.addEventListener('resize', sizeCanvas);

  gsap.to(seq, {
    frame: FRAME_COUNT - 1,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom bottom', scrub: 0.6 },
    onUpdate: () => {
      renderHero();
      const n = Math.round(seq.frame) + 1;
      frameNumEl.textContent = String(n).padStart(2, '0');
      progressEl.style.setProperty('--p', (seq.frame / (FRAME_COUNT - 1)).toFixed(3));
    },
  });

  // Камера: лёгкий наезд и затемнение в конце сцены
  gsap.fromTo(canvas, { scale: 1 }, { scale: isMobile ? 1.04 : 1.12, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom bottom', scrub: true } });
  // Фон темнеет при прокрутке, текст остаётся белым
  gsap.fromTo('.hero__shade', { opacity: 0 }, { opacity: 0.72, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom bottom', scrub: true } });
  gsap.to('.hero__script', { color: '#ffffff', ease: 'none', scrollTrigger: { trigger: '.hero', start: '2% top', end: '22% top', scrub: true } });
  gsap.to(['.hero__scroll'], { opacity: 0, y: -20, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '15% top', scrub: true } });

  // Мини-параллакс за мышкой
  if (finePointer && !reduceMotion) {
    const cx = gsap.quickTo(canvas, 'x', { duration: 1.2, ease: 'power3.out' });
    const cy = gsap.quickTo(canvas, 'y', { duration: 1.2, ease: 'power3.out' });
    window.addEventListener('pointermove', (e) => {
      cx((e.clientX / innerWidth - 0.5) * -24);
      cy((e.clientY / innerHeight - 0.5) * -16);
    }, { passive: true });
  }
}

function startHeroIntro() {
  if (reduceMotion) return;
  if (isPhone) {
    gsap.from('.mhero__bg', { scale: 1.15, duration: 2.2, ease: 'power3.out', clearProps: 'transform' });
    gsap.from('.mhero__script', { color: '#1c0303', duration: 1.4, delay: 0.3, ease: 'power2.out', clearProps: 'color' });
    gsap.from(['.mhero__title', '.mhero__info'], { color: '#3a0a0a', duration: 1.4, delay: 0.5, stagger: 0.15, ease: 'power2.out', clearProps: 'color' });
    return;
  }
  // Текст из Figma: «another day» прописывается слева направо, буквы IN THE RED ZONE загораются
  const script = document.querySelector('.hero__script');
  const rev = { r: 0 };   // мягкая маска с размытым краем — без резкого обреза букв
  gsap.to(rev, { r: 130, duration: 2, delay: 0.3, ease: 'power2.inOut',
    onUpdate: () => script.style.setProperty('--r', rev.r + '%'),
    onComplete: () => script.classList.add('is-shown') });
  gsap.fromTo('.hero__title .char', { color: 'rgba(179,0,0,0)' }, { keyframes: [{ color: 'rgba(179,0,0,1)', duration: 0.5 }, { color: 'rgba(255,255,255,1)', duration: 0.6 }], stagger: 0.06, delay: 0.5, ease: 'power2.out' });
  gsap.fromTo('.hero__info', { color: '#3a0a0a' }, { color: '#ffffff', duration: 1.4, delay: 1.2, ease: 'power2.out', clearProps: 'color' });
  gsap.fromTo('.hero__canvas', { filter: 'brightness(0.25)' }, { filter: 'brightness(1)', duration: 2.2, ease: 'power2.out', clearProps: 'filter' });
  gsap.from('.header', { yPercent: -100, duration: 1, ease: 'power3.out', delay: 0.2 });
  gsap.from('.hero__zaman', { opacity: 0, duration: 1.4, delay: 0.9, ease: 'power2.out', clearProps: 'opacity' });   // появляется один раз и остаётся
  gsap.from(['.hero__progress', '.hero__scroll'], { opacity: 0, y: 30, duration: 1, stagger: 0.12, delay: 0.7, ease: 'power3.out' });
}

/* =========================================================
   3. Текстовые анимации
   ========================================================= */
function splitLines(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute('aria-label', el.textContent.trim());
  el.textContent = '';
  const spans = words.map((w, i) => { const s = document.createElement('span'); s.textContent = w + (i < words.length - 1 ? ' ' : ''); el.appendChild(s); return s; });
  const lines = []; let top = null;
  spans.forEach((s) => { if (s.offsetTop !== top) { lines.push([]); top = s.offsetTop; } lines[lines.length - 1].push(s.textContent); });
  el.textContent = '';
  return lines.map((l) => {
    const m = document.createElement('span'); m.className = 'line-mask'; m.setAttribute('aria-hidden', 'true');
    const i = document.createElement('span'); i.className = 'line-inner'; i.textContent = l.join('');
    m.appendChild(i); el.appendChild(m); return i;
  });
}
function splitChars(el) {
  const t = el.textContent; el.setAttribute('aria-label', t); el.textContent = '';
  return [...t].map((c) => { const s = document.createElement('span'); s.className = 'char'; s.setAttribute('aria-hidden', 'true'); s.textContent = c === ' ' ? ' ' : c; el.appendChild(s); return s; });
}

function initTextAnimations() {
  if (reduceMotion) return;
  document.querySelectorAll('[data-split-lines]').forEach((el) => {
    const lines = splitLines(el);
    gsap.from(lines, { color: '#3a0a0a', duration: 1.2, ease: 'power2.out', stagger: 0.08, clearProps: 'color', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
  });
}

/* =========================================================
   5. О игре: карточки, бейджи, параллакс
   ========================================================= */
function initAbout() {
  if (reduceMotion) return;
  gsap.from('.platforms li', { opacity: 0, y: 30, duration: 0.9, stagger: 0.1, clearProps: 'transform,opacity', ease: 'power3.out', scrollTrigger: { trigger: '.platforms', start: 'top 90%', once: true } });

  gsap.from('.card', {
    opacity: 0, y: 160, rotateX: 40, rotateY: (i) => (i - 1.5) * -10, transformOrigin: '50% 100%',
    duration: 1.4, ease: 'power4.out', stagger: 0.12,
    scrollTrigger: { trigger: '.cards', start: 'top 92%', once: true },
  });
  // параллакс картинок внутри карточек
  document.querySelectorAll('.card__img').forEach((img) => {
    gsap.fromTo(img, { yPercent: -5 }, { yPercent: 5, ease: 'none', scrollTrigger: { trigger: img.closest('.card'), start: 'top bottom', end: 'bottom top', scrub: true } });
  });
  // наклон за курсором
  if (finePointer) {
    document.querySelectorAll('.card').forEach((card) => {
      const link = card.querySelector('.card__link');
      const rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3.out' });
      const ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3.out' });
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        ry((px - 0.5) * 16); rx((0.5 - py) * 14);
        link.style.setProperty('--gx', `${px * 100}%`); link.style.setProperty('--gy', `${py * 100}%`);
      });
      card.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });
  }
  gsap.fromTo('.unreal__logo', { rotate: -120 }, { rotate: 0, ease: 'none', scrollTrigger: { trigger: '.about__bottom', start: 'top bottom', end: 'center center', scrub: true } });
  gsap.from('.offers', { opacity: 0, y: 50, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: '.about__bottom', start: 'top 90%', once: true } });
}

/* =========================================================
   6. COMMERCIAL OFFERS → Telegram
   ========================================================= */
/* ---------- Общие помощники: маска телефона и отправка в Telegram ---------- */
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
};
function phoneMask(input) {
  input.addEventListener('input', () => {
    let d = input.value.replace(/\D/g, '');
    if (d.startsWith('998')) d = d.slice(3);
    d = d.slice(0, 9);
    let v = '+998';
    if (d.length) v += ' (' + d.slice(0, 2);
    if (d.length >= 2) v += ')';
    if (d.length > 2) v += ' ' + d.slice(2, 5);
    if (d.length > 5) v += '-' + d.slice(5, 7);
    if (d.length > 7) v += '-' + d.slice(7, 9);
    input.value = d.length ? v : '';
  });
  input.addEventListener('focus', () => { if (!input.value) input.value = '+998 '; });
}
const phoneOk = (v) => v.replace(/\D/g, '').length === 12;
const nowTashkent = () => new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
const deviceName = () => (matchMedia('(max-width: 768px)').matches ? 'телефон' : 'компьютер') + ' · ' + (navigator.language || '');
// Отправка заявки: через api/lead.php (если указан) или напрямую в Telegram
async function sendLead(data, text, form) {
  if (form && form.elements.company && form.elements.company.value) return;   // ловушка для спам-ботов
  if (LEAD_ENDPOINT) {
    const r = await fetch(LEAD_ENDPOINT, { method: 'POST', body: new URLSearchParams({ ...data, device: deviceName(), company: '' }) });
    if (!r.ok) throw new Error('lead');
    return;
  }
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) throw new Error('not configured');
  const body = new URLSearchParams({ chat_id: TELEGRAM_CHAT_ID, text });
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  let ok = false;
  try { const r = await fetch(url, { method: 'POST', body }); ok = r.ok; }
  catch (_) { await fetch(url, { method: 'POST', body, mode: 'no-cors' }); ok = true; }   // если браузер блокирует ответ
  if (!ok) throw new Error('telegram');
}

function initOffers() {
  const form = document.querySelector('.offers');
  const input = form.querySelector('input');
  const status = form.querySelector('.offers__status');
  phoneMask(input);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!phoneOk(input.value)) { status.textContent = 'Enter the full number: +998 (XX) XXX-XX-XX'; input.focus(); return; }
    if (Date.now() - (+store.get('qh_offer_ts') || 0) < 30000) { status.textContent = 'Already sent. Please wait a moment.'; return; }
    status.textContent = 'Sending…';
    try {
      await sendLead({ type: 'offer', phone: input.value }, `💼 QIZIL HUDUD — COMMERCIAL OFFER\nТелефон: ${input.value}\nДата: ${nowTashkent()}\nУстройство: ${deviceName()}`, form);
      store.set('qh_offer_ts', String(Date.now()));
      status.textContent = 'Thank you! We will contact you soon.';
      form.classList.add('is-sent'); input.value = '';
    } catch (err) {
      status.textContent = 'Could not send. Please call +998 (33) 500 33 05.';
    }
  });
}

/* ---------- Форма перед скачиванием игры ---------- */
function initDownloadGate() {
  const dl = document.querySelector('.dl');
  const form = dl.querySelector('.dl__form');
  const done = dl.querySelector('.dl__done');
  const status = dl.querySelector('.dl__status');
  const [first, last, phone] = ['first', 'last', 'phone'].map((n) => form.elements[n]);
  phoneMask(phone);
  let lastFocus = null;

  const open = () => {
    lastFocus = document.activeElement;
    dl.hidden = false; document.documentElement.classList.add('dl-open');
    if (lenis) lenis.stop();
    gsap.fromTo('.dl__backdrop', { opacity: 0 }, { opacity: 1, duration: 0.4 });
    gsap.fromTo('.dl__panel', { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out' });
    setTimeout(() => (done.hidden ? first : dl.querySelector('.dl__go')).focus(), 60);
  };
  const close = () => {
    gsap.to(['.dl__panel', '.dl__backdrop'], { opacity: 0, duration: 0.25, onComplete: () => {
      dl.hidden = true; document.documentElement.classList.remove('dl-open');
      if (lenis) lenis.start(); if (lastFocus) lastFocus.focus();
    } });
  };

  // Любая кнопка FREE TO PLAY сначала открывает форму (кто уже заполнил — скачивает сразу)
  document.querySelectorAll('[data-download]').forEach((a) => a.addEventListener('click', (e) => {
    if (store.get('qh_dl_ok')) return;
    e.preventDefault();
    document.querySelector('.header').classList.remove('menu-open');
    const menu = document.querySelector('.mobile-menu'); if (menu) menu.hidden = true;
    document.querySelector('.header__burger').setAttribute('aria-expanded', 'false');
    open();
  }));
  dl.querySelectorAll('[data-dl-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (!dl.hidden && e.key === 'Escape') close(); });
  dl.querySelector('.dl__go').addEventListener('click', () => setTimeout(close, 300));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = first.value.trim(), l = last.value.trim();
    [first, last, phone].forEach((i) => i.closest('.dl__field').classList.remove('is-error'));
    const bad = [];
    if (f.length < 2) bad.push(first);
    if (l.length < 2) bad.push(last);
    if (!phoneOk(phone.value)) bad.push(phone);
    if (bad.length) {
      bad.forEach((i) => i.closest('.dl__field').classList.add('is-error'));
      status.textContent = bad.includes(phone) && bad.length === 1 ? 'Enter the full number: +998 (XX) XXX-XX-XX' : 'Please fill in all fields.';
      bad[0].focus(); return;
    }
    status.textContent = 'Sending…';
    form.querySelector('.dl__submit').disabled = true;
    try {
      await sendLead({ type: 'download', first: f, last: l, phone: phone.value }, `🎮 QIZIL HUDUD — СКАЧИВАНИЕ ИГРЫ\nИмя: ${f}\nФамилия: ${l}\nТелефон: ${phone.value}\nДата: ${nowTashkent()}\nУстройство: ${deviceName()}`, form);
      store.set('qh_dl_ok', '1');
      dl.querySelector('.dl__name').textContent = f.toUpperCase();
      form.hidden = true; done.hidden = false;
      gsap.from(done, { opacity: 0, y: 10, duration: 0.5, ease: 'power3.out' });
      dl.querySelector('.dl__go').focus();
    } catch (err) {
      status.textContent = 'Could not send. Check the internet and try again.';
    } finally {
      form.querySelector('.dl__submit').disabled = false;
    }
  });
}

/* =========================================================
   8. Финал и футер
   ========================================================= */
function initFinal() {
  if (reduceMotion) return;
  document.querySelectorAll('[data-split-chars]').forEach((el, k) => {
    const chars = splitChars(el);
    gsap.fromTo(chars, { color: '#1c0303' }, { keyframes: [{ color: '#b30000', duration: 0.5 }, { color: '#ffffff', duration: 0.7 }], stagger: 0.05, ease: 'power2.out', delay: k * 0.2, scrollTrigger: { trigger: '.final', start: 'top 75%', once: true } });
  });
  gsap.from('.final__script', { color: '#1c0303', duration: 1.6, ease: 'power2.out', scrollTrigger: { trigger: '.final', start: 'top 75%', once: true } });
  gsap.from('.btn-free--hero', { opacity: 0, y: 40, duration: 1, delay: 0.5, ease: 'power3.out', scrollTrigger: { trigger: '.final', start: 'top 75%', once: true } });

  // Красный орнамент: поднимается при скролле, покачивается, реагирует на мышь
  const setFooterH = () => document.documentElement.style.setProperty('--footer-h', document.querySelector('.footer').offsetHeight + 'px');
  setFooterH(); addEventListener('resize', setFooterH);
  // Сначала большой, затем возвращается к обычному размеру
  gsap.fromTo('.final__ornament', { scale: 1.9 }, { scale: 1, ease: 'power1.out', scrollTrigger: { trigger: '.final', start: 'top 80%', end: 'bottom bottom', scrub: 0.8 } });
  gsap.to('.final__ornament img', { rotate: 2.5, duration: 4, ease: 'sine.inOut', yoyo: true, repeat: -1, transformOrigin: '50% 0%', startAt: { rotate: -2.5 } });
  const orn = document.querySelector('.final__ornament');
  const ornX = gsap.quickTo(orn, 'x', { duration: 1.2, ease: 'power3.out' });
  const ornR = gsap.quickTo(orn, 'rotate', { duration: 1.2, ease: 'power3.out' });
  document.querySelector('.final').addEventListener('pointermove', (e) => { const k = e.clientX / innerWidth - 0.5; ornX(k * -40); ornR(k * 3); });
  gsap.from(['.footer__title', '.footer__social a', '.badge18', '.footer__phone', '.footer__mail', '.footer__copy'], { color: '#3d0000', duration: 1.2, stagger: 0.08, clearProps: 'color', ease: 'power3.out', scrollTrigger: { trigger: '.footer', start: 'top 85%', once: true } });
}

/* =========================================================
   9. Курсор: линза, подпись, клик-волна
   ========================================================= */
function initCursor() {
  if (!finePointer) return;
  const cur = document.querySelector('.cursor');
  const label = cur.querySelector('.cursor__label');
  document.documentElement.classList.add('has-cursor');
  const xTo = gsap.quickTo(cur, 'x', { duration: 0.45, ease: 'power3.out' });
  const yTo = gsap.quickTo(cur, 'y', { duration: 0.45, ease: 'power3.out' });
  let first = true;
  window.addEventListener('pointermove', (e) => {
    if (first) { gsap.set(cur, { x: e.clientX, y: e.clientY }); first = false; }
    xTo(e.clientX); yTo(e.clientY);
  }, { passive: true });
  const HOVER = 'a, button, input, label, .card, .footer__title, .final__title, .platforms li';
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest(HOVER);
    cur.classList.toggle('is-hover', !!t);
    const l = t && t.closest('[data-cursor]');
    label.textContent = l ? l.dataset.cursor : '';
    cur.classList.toggle('has-label', !!l);
  });
  document.addEventListener('pointerdown', (e) => {
    cur.classList.add('is-down');
    const r = document.createElement('span');
    r.className = 'cursor__ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r);
    gsap.to(r, { scale: 9, opacity: 0, duration: 0.8, ease: 'power3.out', onComplete: () => r.remove() });
  });
  document.addEventListener('pointerup', () => cur.classList.remove('is-down'));
  document.documentElement.addEventListener('mouseleave', () => gsap.to(cur, { autoAlpha: 0, duration: 0.2 }));
  document.documentElement.addEventListener('mouseenter', () => gsap.to(cur, { autoAlpha: 1, duration: 0.2 }));
}

/* =========================================================
   10. Меню, SOON, магнитные кнопки, мини-параллакс
   ========================================================= */
function initUI() {
  // SOON для MILLIYBIZ.TV, CRM, NEWS MILLIYBIZ
  const toast = document.querySelector('.soon-toast');
  document.querySelectorAll('[data-soon]').forEach((b) => b.addEventListener('click', () => {
    gsap.killTweensOf(toast);
    gsap.timeline()
      .fromTo(toast, { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.45, ease: 'back.out(2)' })
      .to(toast, { opacity: 0, y: -20, duration: 0.4, ease: 'power2.in' }, '+=1.2');
  }));

  // Мобильное меню
  const header = document.querySelector('.header');
  const burger = document.querySelector('.header__burger');
  const menu = document.querySelector('.mobile-menu');
  burger.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    header.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    if (open) { lenis && lenis.stop(); gsap.from(menu.children, { y: 40, opacity: 0, stagger: 0.06, duration: 0.6, ease: 'power3.out' }); }
    else lenis && lenis.start();
  });

  if (!finePointer || reduceMotion) return;
  // Магнитные кнопки
  document.querySelectorAll('.btn-free, .nav-link, .card__play').forEach((el) => {
    const mx = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
    const my = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); mx((e.clientX - r.left - r.width / 2) * 0.25); my((e.clientY - r.top - r.height / 2) * 0.35); });
    el.addEventListener('pointerleave', () => { mx(0); my(0); });
  });
  // Мини-параллакс элементов с data-depth
  const items = [...document.querySelectorAll('[data-depth]')].map((el) => ({ d: +el.dataset.depth, x: gsap.quickTo(el, 'x', { duration: 1, ease: 'power3.out' }), y: gsap.quickTo(el, 'y', { duration: 1, ease: 'power3.out' }) }));
  window.addEventListener('pointermove', (e) => {
    const px = e.clientX / innerWidth - 0.5, py = e.clientY / innerHeight - 0.5;
    items.forEach((it) => { it.x(px * 40 * it.d); it.y(py * 30 * it.d); });
  }, { passive: true });
}

/* ---------- Запуск ---------- */
(async function start() {
  try { await document.fonts.ready; } catch (_) {}
  initCursor();
  initUI();
  if (!isPhone) initHero();
  initTextAnimations();
  initAbout();
  initOffers();
  initDownloadGate();
  initFinal();
  ScrollTrigger.refresh();
  runLoader();
})();
