// Lightbox con zoom y pan compartido entre dashboard y admin

(function () {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.getElementById('lightbox-close');
  const zoomLevel = document.getElementById('lightbox-zoom-level');

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let zoomHideTimer = null;

  function applyTransform(animated) {
    lightboxImg.style.transition = animated ? 'transform 0.2s ease' : 'none';
    lightboxImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    lightboxImg.classList.toggle('zoomed', scale > 1);
  }

  function showZoomLevel() {
    zoomLevel.textContent = Math.round(scale * 100) + '%';
    zoomLevel.classList.add('visible');
    clearTimeout(zoomHideTimer);
    zoomHideTimer = setTimeout(() => zoomLevel.classList.remove('visible'), 1200);
  }

  function resetZoom(animated) {
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyTransform(animated);
    zoomLevel.classList.remove('visible');
  }

  function clampTranslate() {
    // Limita el pan para que la imagen no se aleje demasiado
    const maxPan = 400 * (scale - 1);
    translateX = Math.max(-maxPan, Math.min(maxPan, translateX));
    translateY = Math.max(-maxPan, Math.min(maxPan, translateY));
  }

  // Zoom con scroll
  lightbox.addEventListener('wheel', (e) => {
    e.preventDefault();

    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    const newScale = Math.min(Math.max(scale + delta * scale, 1), 6);

    if (newScale === 1) {
      resetZoom(false);
    } else {
      // Zoom hacia la posición del cursor
      const rect = lightboxImg.getBoundingClientRect();
      const imgCenterX = rect.left + rect.width / 2;
      const imgCenterY = rect.top + rect.height / 2;
      const mouseX = e.clientX - imgCenterX;
      const mouseY = e.clientY - imgCenterY;

      const ratio = newScale / scale;
      translateX = mouseX - ratio * (mouseX - translateX);
      translateY = mouseY - ratio * (mouseY - translateY);
      scale = newScale;
      clampTranslate();
      applyTransform(false);
    }

    showZoomLevel();
  }, { passive: false });

  // Doble clic para resetear
  lightboxImg.addEventListener('dblclick', () => {
    resetZoom(true);
    showZoomLevel();
  });

  // Drag para mover
  lightboxImg.addEventListener('mousedown', (e) => {
    if (scale <= 1) return;
    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX - translateX;
    dragStartY = e.clientY - translateY;
    lightboxImg.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = e.clientX - dragStartX;
    translateY = e.clientY - dragStartY;
    clampTranslate();
    applyTransform(false);
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    lightboxImg.classList.remove('dragging');
  });

  // Touch: pinch-to-zoom
  let lastTouchDist = null;
  let lastTouchMidX = 0;
  let lastTouchMidY = 0;

  lightbox.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      lastTouchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastTouchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  }, { passive: true });

  lightbox.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !lastTouchDist) return;
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[1].clientX - e.touches[0].clientX,
      e.touches[1].clientY - e.touches[0].clientY
    );
    const ratio = dist / lastTouchDist;
    const newScale = Math.min(Math.max(scale * ratio, 1), 6);
    scale = newScale;
    lastTouchDist = dist;
    clampTranslate();
    applyTransform(false);
    showZoomLevel();
  }, { passive: false });

  lightbox.addEventListener('touchend', () => { lastTouchDist = null; });

  // Abrir lightbox
  window.openLightbox = function (src) {
    lightboxImg.src = src;
    resetZoom(false);
    lightbox.classList.add('active');
  };

  // Cerrar lightbox
  function closeLightbox() {
    lightbox.classList.remove('active');
    setTimeout(() => resetZoom(false), 200);
  }

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  lightboxClose.addEventListener('click', closeLightbox);

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === '0') resetZoom(true);
  });
})();
