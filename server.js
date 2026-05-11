require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const bcrypt  = require('bcryptjs');
const db      = require('./db');
const { initEmail, notifyApproval, notifyComment } = require('./notifications');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Uploads ────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB (PDFs can be large)
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp|svg|pdf)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 días
}));

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  if (req.accepts('html')) return res.redirect('/login');
  res.status(401).json({ error: 'No autenticado' });
}

function requireModerador(req, res, next) {
  if (['moderador', 'administrador'].includes(req.session?.role)) return next();
  if (req.accepts('html')) return res.redirect('/');
  res.status(403).json({ error: 'Sin permisos' });
}

function requireAdmin(req, res, next) {
  if (req.session?.role === 'administrador') return next();
  if (req.accepts('html')) return res.redirect('/');
  res.status(403).json({ error: 'Sin permisos' });
}

// ── Auth routes ────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.redirect('/login?error=1');
  }
  req.session.userId   = user.id;
  req.session.username = user.username;
  req.session.role     = user.role;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Backward compat
app.get('/admin/login', (req, res) => res.redirect('/login'));
app.post('/admin/login', (req, res) => res.redirect('/login'));
app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Pages ──────────────────────────────────────────────────────────────────

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin', requireAuth, requireModerador, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── API: current user ──────────────────────────────────────────────────────

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.session.userId, username: req.session.username, role: req.session.role });
});

// ── API: users (admin only) ────────────────────────────────────────────────

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.getUsers());
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  if (!db.VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  try {
    const hashed = bcrypt.hashSync(password, 10);
    const result = db.createUser(username, hashed, role);
    res.json({ id: result.lastInsertRowid, message: 'Usuario creado' });
  } catch (e) {
    res.status(400).json({ error: 'El usuario ya existe' });
  }
});

app.put('/api/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Contraseña requerida' });
  const hashed = bcrypt.hashSync(password, 10);
  db.updateUserPassword(req.params.id, hashed);
  res.json({ message: 'Contraseña actualizada' });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'No podés eliminarte a vos mismo' });
  }
  db.deleteUser(req.params.id);
  res.json({ message: 'Usuario eliminado' });
});

// ── API: categories ────────────────────────────────────────────────────────

app.get('/api/categories', requireAuth, (req, res) => {
  res.json(db.VALID_CATEGORIES);
});

// ── API: approvals ─────────────────────────────────────────────────────────

// All pending (dashboard main view)
app.get('/api/approvals', requireAuth, (req, res) => {
  const { category, month } = req.query;
  res.json(db.getPending({ category, month }));
});

// Items approved by the current user (dashboard history)
app.get('/api/approvals/mine', requireAuth, (req, res) => {
  const { category, month } = req.query;
  res.json(db.getApproved({ category, month, approvedById: req.session.userId }));
});

// All records (admin/moderador)
app.get('/api/approvals/all', requireAuth, requireModerador, (req, res) => {
  const { category, month, status } = req.query;
  res.json(db.getAll({ category, month, status }));
});

// Single record (must be AFTER /mine and /all to avoid :id capturing those)
app.get('/api/approvals/:id', requireAuth, (req, res) => {
  const approval = db.getById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'No encontrado' });
  approval.comments = db.getComments(req.params.id);
  approval.images   = db.getImages(req.params.id);
  res.json(approval);
});

// Approve
app.put('/api/approvals/:id/approve', requireAuth, (req, res) => {
  const { selectedOption } = req.body;
  const approval = db.getById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'No encontrado' });

  const images = db.getImages(req.params.id);
  if (!Number.isInteger(selectedOption) || selectedOption < 1 || selectedOption > images.length) {
    return res.status(400).json({ error: 'Opción inválida' });
  }

  const result = db.approve(req.params.id, selectedOption, req.session.userId, req.session.username);
  if (result.changes === 0) return res.status(404).json({ error: 'No encontrado o ya procesado' });

  const updated = db.getById(req.params.id);
  notifyApproval(updated).catch(err => console.error('[Notify]', err));
  res.json({ message: 'Aprobado exitosamente' });
});

// ── API: comments ──────────────────────────────────────────────────────────

app.get('/api/approvals/:id/comments', requireAuth, (req, res) => {
  res.json(db.getComments(req.params.id));
});

