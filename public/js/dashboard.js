const approvalsEl  = document.getElementById('approvals');
const emptyEl      = document.getElementById('empty');
const emptyTitle   = document.getElementById('empty-title');
const emptyMsg     = document.getElementById('empty-msg');
const countEl      = document.getElementById('count');
const toastsEl     = document.getElementById('toasts');
const categoryTabs = document.getElementById('category-tabs');
const detailModal  = document.getElementById('detail-modal');
const detailBody   = document.getElementById('detail-body');
const detailClose  = document.getElementById('detail-close');
const monthFilter  = document.getElementById('month-filter');
const clearMonth   = document.getElementById('clear-month');

let currentCategory = '';
let currentMonth    = '';
let currentView     = 'pending'; // 'pending' | 'mine'
let currentDetailId = null;
let currentSelection = null;
let myRole = '';

// ── Init: load user info ────────────────────────────────────────────────────
fetch('/api/me').then(r => r.json()).then(me => {
  myRole = me.role;
  document.getElementById('nav-user').textContent = `@${me.username}`;
  if (['moderador', 'administrador'].includes(me.role)) {
    document.getElementById('nav-admin').style.display = '';
  }
}).catch(() => {});

// ── View toggle ─────────────────────────────────────────────────────────────
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    approvalsEl.innerHTML = '';
    loadApprovals();
  });
});

