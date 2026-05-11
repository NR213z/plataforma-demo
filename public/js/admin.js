// ── DOM refs ──────────────────────────────────────────────────────────────────
const form          = document.getElementById('create-form');
const tableBody     = document.getElementById('table-body');
const tableEmpty    = document.getElementById('table-empty');
const toastsEl      = document.getElementById('toasts');
const btnCreate     = document.getElementById('btn-create');
const btnCleanup    = document.getElementById('btn-cleanup');
const categorySelect = document.getElementById('category');
const addOptionWrap = document.getElementById('add-option-wrap');
const extraOptionsEl = document.getElementById('extra-options');
const pdfLoaderWrap = document.getElementById('pdf-loader-wrap');
const pdfFileInput  = document.getElementById('pdf-file-input');
const cleanupBar    = document.getElementById('cleanup-bar');

// ── State ─────────────────────────────────────────────────────────────────────
let currentFilter   = 'all';
let currentCategory = '';
let currentMonth    = '';
let myRole          = 'moderador';
let extraCount      = 3;

// PDF picker state
let pdfDoc           = null;
let pdfSelectedPages = new Set();

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
async function init() {
  try {
    const res = await fetch('/api/me');
    const me  = await res.json();
    myRole = me.role;
    document.getElementById('nav-user').textContent = me.username;

    if (myRole === 'administrador') {
      document.getElementById('tab-users').style.display = '';
      cleanupBar.style.display = 'flex';
      loadUsers();
    }
  } catch (e) { /* ignore */ }

  setupTabs();
  setupFilters();
  setupForm();
  setupFileUploads();
  setupPdfLoader();
  loadAll();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════════════════════
function setupTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-panel').forEach(p => p.style.display = 'none');
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).style.display = '';
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════════════════════════
function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      loadAll();
    });
  });

  document.getElementById('filter-category').addEventListener('change', e => {
    currentCategory = e.target.value;
    loadAll();
  });

  const monthInput = document.getElementById('admin-month-filter');
  monthInput.addEventListener('change', () => { currentMonth = monthInput.value; loadAll(); });
  document.getElementById('admin-clear-month').addEventListener('click', () => {
    monthInput.value = ''; currentMonth = ''; loadAll();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE UPLOADS (base 3 slots)
// ═══════════════════════════════════════════════════════════════════════════════
function setupFileUploads() {
  [1, 2, 3].forEach(n => {
    const input   = document.getElementById(`file${n}`);
    const preview = document.getElementById(`preview${n}`);
    const drop    = document.getElementById(`drop${n}`);

    input.addEventListener('change', () => handleFileChange(input, preview, drop));

    drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) {
        const dt = new DataTransfer();
        dt.items.add(e.dataTransfer.files[0]);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
      }
    });
  });
}