app.post('/api/approvals/:id/comments', requireAuth, upload.single('image'), (req, res) => {
  const { content } = req.body;
  const image = req.file ? req.file.filename : null;
  if (!content && !image) return res.status(400).json({ error: 'Se requiere texto o imagen' });

  const approval = db.getById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'No encontrado' });

  const result = db.addComment(req.params.id, content, image, req.session.username);

  // Telegram notification
  notifyComment(approval, content, req.session.username).catch(err => console.error('[Notify]', err));

  res.json({ id: result.lastInsertRowid, message: 'Comentario agregado' });
});

app.put('/api/comments/:id', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'El contenido no puede estar vacío' });
  const existing = db.getCommentById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Comentario no encontrado' });
  db.updateComment(req.params.id, content.trim());
  res.json({ message: 'Comentario actualizado' });
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const c = db.deleteComment(req.params.id);
  if (c?.image) {
    const fp = path.join(uploadsDir, c.image);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
  }
  res.json({ message: 'Comentario eliminado' });
});

// ── API: admin — create approval ───────────────────────────────────────────

app.post('/api/approvals', requireAuth, requireModerador, upload.array('images', 30), (req, res) => {
  const { title, category } = req.body;
  const files = req.files || [];

  // No mandatory fields — use placeholders when images are missing
  const imgs = [
    files[0]?.filename || '',
    files[1]?.filename || '',
    files[2]?.filename || '',
  ];

  const result = db.create(
    title || 'Sin título',
    category || 'Web',
    imgs[0], imgs[1], imgs[2],
    req.session.userId,
    req.session.username
  );

  if (files.length > 3) {
    db.addExtraImages(result.lastInsertRowid, files.slice(3).map(f => f.filename));
  }

  res.json({ id: result.lastInsertRowid, message: 'Creado exitosamente' });
});

// Discard
app.put('/api/approvals/:id/discard', requireAuth, requireModerador, (req, res) => {
  const result = db.discard(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'No encontrado o ya procesado' });
  res.json({ message: 'Descartado exitosamente' });
});

// Reopen (reset to pending)
app.put('/api/approvals/:id/reopen', requireAuth, requireModerador, (req, res) => {
  const result = db.reopen(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'No encontrado o ya está pendiente' });
  res.json({ message: 'Solicitud re-abierta exitosamente' });
});

// Delete
app.delete('/api/approvals/:id', requireAuth, requireAdmin, (req, res) => {
  const result = db.deleteById(req.params.id);
  const cleanup = (filename) => {
    if (!filename) return;
    const fp = path.join(uploadsDir, filename);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
  };
  [result.record?.image1, result.record?.image2, result.record?.image3].forEach(cleanup);
  (result.extraImages || []).forEach(cleanup);
  (result.comments || []).forEach(c => cleanup(c.image));
  res.json({ message: 'Eliminado exitosamente' });
});

// ── API: download image ────────────────────────────────────────────────────

app.get('/api/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const fp = path.join(uploadsDir, filename);
  if (!fs.existsSync(fp)) return res.status(404).send('Not found');
  res.download(fp, filename);
});

// ── API: cleanup ───────────────────────────────────────────────────────────

app.post('/api/cleanup', requireAuth, requireAdmin, (req, res) => {
  const days = parseInt(process.env.CLEANUP_DAYS || '30');
  const deleted = performCleanup(days);
  res.json({ message: `Limpieza completada. ${deleted} registros eliminados.`, deleted });
});

function performCleanup(days) {
  const result = db.deleteOlderThan(days);
  const cleanup = (filename) => {
    if (!filename) return;
    const fp = path.join(uploadsDir, filename);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
  };
  result.records.forEach(r => [r.image1, r.image2, r.image3].forEach(cleanup));
  (result.extraImages || []).forEach(cleanup);
  result.comments.forEach(c => cleanup(c.image));
  console.log(`[Limpieza] ${result.records.length} registros eliminados (>${days} días)`);
  return result.records.length;
}

// ── Error handler ──────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Error de archivo: ${err.message}` });
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// ── Init ───────────────────────────────────────────────────────────────────

db.init();
initEmail();

app.listen(PORT, () => {
  console.log(`\n  Plataforma de Aprobaciones`);
  console.log(`  http://localhost:${PORT}\n`);
});
