/* ============================================================
   АРКА 123 — вертикальная страница, 6 блоков
   · блок 2 — фиксированный вьюпорт: страница внутри не
     прокручивается, один жест скролла = ровно один переход
     между сценами (перепрыгнуть сцену нельзя). Анимация
     персонажа играет нативно: прямой ролик вперёд, заранее
     закодированный обратный (ffmpeg reverse) — назад;
     промотка currentTime назад только как запасной вариант,
     если обратного файла нет.
   ============================================================ */
(() => {
"use strict";

const preloader = document.getElementById("preloader");
const preLogo   = document.getElementById("pre-logo");
const hoverLogo = document.getElementById("hover-logo");

/* ============================================================
   ПРЕЛОАДЕР: анимация логотипа как лоадер
   ============================================================ */
function runPreloader() {
  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      preloader.classList.add("is-done");
      setTimeout(() => { preloader.remove(); resolve(); }, 750);
    };
    preLogo.muted = true;
    const p = preLogo.play();
    if (p && p.catch) p.catch(() => {});
    preLogo.addEventListener("ended", done);
    setTimeout(done, 6000); // страховка
  });
}

/* ============================================================
   ИКОНКА В ХЕДЕРЕ: в покое — статичный первый кадр,
   при наведении — проигрывание ролика (PiP отключён атрибутом)
   ============================================================ */
function bindBrandLogo() {
  const brand = document.querySelector(".brand");
  const toStart = () => { try { hoverLogo.currentTime = 0; } catch (e) {} };

  hoverLogo.muted = true;
  hoverLogo.addEventListener("loadedmetadata", toStart, { once: true });
  hoverLogo.pause();
  toStart();

  brand.addEventListener("mouseenter", () => {
    toStart();
    const p = hoverLogo.play();
    if (p && p.catch) p.catch(() => {});
  });
  brand.addEventListener("mouseleave", () => {
    hoverLogo.pause();
    toStart();
  });
}

/* ============================================================
   БЛОК 2 — ВИДЕОСЦЕНА С ПЕРСОНАЖЕМ
   · секция .usp = ровно один экран; пока страница стоит на ней,
     колесо/клавиши/свайп перехватываются и страница не едет;
   · один «жест» (порог STEP_PX накопленного скролла + тишина
     после него) вызывает ровно один переход сцены — больше
     ни одного, пока жест не закончится;
   · вперёд играется персонаж.mp4, назад — персонаж-обратное.mp4
     (нативно, без потери плавности); если обратного файла нет,
     работает запасной вариант — промотка currentTime назад;
   · на первом/последней сцене жест отдаётся странице: можно
     уехать к герою вверх или к блоку 3 вниз.
   ============================================================ */
