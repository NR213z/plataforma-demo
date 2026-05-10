// Modal de dibujo para remarcar errores sobre imágenes (con paso de comentario)

(function () {
  const modal = document.getElementById('draw-modal');
  const canvas = document.getElementById('draw-canvas');
  const canvasWrap = document.querySelector('.draw-canvas-wrap');
  const toolbar = document.querySelector('.draw-toolbar');
  const ctx = canvas.getContext('2d');
  const undoBtn = document.getElementById('draw-undo');
  const clearBtn = document.getElementById('draw-clear');
  const cancelBtn = document.getElementById('draw-cancel');
  const saveBtn = document.getElementById('draw-save');
  const sizeInput = document.getElementById('draw-size');
  const colorBtns = document.querySelectorAll('.draw-color');

  const composeStep = document.getElementById('draw-compose');
  const composeBack = document.getElementById('draw-compose-back');
  const composeCancel = document.getElementById('draw-compose-cancel');
  const composeSend = document.getElementById('draw-compose-send');
  const composeText = document.getElementById('draw-comment');
  const composePreview = document.getElementById('draw-preview');

  let bgImage = null;
  let strokes = [];
  let currentStroke = null;
  let isDrawing = false;
  let currentColor = '#dc2626';
  let currentSize = 5;
  let onSaveCallback = null;
  let lastBlob = null;

  function fitCanvasToImage(img) {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const maxW = window.innerWidth - 80;
    const maxH = window.innerHeight - 120;
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    canvas.style.width = (img.naturalWidth * ratio) + 'px';
    canvas.style.height = (img.naturalHeight * ratio) + 'px';
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgImage) ctx.drawImage(bgImage, 0, 0);
    strokes.forEach(stroke => {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
  }

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0].clientY);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing = true;
    currentStroke = {
      color: currentColor,
      size: currentSize * (canvas.width / canvas.getBoundingClientRect().width),
      points: [getCanvasPos(e)],
    };
    strokes.push(currentStroke);
    redraw();
  }

  function moveDraw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    currentStroke.points.push(getCanvasPos(e));
    redraw();
  }

  function endDraw() {
    isDrawing = false;
    currentStroke = null;
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw);

  undoBtn.addEventListener('click', () => {
    strokes.pop();
    redraw();
  });

  clearBtn.addEventListener('click', () => {
    if (strokes.length && !confirm('¿Borrar todas las marcas?')) return;
    strokes = [];
    redraw();
  });

  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentColor = btn.dataset.color;
    });
  });

  sizeInput.addEventListener('input', () => {
    currentSize = parseInt(sizeInput.value);
  });

  cancelBtn.addEventListener('click', () => closeDrawModal());

  // Paso 1 → paso 2: pasar a la pantalla de comentario
  saveBtn.addEventListener('click', () => {
    if (strokes.length === 0) {
      alert('No hay marcas para guardar');
      return;
    }
    canvas.toBlob((blob) => {
      lastBlob = blob;
      composePreview.src = URL.createObjectURL(blob);
      composeText.value = '';
      showComposeStep();
      setTimeout(() => composeText.focus(), 100);
    }, 'image/png');
  });

  // Volver al paso del dibujo
  composeBack.addEventListener('click', () => showDrawStep());

  // Cancelar todo desde el paso 2
  composeCancel.addEventListener('click', () => closeDrawModal());

  // Enviar definitivamente
  composeSend.addEventListener('click', () => {
    if (!lastBlob) return;
    const text = composeText.value.trim();
    composeSend.disabled = true;
    composeSend.textContent = 'Enviando...';
    if (onSaveCallback) {
      Promise.resolve(onSaveCallback(lastBlob, text))
        .finally(() => {
          composeSend.disabled = false;
          composeSend.textContent = 'Enviar comentario';
          closeDrawModal();
        });
    } else {
      closeDrawModal();
    }
  });

  function showComposeStep() {
    canvasWrap.style.display = 'none';
    toolbar.style.display = 'none';
    composeStep.classList.add('active');
  }

  function showDrawStep() {
    canvasWrap.style.display = '';
    toolbar.style.display = '';
    composeStep.classList.remove('active');
  }

  function closeDrawModal() {
    modal.classList.remove('active');
    strokes = [];
    bgImage = null;
    onSaveCallback = null;
    lastBlob = null;
    composeText.value = '';
    composePreview.src = '';
    showDrawStep();
  }

  window.openDrawModal = function (imgSrc, onSave) {
    onSaveCallback = onSave;
    strokes = [];
    showDrawStep();
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      bgImage = img;
      fitCanvasToImage(img);
      redraw();
      modal.classList.add('active');
    };
    img.onerror = () => alert('No se pudo cargar la imagen');
    img.src = imgSrc;
  };
})();
