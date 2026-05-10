const form = document.getElementById('create-form');
const tableBody = document.getElementById('table-body');
const tableEmpty = document.getElementById('table-empty');
const toastsEl = document.getElementById('toasts');
const btnCreate = document.getElementById('btn-create');
const btnCleanup = document.getElementById('btn-cleanup');
const categorySelect = document.getElementById('category');
const addOptionWrap = document.getElementById('add-option-wrap');
const extraOptionsEl = document.getElementById('extra-options');

let currentFilter = 'all';
let allData = [];
let extraCount = 3;

// File upload previews for the 3 base inputs
[1, 2, 3].forEach(n => {
  const input = document.getElementById(`file${n}`);
  const preview = document.getElementById(`preview${n}`);
  const drop = document.getElementById(`drop${n}`);

  input.addEventListener('change', () => {
    if (input.files[0]) {
      const url = URL.createObjectURL(input.files[0]);
      preview.src = url;
      preview.style.display = 'block';
      drop.classList.add('has-file');
      drop.querySelector('.file-upload-text').innerHTML = `<strong>${input.files[0].name}</strong>`;
    }
  });
});

// Category change → show/hide Diario extras and relabel
categorySelect.addEventListener('change', () => {
  const isDiario = categorySelect.value === 'Diario';

  // Relabel base options
  const labels = isDiario
    ? ['Página 1', 'Página 2', 'Página 3']
    : ['Opción 1', 'Opción 2', 'Opción 3'];
  [1, 2, 3].forEach((n, i) => {
    const lbl = document.getElementById(`option-label-${n}`);
    if (lbl) lbl.textContent = labels[i];
  });

  if (isDiario) {
    addOptionWrap.style.display = 'block';
  } else {
    addOptionWrap.style.display = 'none';
    extraOptionsEl.innerHTML = '';
    extraCount = 3;
  }
});

// Add extra page button
document.getElementById('btn-add-option').addEventListener('click', addExtraOption);