function handleFileChange(input, preview, drop) {
  if (!input.files[0]) return;
  const file = input.files[0];
  if (file.type !== 'application/pdf') {
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }
  drop.classList.add('has-file');
  drop.querySelector('.file-upload-text').innerHTML = `<strong>${file.name}</strong>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM SETUP
// ═══════════════════════════════════════════════════════════════════════════════
function setupForm() {
  categorySelect.addEventListener('change', onCategoryChange);
  document.getElementById('btn-add-option').addEventListener('click', () => addExtraOption());
  form.addEventListener('submit', async e => { e.preventDefault(); await submitForm(); });

  btnCleanup.addEventListener('click', async () => {
    if (!confirm('¿Eliminar todas las aprobaciones con más de 30 días? Esta acción no se puede deshacer.')) return;
    try {
      const res  = await fetch('/api/cleanup', { method: 'POST' });
      const data = await res.json();
      showToast(data.message, 'success');
      loadAll();
    } catch { showToast('Error al ejecutar limpieza', 'error'); }
  });
}

function onCategoryChange() {
  const isDiario = categorySelect.value === 'Diario';
  const labels   = isDiario
    ? ['Página 1', 'Página 2', 'Página 3']
    : ['Opción 1', 'Opción 2', 'Opción 3'];

  [1, 2, 3].forEach((n, i) => {
    const lbl = document.getElementById(`option-label-${n}`);
    if (lbl) lbl.textContent = labels[i];
  });

  addOptionWrap.style.display  = isDiario ? 'block' : 'none';
  pdfLoaderWrap.style.display  = isDiario ? 'block' : 'none';

  if (!isDiario) {
    extraOptionsEl.innerHTML = '';
    extraCount = 3;
  }
}

// ── Add extra page ─────────────────────────────────────────────────────────────
function addExtraOption(preloadedFile = null) {
  extraCount++;
  const n = extraCount;

  const group = document.createElement('div');
  group.className = 'form-group';
  group.dataset.extraIndex = n;
  group.innerHTML = `
    <div class="extra-label-row">
      <label class="form-label">Página ${n}</label>
      <button type="button" class="btn-remove-extra">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Quitar
      </button>
    </div>
    <div class="file-upload extra-drop">
      <input type="file" accept="image/*,application/pdf" class="extra-file-input">
      <div class="file-upload-text"><strong>Seleccionar imagen</strong><br>o arrastra aquí</div>
      <img class="file-upload-preview" alt="" style="display:none">
    </div>
  `;
  extraOptionsEl.appendChild(group);

  const input   = group.querySelector('.extra-file-input');
  const preview = group.querySelector('.file-upload-preview');
  const drop    = group.querySelector('.file-upload');

  if (preloadedFile) {
    const dt = new DataTransfer();
    dt.items.add(preloadedFile);
    input.files = dt.files;
    preview.src = URL.createObjectURL(preloadedFile);
    preview.style.display = 'block';
    drop.classList.add('has-file');
    drop.querySelector('.file-upload-text').innerHTML = `<strong>${preloadedFile.name}</strong>`;
  }

  input.addEventListener('change', () => handleFileChange(input, preview, drop));

  group.querySelector('.btn-remove-extra').addEventListener('click', () => {
    group.remove();
    renumberExtraPages();
  });
}

function renumberExtraPages() {
  const groups = extraOptionsEl.querySelectorAll('.form-group');
  groups.forEach((g, i) => {
    const lbl = g.querySelector('.form-label');
    if (lbl) lbl.textContent = `Página ${i + 4}`;
  });
  extraCount = 3 + groups.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF LOADER
// ═══════════════════════════════════════════════════════════════════════════════
function setupPdfLoader() {
  pdfFileInput.addEventListener('change', async () => {
    if (!pdfFileInput.files[0]) return;
    await openPdfPicker(pdfFileInput.files[0]);
    pdfFileInput.value = '';
  });
}

async function openPdfPicker(file) {
  if (typeof pdfjsLib === 'undefined') {
    showToast('PDF.js no cargó correctamente', 'error');
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const grid  = document.getElementById('pdf-pages-grid');
  const modal = document.getElementById('pdf-modal');

  grid.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;grid-column:1/-1;padding:40px 0">Cargando páginas…</p>';
  modal.style.display = '';
  pdfSelectedPages = new Set();
  document.getElementById('pdf-selected-count').textContent = '0 páginas seleccionadas';

  try {
    const buf = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    const total = pdfDoc.numPages;

    grid.innerHTML = '';
    for (let i = 1; i <= total; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-thumb';
      wrapper.dataset.page = i;
      wrapper.innerHTML = `
        <canvas class="pdf-thumb-canvas"></canvas>
        <div class="pdf-page-num">Pág. ${i}</div>
        <div class="pdf-page-check">✓</div>
      `;
      grid.appendChild(wrapper);
      renderPdfThumb(i, wrapper.querySelector('canvas'));

      wrapper.addEventListener('click', () => {
        if (pdfSelectedPages.has(i)) {
          pdfSelectedPages.delete(i);
          wrapper.classList.remove('selected');
        } else {
          pdfSelectedPages.add(i);
          wrapper.classList.add('selected');
        }
        const n = pdfSelectedPages.size;
        document.getElementById('pdf-selected-count').textContent =
          `${n} página${n !== 1 ? 's' : ''} seleccionada${n !== 1 ? 's' : ''}`;
      });
    }
  } catch (err) {
    showToast('Error al leer el PDF: ' + err.message, 'error');
    modal.style.display = 'none';
  }
}

async function renderPdfThumb(pageNum, canvas) {
  try {
    const page     = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.28 });
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  } catch { /* ignore */ }
}

async function renderPageHighRes(pageNum) {
  const page     = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

window.confirmPdfPages = async function () {
  if (pdfSelectedPages.size === 0) {
    showToast('Seleccioná al menos una página', 'error');
    return;
  }

  const btn = document.getElementById('pdf-confirm-btn');
  btn.disabled    = true;
  btn.textContent = 'Procesando…';

  try {
    const sorted = [...pdfSelectedPages].sort((a, b) => a - b);

    // Fill base slots 1-3 first, rest go to extra pages
    let baseIdx = 0;
    for (const pageNum of sorted) {
      const canvas = await renderPageHighRes(pageNum);
      const blob   = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const file   = new File([blob], `pagina-${pageNum}.png`, { type: 'image/png' });

      if (baseIdx < 3) {
        const n       = baseIdx + 1;
        const input   = document.getElementById(`file${n}`);
        const preview = document.getElementById(`preview${n}`);
        const drop    = document.getElementById(`drop${n}`);
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
        drop.classList.add('has-file');
        drop.querySelector('.file-upload-text').innerHTML = `<strong>Página ${pageNum}</strong>`;
        baseIdx++;
      } else {
        addExtraOption(file);
      }
    }

    document.getElementById('pdf-modal').style.display = 'none';
    showToast(`${sorted.length} página${sorted.length !== 1 ? 's' : ''} agregada${sorted.length !== 1 ? 's' : ''}`, 'success');
  } catch (err) {
    showToast('Error al procesar: ' + err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Agregar páginas';
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// FORM SUBMIT
// ═══════════════════════════════════════════════════════════════════════════════
async function submitForm() {
  btnCreate.disabled    = true;
  btnCreate.textContent = 'Creando…';

  const allFiles = [];
  [1, 2, 3].forEach(n => {
    const f = document.getElementById(`file${n}`).files[0];
    if (f) allFiles.push(f);
  });
  document.querySelectorAll('.extra-file-input').forEach(inp => {
    if (inp.files[0]) allFiles.push(inp.files[0]);
  });

  const fd = new FormData();
  fd.append('title',    document.getElementById('title').value.trim() || 'Sin título');
  fd.append('category', categorySelect.value);
  allFiles.forEach(f => fd.append('images', f));

  try {
    const res = await fetch('/api/approvals', { method: 'POST', body: fd });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error al crear'); }
    showToast('Solicitud creada exitosamente', 'success');
    resetForm();
    loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btnCreate.disabled    = false;
    btnCreate.textContent = 'Crear solicitud';
  }
}

function resetForm() {
  form.reset();
  categorySelect.value = 'Web';
  [1, 2, 3].forEach(n => {
    document.getElementById(`preview${n}`).style.display = 'none';
    const drop = document.getElementById(`drop${n}`);
    drop.classList.remove('has-file');
    drop.querySelector('.file-upload-text').innerHTML = '<strong>Seleccionar imagen</strong><br>o arrastra aquí';
    const lbl = document.getElementById(`option-label-${n}`);
    if (lbl) lbl.textContent = `Opción ${n}`;
  });
  extraOptionsEl.innerHTML = '';
  extraCount = 3;
  addOptionWrap.style.display  = 'none';
  pdfLoaderWrap.style.display  = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD & RENDER APPROVALS
// ═══════════════════════════════════════════════════════════════════════════════
async function loadAll() {
  try {
    const params = new URLSearchParams();
    if (currentFilter && currentFilter !== 'all') params.set('status', currentFilter);
    if (currentCategory) params.set('category', currentCategory);
    if (currentMonth)    params.set('month',    currentMonth);

    const res  = await fetch(`/api/approvals/all?${params}`);
    const data = await res.json();
    renderTable(data);
  } catch { showToast('Error al cargar datos', 'error'); }
}

function renderTable(data) {
  tableEmpty.style.display = data.length === 0 ? 'block' : 'none';

  const statusLabels = { pending: 'Pendiente', approved: 'Aprobada', discarded: 'Descartada' };

  tableBody.innerHTML = data.map(a => {
    const date    = new Date(a.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    const cat     = a.category || 'Web';
    const catKey  = cat === 'Gráfica' ? 'grafica' : cat.toLowerCase();
    const isDiario = cat === 'Diario';

    const selLabel   = a.selected_option ? (isDiario ? 'Página ' : 'Opción ') + a.selected_option : '—';
    const approvedBy = a.approved_by_username
      ? `<span class="approved-by-tag">${esc(a.approved_by_username)}</span>` : '—';

    // Build thumbnails from images array or fallback to image1/2/3
    const imgs = Array.isArray(a.images) && a.images.length > 0
      ? a.images
      : [a.image1, a.image2, a.image3].filter(Boolean);

    const thumbs = imgs.slice(0, 3)
      .map(img => `<img src="/uploads/${img}" alt="" onclick="openLightbox('/uploads/${img}')" style="cursor:pointer" onerror="this.style.display='none'">`)
      .join('');
    const totalImgs = a.image_count || imgs.length;
    const extra = totalImgs > 3 ? `<span class="thumb-more">+${totalImgs - 3}</span>` : '';

    const canDelete  = myRole === 'administrador';
    const isPending  = a.status === 'pending';

    return `
      <tr>
        <td>
          <strong>${esc(a.title)}</strong>
          ${a.created_by_username ? `<br><span style="font-size:11px;color:var(--text-muted)">${esc(a.created_by_username)}</span>` : ''}
        </td>
        <td><span class="category-badge ${catKey}">${esc(cat)}</span></td>
        <td><div class="thumb-group">${thumbs}${extra}</div></td>
        <td><span class="status-badge ${a.status}">${statusLabels[a.status] || a.status}</span></td>
        <td>${selLabel}</td>
        <td>${approvedBy}</td>
        <td>${a.comment_count || 0}</td>
        <td>${date}</td>
        <td>
          <div class="table-actions">
            ${isPending ? `
              <button class="btn-icon warning" onclick="discardItem(${a.id})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                Descartar
              </button>` : ''}
            ${canDelete ? `
              <button class="btn-icon danger" onclick="deleteItem(${a.id})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                Eliminar
              </button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════
async function discardItem(id) {
  if (!confirm('¿Descartar esta solicitud? Se quitará del panel de aprobaciones.')) return;
  try {
    const res = await fetch(`/api/approvals/${id}/discard`, { method: 'PUT' });
    if (!res.ok) throw new Error();
    showToast('Solicitud descartada', 'success');
    loadAll();
  } catch { showToast('Error al descartar', 'error'); }
}

async function deleteItem(id) {
  if (!confirm('¿Eliminar permanentemente? Se borrarán también las imágenes.')) return;
  try {
    const res = await fetch(`/api/approvals/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    showToast('Eliminado correctamente', 'success');
    loadAll();
  } catch { showToast('Error al eliminar', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
async function loadUsers() {
  try {
    const res   = await fetch('/api/users');
    const users = await res.json();
    renderUsers(users);
  } catch { /* no access */ }
}

function renderUsers(users) {
  const tbody = document.getElementById('users-table-body');
  const empty = document.getElementById('users-empty');
  empty.style.display = users.length === 0 ? 'block' : 'none';

  const roleLabel = { usuario: 'Usuario', moderador: 'Moderador', administrador: 'Administrador' };
  const roleClass = { usuario: 'role-user', moderador: 'role-mod', administrador: 'role-admin' };

  tbody.innerHTML = users.map(u => {
    const date = new Date(u.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    return `
      <tr>
        <td><strong>${esc(u.username)}</strong></td>
        <td><span class="role-badge ${roleClass[u.role] || ''}">${roleLabel[u.role] || u.role}</span></td>
        <td>${date}</td>
        <td>
          <div class="table-actions">
            <button class="btn-icon danger" onclick="deleteUser(${u.id}, '${esc(u.username)}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              Eliminar
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('user-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value;
  const role     = document.getElementById('new-role').value;

  if (!username || !password) { showToast('Usuario y contraseña requeridos', 'error'); return; }

  const btn = document.getElementById('btn-create-user');
  btn.disabled    = true;
  btn.textContent = 'Creando…';

  try {
    const res  = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear usuario');
    showToast('Usuario creado exitosamente', 'success');
    document.getElementById('user-form').reset();
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Crear usuario';
  }
});

async function deleteUser(id, username) {
  if (!confirm(`¿Eliminar al usuario "${username}"? Esta acción no se puede deshacer.`)) return;
  try {
    const res  = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Usuario eliminado', 'success');
    loadUsers();
  } catch (err) { showToast(err.message || 'Error al eliminar', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════════════
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  toast.innerHTML = `${icon} ${message}`;
  toastsEl.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 3500);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// Expose to inline onclick handlers
window.discardItem = discardItem;
window.deleteItem  = deleteItem;
window.deleteUser  = deleteUser;

// ── Lightbox download button ───────────────────────────────────────────────────
const _origOpenLightbox = window.openLightbox;
window.openLightbox = function(src) {
  _origOpenLightbox(src);
  const dlBtn = document.getElementById('lightbox-download');
  if (dlBtn) {
    const filename = src.split('/').pop();
    dlBtn.href = `/api/download/${filename}`;
    dlBtn.download = filename;
  }
};

// ── Start ─────────────────────────────────────────────────────────────────────
init();