// ── Category tabs ───────────────────────────────────────────────────────────
categoryTabs.addEventListener('click', e => {
  const btn = e.target.closest('.category-tab');
  if (!btn) return;
  document.querySelectorAll('.category-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = btn.dataset.category;
  approvalsEl.innerHTML = '';
  loadApprovals();
});

// ── Month filter ─────────────────────────────────────────────────────────────
monthFilter.addEventListener('change', () => {
  currentMonth = monthFilter.value;
  approvalsEl.innerHTML = '';
  loadApprovals();
});
clearMonth.addEventListener('click', () => {
  monthFilter.value = '';
  currentMonth = '';
  approvalsEl.innerHTML = '';
  loadApprovals();
});

// ── Load approvals ───────────────────────────────────────────────────────────
async function loadApprovals() {
  try {
    const params = new URLSearchParams();
    if (currentCategory) params.set('category', currentCategory);
    if (currentMonth)    params.set('month', currentMonth);

    const url = currentView === 'mine'
      ? `/api/approvals/mine?${params}`
      : `/api/approvals?${params}`;

    const res  = await fetch(url);
    const data = await res.json();
    renderList(data);
  } catch {
    showToast('Error al cargar solicitudes', 'error');
  }
}

function renderList(approvals) {
  countEl.textContent = approvals.length;

  const isEmpty = approvals.length === 0;
  emptyEl.style.display = isEmpty ? 'block' : 'none';
  if (isEmpty) {
    if (currentView === 'mine') {
      emptyTitle.textContent = 'Sin aprobaciones aún';
      emptyMsg.textContent   = 'Cuando apruebes algo aparecerá acá';
    } else {
      emptyTitle.textContent = 'Todo al día';
      emptyMsg.textContent   = 'No hay solicitudes pendientes';
    }
  }

  const existingIds = new Set(approvals.map(a => String(a.id)));
  document.querySelectorAll('.trello-card').forEach(card => {
    if (!existingIds.has(card.dataset.id)) {
      card.classList.add('fade-out');
      setTimeout(() => card.remove(), 300);
    }
  });

  approvals.forEach(a => {
    const existing = document.querySelector(`.trello-card[data-id="${a.id}"]`);
    if (existing) {
      const cc = existing.querySelector('.comment-count');
      if (cc) cc.textContent = a.comment_count || 0;
      return;
    }
    approvalsEl.appendChild(createCard(a));
  });
}

function createCard(a) {
  const card = document.createElement('div');
  card.className = 'trello-card';
  card.dataset.id = a.id;
  card.onclick = () => openDetail(a.id);

  const date     = new Date(a.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const catClass = (a.category || 'Web').toLowerCase();
  const imageCount = a.image_count || 3;
  const images = [a.image1, a.image2, a.image3].filter(Boolean);

  const thumbsHtml = images.length
    ? images.slice(0, 3).map(img => `<img src="/uploads/${img}" alt="" loading="lazy">`).join('')
    : `<div style="grid-column:span 3;height:90px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px;">Sin imágenes</div>`;

  const approvedBadge = currentView === 'mine' && a.approved_at
    ? `<span class="approved-date-badge">Aprobado ${new Date(a.approved_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>`
    : '';

  card.innerHTML = `
    <div class="trello-card-header">
      <span class="trello-card-title">${esc(a.title)}</span>
      <span class="category-badge ${catClass}">${esc(a.category || 'Web')}</span>
    </div>
    <div class="trello-card-thumbs">${thumbsHtml}</div>
    <div class="trello-card-footer">
      <div class="trello-card-meta">
        <span title="Comentarios">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="comment-count">${a.comment_count || 0}</span>
        </span>
        ${imageCount > 3 ? `<span title="${imageCount} páginas"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${imageCount} págs.</span>` : ''}
        ${approvedBadge}
      </div>
      <span>${date}</span>
    </div>
  `;
  return card;
}

// ── Detail modal ─────────────────────────────────────────────────────────────
async function openDetail(id) {
  currentDetailId  = id;
  currentSelection = null;
  detailBody.innerHTML = '<div style="padding:60px;text-align:center;color:#94a3b8">Cargando...</div>';
  detailModal.classList.add('active');

  try {
    const res  = await fetch(`/api/approvals/${id}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderDetail(data);
  } catch {
    showToast('Error al cargar el detalle', 'error');
    closeDetail();
  }
}

function renderDetail(a) {
  const date     = new Date(a.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const catClass = (a.category || 'Web').toLowerCase();
  const isPaged  = a.category === 'Diario';
  const images   = a.images || [a.image1, a.image2, a.image3].filter(Boolean);
  const isApproved = a.status === 'approved';

  const optionsHtml = images.map((filename, idx) => {
    const n     = idx + 1;
    const label = isPaged ? `Página ${n}` : `Opción ${n}`;
    const isSelected = isApproved && a.selected_option === n;
    return `
      <div class="detail-option${isSelected ? ' selected' : ''}" data-option="${n}" onclick="${isApproved ? '' : `selectDetailOption(${n})`}">
        <div class="detail-option-label">${label}${isSelected ? ' ✓' : ''}</div>
        <img class="detail-option-img" src="/uploads/${filename}" alt="${label}">
        <div class="detail-option-actions">
          <button onclick="event.stopPropagation(); openLightbox('/uploads/${filename}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
            Ver completa
          </button>
          <button onclick="event.stopPropagation(); downloadFile('/uploads/${filename}', '${filename}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Descargar
          </button>
          ${!isApproved ? `
          <button class="btn-mark" onclick="event.stopPropagation(); markOption('${filename}', ${n})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
            Remarcar
          </button>` : ''}
        </div>
        ${!isApproved ? `
        <label class="detail-option-radio" onclick="event.stopPropagation()">
          <input type="radio" name="detail-option" value="${n}" onchange="selectDetailOption(${n})">
          Seleccionar
        </label>` : ''}
      </div>
    `;
  }).join('');

  const approvedDateStr = a.approved_at
    ? new Date(a.approved_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const approvedInfo = isApproved
    ? `<div class="approved-info-bar">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
         Aprobado por <strong>${esc(a.approved_by_username || '—')}</strong>
         ${approvedDateStr ? `· ${approvedDateStr}` : ''}
       </div>`
    : '';

  detailBody.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">${esc(a.title)}</div>
      <div class="detail-meta">
        <span class="category-badge ${catClass}">${esc(a.category || 'Web')}</span>
        <span>·</span><span>Creada el ${date}</span>
        ${a.created_by_username ? `<span>· por <strong>${esc(a.created_by_username)}</strong></span>` : ''}
      </div>
    </div>

    ${approvedInfo}

    <div class="detail-options">${optionsHtml}</div>

    <div class="detail-comments">
      <div class="detail-comments-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Comentarios y revisiones
      </div>
      <div class="comments-list" id="comments-list">${renderComments(a.comments || [])}</div>
      <div class="comment-form">
        <textarea id="comment-text" placeholder="Escribí un comentario..."></textarea>
        <div class="comment-form-actions">
          <label class="comment-attach-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            Adjuntar
            <input type="file" id="comment-image" accept="image/*">
          </label>
          <span class="comment-attach-name" id="comment-attach-name"></span>
          <button class="comment-send-btn" id="comment-send" onclick="submitComment()">Enviar</button>
        </div>
      </div>
    </div>

    ${!isApproved ? `
    <div class="detail-footer">
      <button class="detail-approve-btn" id="detail-approve" disabled onclick="approveDetail()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        Aprobar selección
      </button>
    </div>` : ''}

    ${(isApproved || a.status === 'discarded') && ['moderador', 'administrador'].includes(myRole) ? `
    <div class="detail-footer">
      <button class="detail-reopen-btn" onclick="reopenDetail()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v6h6"/><path d="M3 8C5.5 4 10 2 15 3.5a9 9 0 1 1-8.9 10.6"/></svg>
        Volver a pendiente
      </button>
    </div>` : ''}
  `;

  const fileInput = document.getElementById('comment-image');
  const fileName  = document.getElementById('comment-attach-name');
  if (fileInput) fileInput.addEventListener('change', () => {
    fileName.textContent = fileInput.files[0] ? fileInput.files[0].name : '';
  });
}

function renderComments(comments) {
  if (!comments.length) {
    return '<div class="comments-empty">Sin comentarios aún.</div>';
  }
  return comments.map(c => {
    const date = new Date(c.created_at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const editedTag = c.updated_at ? `<span class="comment-edited"> · editado</span>` : '';
    const author = c.author_username ? `<span class="comment-author">@${esc(c.author_username)}</span> · ` : '';
    return `
      <div class="comment-item" data-comment-id="${c.id}">
        <div class="comment-header">
          <div class="comment-meta">${author}${date}${editedTag}</div>
          <div class="comment-actions">
            ${c.content ? `<button class="comment-action-btn" onclick="startEditComment(${c.id})" title="Editar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}
            <button class="comment-action-btn danger" onclick="deleteComment(${c.id})" title="Eliminar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
          </div>
        </div>
        <div class="comment-body">
          ${c.content ? `<div class="comment-content">${esc(c.content)}</div>` : ''}
          ${c.image ? `<img class="comment-image" src="/uploads/${c.image}" onclick="openLightbox('/uploads/${c.image}')">` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── Comment actions ───────────────────────────────────────────────────────────
window.startEditComment = function(id) {
  const item = document.querySelector(`.comment-item[data-comment-id="${id}"]`);
  if (!item) return;
  const body      = item.querySelector('.comment-body');
  const contentEl = item.querySelector('.comment-content');
  if (!contentEl) return;
  const original = contentEl.textContent;
  body.innerHTML = `
    <textarea class="comment-edit-textarea">${esc(original)}</textarea>
    <div class="comment-edit-actions">
      <button class="comment-edit-cancel">Cancelar</button>
      <button class="comment-edit-save">Guardar</button>
    </div>
    ${item.querySelector('.comment-image') ? item.querySelector('.comment-image').outerHTML : ''}
  `;
  const ta = body.querySelector('textarea');
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  body.querySelector('.comment-edit-cancel').onclick = () => reloadDetail();
  body.querySelector('.comment-edit-save').onclick = async () => {
    const newContent = ta.value.trim();
    if (!newContent) { showToast('El comentario no puede estar vacío', 'error'); return; }
    if (newContent === original) { reloadDetail(); return; }
    try {
      const res = await fetch(`/api/comments/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });
      if (!res.ok) throw new Error();
      showToast('Comentario actualizado', 'success');
      reloadDetail();
    } catch { showToast('Error al actualizar', 'error'); }
  };
};

window.deleteComment = async function(id) {
  if (!confirm('¿Eliminar este comentario?')) return;
  try {
    const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    showToast('Comentario eliminado', 'success');
    reloadDetail();
  } catch { showToast('Error al eliminar', 'error'); }
};

window.selectDetailOption = function(n) {
  currentSelection = n;
  document.querySelectorAll('.detail-option').forEach(el => {
    el.classList.toggle('selected', parseInt(el.dataset.option) === n);
  });
  const radio = document.querySelector(`input[name="detail-option"][value="${n}"]`);
  if (radio) radio.checked = true;
  const btn = document.getElementById('detail-approve');
  if (btn) btn.disabled = false;
};

window.markOption = function(imgFilename, optionNumber) {
  const isPaged = !!detailBody.querySelector('.detail-option-label')?.textContent.startsWith('Página');
  openDrawModal(`/uploads/${imgFilename}`, async (blob, commentText) => {
    const fd = new FormData();
    const defaultText = isPaged ? `Marca sobre Página ${optionNumber}` : `Marca sobre Opción ${optionNumber}`;
    fd.append('content', commentText?.trim() || defaultText);
    fd.append('image', blob, `marca-op${optionNumber}-${Date.now()}.png`);
    try {
      const res = await fetch(`/api/approvals/${currentDetailId}/comments`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error();
      showToast('Comentario con marca enviado', 'success');
      reloadDetail();
    } catch { showToast('Error al guardar la marca', 'error'); }
  });
};

window.submitComment = async function() {
  const text      = document.getElementById('comment-text').value.trim();
  const fileInput = document.getElementById('comment-image');
  const file      = fileInput?.files[0];
  if (!text && !file) { showToast('Escribí un comentario o adjuntá una imagen', 'error'); return; }

  const sendBtn = document.getElementById('comment-send');
  sendBtn.disabled = true; sendBtn.textContent = 'Enviando...';

  const fd = new FormData();
  if (text) fd.append('content', text);
  if (file) fd.append('image', file);

  try {
    const res = await fetch(`/api/approvals/${currentDetailId}/comments`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error();
    document.getElementById('comment-text').value = '';
    if (fileInput) { fileInput.value = ''; }
    document.getElementById('comment-attach-name').textContent = '';
    showToast('Comentario agregado', 'success');
    reloadDetail();
  } catch { showToast('Error al enviar', 'error'); }
  finally { sendBtn.disabled = false; sendBtn.textContent = 'Enviar'; }
};

window.approveDetail = async function() {
  if (!currentSelection) return;
  const btn = document.getElementById('detail-approve');
  btn.disabled = true; btn.textContent = 'Aprobando...';
  try {
    const res = await fetch(`/api/approvals/${currentDetailId}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedOption: currentSelection }),
    });
    if (!res.ok) throw new Error();
    showToast('Aprobado correctamente', 'success');
    closeDetail();
    loadApprovals();
  } catch {
    showToast('Error al aprobar', 'error');
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Aprobar selección';
  }
};

window.reopenDetail = async function() {
  if (!confirm('¿Volver a poner esta solicitud en pendiente? Se quitará la aprobación actual.')) return;
  try {
    const res = await fetch(`/api/approvals/${currentDetailId}/reopen`, { method: 'PUT' });
    if (!res.ok) throw new Error();
    showToast('Solicitud re-abierta', 'success');
    closeDetail();
    loadApprovals();
  } catch { showToast('Error al re-abrir', 'error'); }
};

// Download helper
window.downloadFile = function(src, filename) {
  fetch(`/api/download/${filename.split('/').pop()}`)
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename.split('/').pop();
      a.click();
    }).catch(() => showToast('Error al descargar', 'error'));
};

async function reloadDetail() {
  if (!currentDetailId) return;
  try {
    const res = await fetch(`/api/approvals/${currentDetailId}/comments`);
    const comments = await res.json();
    const list = document.getElementById('comments-list');
    if (list) list.innerHTML = renderComments(comments);
    const card = document.querySelector(`.trello-card[data-id="${currentDetailId}"] .comment-count`);
    if (card) card.textContent = comments.length;
  } catch { /* ignore */ }
}

function closeDetail() {
  detailModal.classList.remove('active');
  currentDetailId  = null;
  currentSelection = null;
  detailBody.innerHTML = '';
}

detailClose.addEventListener('click', closeDetail);
detailModal.addEventListener('click', e => { if (e.target === detailModal) closeDetail(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && detailModal.classList.contains('active')) {
    if (document.getElementById('lightbox').classList.contains('active')) return;
    if (document.getElementById('draw-modal').classList.contains('active')) return;
    closeDetail();
  }
});

// ── Update lightbox download button ─────────────────────────────────────────
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

// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    ${type === 'success'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'}
    ${message}`;
  toastsEl.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

loadApprovals();
setInterval(loadApprovals, 30000);