function addExtraOption() {
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
      <input type="file" accept="image/*" class="extra-file-input">
      <div class="file-upload-text"><strong>Seleccionar imagen</strong><br>o arrastra aquí</div>
      <img class="file-upload-preview" alt="" style="display:none">
    </div>
  `;

  extraOptionsEl.appendChild(group);

  const input = group.querySelector('input[type="file"]');
  const preview = group.querySelector('.file-upload-preview');
  const drop = group.querySelector('.file-upload');

  input.addEventListener('change', () => {
    if (input.files[0]) {
      preview.src = URL.createObjectURL(input.files[0]);
      preview.style.display = 'block';
      drop.classList.add('has-file');
      drop.querySelector('.file-upload-text').innerHTML = `<strong>${input.files[0].name}</strong>`;
    }
  });

  group.querySelector('.btn-remove-extra').addEventListener('click', () => {
    group.remove();
  });
}

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

// Create form submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = document.getElementById('title').value.trim();
  const category = categorySelect.value;
  const file1 = document.getElementById('file1').files[0];
  const file2 = document.getElementById('file2').files[0];
  const file3 = document.getElementById('file3').files[0];

  if (!title || !file1 || !file2 || !file3) {
    showToast('Completa todos los campos', 'error');
    return;
  }

  // Collect all files in order
  const allFiles = [file1, file2, file3];
  document.querySelectorAll('.extra-file-input').forEach(input => {
    if (input.files[0]) allFiles.push(input.files[0]);
  });

  btnCreate.disabled = true;
  btnCreate.textContent = 'Creando...';

  const fd = new FormData();
  fd.append('title', title);
  fd.append('category', category);
  allFiles.forEach(f => fd.append('images', f));

  try {
    const res = await fetch('/api/approvals', { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error al crear');
    }

    showToast('Solicitud creada exitosamente', 'success');
    form.reset();
    categorySelect.value = 'Web';

    // Reset base previews and labels
    [1, 2, 3].forEach(n => {
      document.getElementById(`preview${n}`).style.display = 'none';
      document.getElementById(`drop${n}`).classList.remove('has-file');
      document.getElementById(`drop${n}`).querySelector('.file-upload-text').innerHTML =
        '<strong>Seleccionar imagen</strong><br>o arrastra aquí';
      const lbl = document.getElementById(`option-label-${n}`);
      if (lbl) lbl.textContent = `Opción ${n}`;
    });

    // Reset extra pages
    extraOptionsEl.innerHTML = '';
    extraCount = 3;
    addOptionWrap.style.display = 'none';

    loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btnCreate.disabled = false;
    btnCreate.textContent = 'Crear solicitud';
  }
});

// Cleanup
btnCleanup.addEventListener('click', async () => {
  if (!confirm('¿Eliminar todas las aprobaciones con más de 7 días? Esta acción no se puede deshacer.')) return;

  try {
    const res = await fetch('/api/cleanup', { method: 'POST' });
    const data = await res.json();
    showToast(data.message, 'success');
    loadAll();
  } catch (err) {
    showToast('Error al ejecutar limpieza', 'error');
  }
});

async function loadAll() {
  try {
    const res = await fetch('/api/approvals/all');
    allData = await res.json();
    renderTable();
  } catch (err) {
    showToast('Error al cargar datos', 'error');
  }
}

function renderTable() {
  const filtered = currentFilter === 'all'
    ? allData
    : allData.filter(a => a.status === currentFilter);

  tableEmpty.style.display = filtered.length === 0 ? 'block' : 'none';

  tableBody.innerHTML = filtered.map(a => {
    const date = new Date(a.created_at).toLocaleDateString('es-ES', {
      day: 'numeric', month: 'short', year: 'numeric'
    });

    const statusLabels = { pending: 'Pendiente', approved: 'Aprobada', discarded: 'Descartada' };

    const cat = a.category || 'Web';
    const catClass = cat.toLowerCase();
    const imageCount = a.image_count || 3;
    const isDiario = cat === 'Diario';

    const selectionLabel = a.selected_option
      ? (isDiario ? 'Página ' : 'Opción ') + a.selected_option
      : '—';

    return `
      <tr>
        <td><strong>${esc(a.title)}</strong></td>
        <td><span class="category-badge ${catClass}">${esc(cat)}</span></td>
        <td>
          <div class="thumb-group">
            <img src="/uploads/${a.image1}" alt="" onclick="openLightbox('/uploads/${a.image1}')" style="cursor:pointer">
            <img src="/uploads/${a.image2}" alt="" onclick="openLightbox('/uploads/${a.image2}')" style="cursor:pointer">
            <img src="/uploads/${a.image3}" alt="" onclick="openLightbox('/uploads/${a.image3}')" style="cursor:pointer">
            ${imageCount > 3 ? `<span class="thumb-more">+${imageCount - 3}</span>` : ''}
          </div>
        </td>
        <td><span class="status-badge ${a.status}">${statusLabels[a.status]}</span></td>
        <td>${selectionLabel}</td>
        <td>${a.comment_count || 0}</td>
        <td>${date}</td>
        <td>
          <div class="table-actions">
            ${a.status === 'pending' ? `
              <button class="btn-icon warning" onclick="discardItem(${a.id})" title="Descartar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                Descartar
              </button>
            ` : ''}
            <button class="btn-icon danger" onclick="deleteItem(${a.id})" title="Eliminar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Eliminar
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function discardItem(id) {
  if (!confirm('¿Descartar esta solicitud? Se quitará del panel de aprobaciones.')) return;

  try {
    const res = await fetch(`/api/approvals/${id}/discard`, { method: 'PUT' });
    if (!res.ok) throw new Error();
    showToast('Solicitud descartada', 'success');
    loadAll();
  } catch {
    showToast('Error al descartar', 'error');
  }
}

async function deleteItem(id) {
  if (!confirm('¿Eliminar permanentemente? Se borrarán también las imágenes.')) return;

  try {
    const res = await fetch(`/api/approvals/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    showToast('Eliminado correctamente', 'success');
    loadAll();
  } catch {
    showToast('Error al eliminar', 'error');
  }
}

// lightbox manejado por lightbox.js

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    ${type === 'success' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'}
    ${message}
  `;
  toastsEl.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

loadAll();
