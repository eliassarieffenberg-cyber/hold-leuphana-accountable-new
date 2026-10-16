document.documentElement.classList.add('js');

function init() {
  /* ---------- Report embedded in the page (password-protected version) ----------
     tools/protect.mjs puts the PDF inside the encrypted index.html, so it is
     only readable after the password is entered. Turn it into a local file URL
     and point the reader and the buttons at it. */
  const embedded = document.getElementById('report-data');
  if (embedded) {
    try {
      const bin = atob(embedded.textContent.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      document.querySelectorAll('a[href$="hold-leuphana-accountable-report.pdf"]').forEach((a) => {
        a.href = blobUrl;
        if (a.hasAttribute('download')) a.setAttribute('download', 'hold-leuphana-accountable-report.pdf');
      });
      const v = document.querySelector('.viewer[data-pdf]');
      if (v) v.dataset.pdf = blobUrl;
    } catch (e) { /* fall back to the normal file */ }
  }

  /* ---------- Mobile menu ---------- */
  const toggle = document.getElementById('menuToggle');
  const nav = document.getElementById('mainNav');

  if (toggle && nav) {
    const close = () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('click', (event) => {
      if (!toggle.contains(event.target) && !nav.contains(event.target)) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 820) close();
    });
  }

  /* ---------- Report reader ---------- */
  const viewer = document.querySelector('.viewer[data-pdf]');
  if (viewer) initReader(viewer);

  /* ---------- Language switch (privacy policy) ---------- */
  const switcher = document.querySelector('.lang-switch');
  if (switcher) {
    const buttons = switcher.querySelectorAll('button[data-lang]');
    const sections = document.querySelectorAll('.legal[data-lang]');

    const show = (lang) => {
      sections.forEach((s) => { s.hidden = s.dataset.lang !== lang; });
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
      try { localStorage.setItem('privacy-lang', lang); } catch (e) { /* ignore */ }
      if (location.hash !== '#' + lang) history.replaceState(null, '', '#' + lang);
    };

    let start = 'en';
    if (location.hash === '#de' || location.hash === '#en') {
      start = location.hash.slice(1);
    } else {
      try { start = localStorage.getItem('privacy-lang') || start; } catch (e) { /* ignore */ }
    }

    buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.lang)));
    window.addEventListener('hashchange', () => {
      if (location.hash === '#de' || location.hash === '#en') show(location.hash.slice(1));
    });
    show(start);
  }

  /* ---------- Footer year ---------- */
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
}

// Works both on a normal page load and after StatiCrypt decrypts the page
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* Renders the PDF page by page into a scrollable box using the self-hosted
   PDF.js library. Works the same on phones and desktops. If the PDF is
   missing or can't be loaded, the cover card with the buttons stays visible. */
async function initReader(viewer) {
  const url = viewer.dataset.pdf;
  const scroller = viewer.querySelector('.viewer-scroll');
  const pagesEl = viewer.querySelector('.viewer-pages');
  const status = viewer.querySelector('.viewer-status');
  const pageLabel = viewer.querySelector('.viewer-page');
  const zoomIn = viewer.querySelector('[data-zoom="in"]');
  const zoomOut = viewer.querySelector('[data-zoom="out"]');

  const setStatus = (text) => { if (status) status.textContent = text; };

  let pdfjs;
  try {
    pdfjs = await import('./vendor/pdfjs/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;
  } catch (e) {
    setStatus('');
    return;
  }

  let doc;
  try {
    setStatus('Loading report…');
    doc = await pdfjs.getDocument({ url }).promise;
  } catch (e) {
    setStatus('');
    return;
  }

  const MIN = 0.6, MAX = 2.5, STEP = 0.2;
  let zoom = 1;
  const pages = [];

  // Build one placeholder per page with the right proportions
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const box = document.createElement('div');
    box.className = 'pdf-page';
    box.style.aspectRatio = `${vp.width} / ${vp.height}`;
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `Report page ${n} of ${doc.numPages}`);
    pagesEl.appendChild(box);
    pages.push({ n, page, box, rendered: 0, task: null });
  }

  viewer.classList.add('is-ready');

  const baseWidth = () => {
    const style = getComputedStyle(scroller);
    const inner = scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Math.min(inner, 900);
  };

  const applySize = () => {
    const w = Math.round(baseWidth() * zoom);
    pagesEl.style.setProperty('--page-w', w + 'px');
    // If zoomed wider than the box, align left so it can be scrolled sideways
    pagesEl.style.alignItems = w > scroller.clientWidth ? 'flex-start' : 'center';
  };

  const render = async (p) => {
    const cssWidth = p.box.clientWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const target = Math.round(cssWidth * dpr);
    if (!cssWidth || p.rendered === target) return;
    if (p.task) { p.task.cancel(); p.task = null; }

    const vp1 = p.page.getViewport({ scale: 1 });
    const vp = p.page.getViewport({ scale: target / vp1.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);

    p.task = p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    try {
      await p.task.promise;
      p.box.replaceChildren(canvas);
      p.rendered = target;
    } catch (e) { /* cancelled */ }
    p.task = null;
  };

  // Only render pages that are close to the visible area
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const p = pages.find((x) => x.box === entry.target);
      if (entry.isIntersecting) { visible.add(p); render(p); } else { visible.delete(p); }
    });
  }, { root: scroller, rootMargin: '800px 0px' });
  pages.forEach((p) => io.observe(p.box));

  const rerender = () => {
    applySize();
    visible.forEach((p) => render(p));
  };

  // Page counter
  const updateLabel = () => {
    const mid = scroller.scrollTop + scroller.clientHeight / 3;
    let current = 1;
    for (const p of pages) {
      if (p.box.offsetTop <= mid) current = p.n; else break;
    }
    if (pageLabel) pageLabel.textContent = `${current} / ${doc.numPages}`;
  };
  scroller.addEventListener('scroll', updateLabel, { passive: true });

  // Zoom, keeping the reading position
  const setZoom = (z) => {
    const ratio = scroller.scrollTop / Math.max(scroller.scrollHeight, 1);
    zoom = Math.min(MAX, Math.max(MIN, Math.round(z * 10) / 10));
    rerender();
    scroller.scrollTop = ratio * scroller.scrollHeight;
    if (zoomOut) zoomOut.disabled = zoom <= MIN;
    if (zoomIn) zoomIn.disabled = zoom >= MAX;
  };
  if (zoomIn) zoomIn.addEventListener('click', () => setZoom(zoom + STEP));
  if (zoomOut) zoomOut.addEventListener('click', () => setZoom(zoom - STEP));

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rerender, 150);
  });

  applySize();
  updateLabel();
}