function bindSceneStage() {
  const section = document.getElementById("usp");
  const vFwd    = document.getElementById("v-fwd");
  const vRev    = document.getElementById("v-rev");
  const scenes  = [...document.querySelectorAll("#scenes .scene")];
  if (!section || !vFwd || !vRev || !scenes.length) return;

  const N = scenes.length;            // количество сцен = количество параметров
  let D = 5.04;                       // длительность ролика, уточнится по metadata
  let seg = D / N;                    // длительность одной сцены
  let idx = 0;                        // текущая сцена
  let mode = "above";                 // above | below | in  (внутри секции / над / под ней)
  let pendingLeave = false;           // только что отдали странице — не цепляться сразу же
  let animating = false;              // идёт переход сцены
  let gestureLocked = false;          // жест израсходован: один жест = один переход
  let acc = 0;                        // накопленный скролл текущего жеста
  let lastActivity = 0;
  let settleTimer = null;
  let revOK = vRev.readyState >= 2;   // обратный ролик доступен?
  let runId = 0;                      // сброс недоделанных проигрываний

  const STEP_PX = 45;                 // скролла, достаточно для одного перехода
  const EPS = 1 / 50;                 // полкадра — граница сцены на таймлайне

  vFwd.muted = true;
  vRev.muted = true;

  vRev.addEventListener("loadeddata", () => { revOK = true; });
  vRev.addEventListener("error", () => { revOK = false; });

  function readDuration() {
    if (isFinite(vFwd.duration) && vFwd.duration > 0) { D = vFwd.duration; seg = D / N; }
  }
  if (vFwd.readyState >= 1) readDuration();
  vFwd.addEventListener("loadedmetadata", readDuration, { once: true });

  const top = () => section.getBoundingClientRect().top + window.scrollY;
  const clampTo = t => window.scrollTo({ top: t, behavior: "instant" });

  // отладочный слепок состояния (виден снаружи через dataset)
  const sync = () => {
    section.dataset.state = mode + "|leave:" + (pendingLeave ? 1 : 0) +
      "|anim:" + (animating ? 1 : 0) + "|lock:" + (gestureLocked ? 1 : 0) +
      "|i:" + idx + "|acc:" + Math.round(acc);
  };

  /* ---------- показ сцены ----------
     с dir > 0 (жест вниз): уходящий тезис уезжает вверх, входящий
     всплывает снизу с задержкой; с dir < 0 — зеркально.
     без dir (первая загрузка/переходы границ) — просто переключение. */
  const DIR_CLS = ["from-down", "from-up", "to-up", "to-down"];
  let dirToken = 0;

  function armDir(el, cls, token) {
    el.classList.add(cls);
    el.addEventListener("animationend", function off() {
      el.removeEventListener("animationend", off);
      if (el.dataset.dirToken === String(token)) {
        el.classList.remove(...DIR_CLS);
        delete el.dataset.dirToken;
      }
    });
  }

  function showScene(i, dir) {
    const prev = scenes.findIndex(s => s.classList.contains("is-on"));
    const token = ++dirToken;
    scenes.forEach(s => { s.classList.remove(...DIR_CLS); delete s.dataset.dirToken; });
    scenes.forEach((s, k) => s.classList.toggle("is-on", k === i));
    if (!dir || prev < 0 || prev === i) return;
    const tokenStr = String(token);
    scenes[prev].dataset.dirToken = tokenStr;
    scenes[i].dataset.dirToken = tokenStr;
    if (dir > 0) { armDir(scenes[prev], "to-up", tokenStr); armDir(scenes[i], "from-down", tokenStr); }
    else         { armDir(scenes[prev], "to-down", tokenStr); armDir(scenes[i], "from-up",   tokenStr); }
  }

  /* ---------- тишина после жеста снимает его блокировку ---------- */
  function markActivity() {
    lastActivity = performance.now();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 160);
  }
  function settle() {
    if (performance.now() - lastActivity < 150 || animating) {
      settleTimer = setTimeout(settle, 120);   // жест ещё идёт или идёт переход
      return;
    }
    gestureLocked = false;
    acc = 0;
  }

  /* ---------- поза покоя: прямой ролик на границе сцены ---------- */
  function normalize(i) {
    runId++;
    animating = false;
    vFwd.pause(); vRev.pause();
    const target = i * seg;
    let swapped = false;
    const live = () => {
      if (swapped) return;
      swapped = true;
      vFwd.removeEventListener("seeked", seeked);
      vFwd.classList.add("is-live");
      vRev.classList.remove("is-live");
    };
    const seeked = () => live();
    vFwd.addEventListener("seeked", seeked);
    setTimeout(live, 300);                       // страховка: покажем в любом случае
    if (Math.abs(vFwd.currentTime - target) <= EPS) live();
    else { try { vFwd.currentTime = target; } catch (e) { live(); } }
  }

  /* ---------- вход в секцию ---------- */
  function enter(from) {
    runId++;
    if (from === "below") idx = N - 1;           // вернулись снизу — показываем последнюю сцену
    mode = "in";
    pendingLeave = false;
    animating = false;
    showScene(idx);
    normalize(idx);
    gestureLocked = false;
    acc = 0;
    sync();
  }

  /* ---------- выход: странице позволено уехать ---------- */
  function release(dir) {
    mode = dir > 0 ? "below" : "above";
    pendingLeave = true;
    gestureLocked = false;
    acc = 0;
    sync();
  }

  /* ---------- прямой проигрывание отрезка [from → to] ---------- */
  function playSeg(from, to, done) {
    const id = ++runId;
    const forward = to > from;
    const tFrom = from * seg, tTo = to * seg;

    if (!forward && !revOK) { scrubBack(tFrom, tTo, done, id); return; }   // запасной вариант

    const main = forward ? vFwd : vRev;
    const other = forward ? vRev : vFwd;
    other.pause();

    const start = forward ? tFrom : D - tFrom;   // в обратном ролике время зеркально
    const end   = forward ? tTo   : D - tTo;

    let started = false;
    const finish = () => {
      if (id !== runId) return;
      main.pause();
      try { main.currentTime = end; } catch (e) {}
      done();
    };
    const begin = () => {
      if (id !== runId || started) return;
      started = true;
      main.classList.add("is-live");             // кадры на границе совпадают — смены не видно
      other.classList.remove("is-live");
      const p = main.play();
      if (p && p.catch) p.catch(() => { if (id === runId) finish(); });
      setTimeout(finish, seg * 1000 + 300);      // страховка: переход завершится даже если rAF встал
      const tick = () => {
        if (id !== runId) return;
        if (main.currentTime >= end - EPS) finish();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    let guard = 0;
    const seeked = () => { main.removeEventListener("seeked", seeked); clearTimeout(guard); begin(); };
    main.addEventListener("seeked", seeked);
    guard = setTimeout(begin, 350);              // если seek не придёт — играем всё равно
    try { main.currentTime = start; } catch (e) { begin(); }
  }

  /* ---------- ЗАПАСНОЙ ВАРИАНТ: обратного ролика нет —
       промотка currentTime назад темпом прямого воспроизведения ---------- */
  function scrubBack(tFrom, tTo, done, id) {
    vRev.pause(); vFwd.pause();
    vFwd.classList.add("is-live");
    vRev.classList.remove("is-live");
    try { vFwd.currentTime = tFrom; } catch (e) {}
    const t0 = performance.now(), durMs = seg * 1000;
    const tick = now => {
      if (id !== runId) return;
      const p = Math.min(1, (now - t0) / durMs);
      try { vFwd.currentTime = tFrom + (tTo - tFrom) * p; } catch (e) {}
      if (p < 1) requestAnimationFrame(tick);
      else { try { vFwd.currentTime = tTo; } catch (e) {} done(); }
    };
    requestAnimationFrame(tick);
  }

  /* ---------- один переход ---------- */
  function step(dir) {
    const to = idx + dir;
    if (to < 0 || to > N - 1) return;            // границу проверяет вызывающий код
    if (animating) return;
    animating = true;
    idx = to;
    showScene(to, dir);                            // тезис уезжает/всплывает по направлению жеста
    playSeg(idx - dir, idx, () => { animating = false; });
  }

  function atEdge(dir) { return dir > 0 ? idx >= N - 1 : idx <= 0; }

  function attemptStep(dir) {
    if (animating || gestureLocked) return;      // переход идёт — новый жест не берём
    gestureLocked = true;
    markActivity();
    step(dir);
    sync();
  }

  /* ---------- КОЛЕСО ---------- */
  function onWheel(e) {
    sync();
    const t = top(), y = window.scrollY;
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= window.innerHeight * 0.8;

    if (mode === "in") {
      e.preventDefault();                        // страница внутри секции не прокручивается
      if (d === 0) return;
      markActivity();
      acc += d;
      if (Math.abs(acc) >= STEP_PX) {
        const dir = acc > 0 ? 1 : -1;
        acc = 0;
        if (atEdge(dir) && !animating && !gestureLocked) { release(dir); return; }  // без preventDefault — уезжаем наружу
        e.preventDefault();
        attemptStep(dir);
      }
      return;
    }

    if (pendingLeave) {                          // только отдались — но если страница уже уехала, снова цепляемся
      if (Math.abs(y - t) > 1) pendingLeave = false;
      else return;
    }
    if (mode === "above" && y > t + 150) mode = "below";   // проскочили секцию без события scroll
    if (mode === "below" && y < t - 1) {                   // оказались выше секции без события scroll
      mode = "above"; idx = 0; showScene(0);               // вернулись от героя — ждём первая сцена
    }
    // этот жест как раз доводит страницу до секции — захватываем его без прыжка
    if (mode === "above" && d > 0 && y <= t + 1 && y + d >= t - 1) {
      e.preventDefault(); clampTo(t); enter("above"); return;
    }
    if (mode === "below" && d < 0 && y >= t - 1 && y + d <= t + 1) {
      e.preventDefault(); clampTo(t); enter("below"); return;
    }
  }

  /* ---------- КЛАВИАТУРА ---------- */
  window.addEventListener("keydown", e => {
    if (mode !== "in") return;
    if (typeof booking !== "undefined" && booking && !booking.hidden) return;
    const map = { ArrowDown: 1, PageDown: 1, " ": 1, Spacebar: 1, ArrowUp: -1, PageUp: -1 };
    const dir = map[e.key];
    if (!dir) return;
    if (atEdge(dir) && !animating && !gestureLocked) { release(dir); return; }  // отдаём скролл странице
    e.preventDefault();
    markActivity();
    attemptStep(dir);
  });

  /* ---------- СВАЙП ---------- */
  let touchY = null;
  window.addEventListener("touchstart", e => {
    if (mode === "in") touchY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (mode !== "in" || touchY === null) return;
    const y = e.touches[0].clientY;
    const d = touchY - y;                        // вниз по экрану > 0
    touchY = y;
    markActivity();
    acc += d;
    if (Math.abs(acc) >= STEP_PX) {
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      if (atEdge(dir) && !animating && !gestureLocked) { release(dir); return; }  // без preventDefault
      e.preventDefault();
      attemptStep(dir);
      return;
    }
    e.preventDefault();                          // страница не едет, пока мы внутри
  }, { passive: false });
  window.addEventListener("touchend", () => {
    touchY = null;
    acc = 0;
    markActivity();
  }, { passive: true });

  /* ---------- СИНХРОНИЗАЦИЯ С ПРОКРУТКОЙ СТРАНИЦЫ ---------- */
  function onScroll() {
    sync();
    const t = top(), y = window.scrollY;

    if (mode === "in") {
      if (pendingLeave) {                        // ждали, пока страница реально уедет
        if (Math.abs(y - t) > 1) { pendingLeave = false; mode = y > t ? "below" : "above"; }
        return;
      }
      if (Math.abs(y - t) > 1) clampTo(t);       // что-то сверхнуло прокрутку — возвращаем экран
      return;
    }

    if (pendingLeave) {                          // только отдались — не цепляемся тут же
      if (Math.abs(y - t) > 1) pendingLeave = false;
      else return;
    }

    if (Math.abs(y - t) <= 1) { enter(mode); return; }  // доехали скроллбаром, клавишей или hash

    if (mode === "below" && y < t - 1) { mode = "above"; idx = 0; showScene(0); }   // ушли выше секции (hash/перезагрузка)
    if (mode === "above" && y > t + 150) mode = "below"; // проскочили секцию большой дельтой
  }

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  // старт: показ первой сцены, первый кадр прямого ролика
  showScene(0);
  vFwd.classList.add("is-live");
  onScroll();
}

/* ============================================================
   ПОЯВЛЕНИЕ БЛОКОВ ПРИ ВХОДЕ В ЭКРАН
   ============================================================ */
function bindReveal() {
  const targets = document.querySelectorAll(
    ".details-inner > *, .reviews-inner > *, .review, .cta-copy > *, .tariff, .footer-grid > div"
  );
  targets.forEach((el, i) => {
    el.classList.add("reveal");
    el.style.transitionDelay = (i % 6) * 60 + "ms";
  });

  if (!("IntersectionObserver" in window)) {
    targets.forEach(el => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
  targets.forEach(el => io.observe(el));
}

/* ============================================================
   МОДАЛКА БРОНИ
   ============================================================ */
const booking = document.getElementById("booking");
document.addEventListener("click", e => {
  if (e.target.closest("[data-contact]")) { e.preventDefault(); booking.hidden = false; }
});
document.getElementById("booking-close").addEventListener("click", () => booking.hidden = true);
booking.addEventListener("click", e => { if (e.target === booking) booking.hidden = true; });
document.addEventListener("keydown", e => { if (e.key === "Escape") booking.hidden = true; });
document.getElementById("booking-form").addEventListener("submit", e => {
  e.preventDefault();
  document.getElementById("booking-done").hidden = false;
  setTimeout(() => { booking.hidden = true; document.getElementById("booking-done").hidden = true; e.target.reset(); }, 2200);
});

/* ============================================================
   СЛАЙШОУ В БЛОКЕ 3: анимация ставится на паузу,
   пока блок не виден на экране
   ============================================================ */
function bindSlideshow() {
  const slides = document.querySelector(".cta-slides");
  if (!slides || !("IntersectionObserver" in window)) return;
  slides.style.animationPlayState = "paused";
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const state = en.isIntersecting ? "running" : "paused";
      slides.querySelectorAll("img").forEach(img => img.style.animationPlayState = state);
    });
  }, { threshold: 0.05 });
  io.observe(slides);
}

/* ============================================================
   СТАРТ
   ============================================================ */
/* ============================================================
   ФОТОГАЛЕРЕЯ: лента в одну строку едет вбок по вертикальному
   скроллу — секция «липнет» на экране, пока не проедет вся лента
   ============================================================ */
function bindGalleryScroll() {
  const sec = document.getElementById('gallery');
  const track = document.getElementById('gallery-track');
  if (!sec || !track) return;

  let max = 0, top = 0, span = 1;

  function layout() {
    track.style.transition = 'none';
    track.style.transform = 'none';
    max = Math.max(0, track.scrollWidth - track.clientWidth);
    /* высота секции = экран + дистанция хода ленты (чуть короче, чтобы было быстро) */
    sec.style.height = (window.innerHeight + max * 0.9) + 'px';
    top = sec.offsetTop;
    span = Math.max(1, sec.offsetHeight - window.innerHeight);
    requestAnimationFrame(() => { track.style.transition = ''; });
  }

  function update() {
    let p = (window.scrollY - top) / span;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    track.style.transform = 'translate3d(' + (-max * p) + 'px,0,0)';
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', () => { layout(); update(); });

  /* ширина может «поехать» после загрузки фото/шрифтов */
  window.addEventListener('load', () => { layout(); update(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); update(); });

  layout();
  update();
}

bindBrandLogo();
bindSceneStage();
bindReveal();
bindSlideshow();
bindGalleryScroll();
runPreloader();

})();
