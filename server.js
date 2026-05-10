require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const db = require('./db');
const { initEmail, notifyApproval } = require('./notifications');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'));
    }
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }, // 8 horas
}));

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth middleware ---

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.accepts('html')) return res.redirect('/admin/login');
  res.status(401).json({ error: 'No autenticado' });
}

// --- Rutas de autenticación ---

app.get('/admin/login', (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASS || 'admin123';

  if (username === validUser && password === validPass) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }

  res.redirect('/admin/login?error=1');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// --- Páginas ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- API pública (dashboard de usuario) ---

app.get('/api/categories', (req, res) => {
  res.json(db.VALID_CATEGORIES);
});

app.get('/api/approvals', (req, res) => {
  const category = req.query.category;
  res.json(db.getPending(category));
});

// IMPORTANTE: /all debe ir antes de /:id para que no lo capture como id
app.get('/api/approvals/all', requireAdmin, (req, res) => {
  res.json(db.getAll());
});

app.get('/api/approvals/:id', (req, res) => {
  const approval = db.getById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'No encontrado' });
  approval.comments = db.getComments(req.params.id);
  approval.images = db.getImages(req.params.id);
  res.json(approval);
});

app.put('/api/approvals/:id/approve', (req, res) => {
  const { selectedOption } = req.body;

  const approval = db.getById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'No encontrado' });

  const images = db.getImages(req.params.id);
  const maxOption = images.length;

  if (!Number.isInteger(selectedOption) || selectedOption < 1 || selectedOption > maxOption) {
    return res.status(400).json({ error: 'Opción inválida' });
  }

  const result = db.approve(req.params.id, selectedOption);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'No encontrado o ya procesado' });
  }

  notifyApproval(approval).catch(err => console.error('[Notify]', err));

  res.json({ message: 'Aprobado exitosamente' });
});

// --- Comentarios (públicos) ---

app.get('/api/approvals/:id/comments', (req, res) => {
  res.json(db.getComments(req.params.id));
});

app.post('/api/approvals/:id/comments', upload.single('image'), (req, res) => {
  const { content } = req.body;
  const image = req.file ? req.file.filename : null;

  if (!content && !image) {
    return res.status(400).json({ error: 'Se requiere texto o imagen' });
  }

  const approval = db.getById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'Aprobación no encontrada' });

  const result = db.addComment(req.params.id, content, image);
  res.json({ id: result.lastInsertRowid, message: 'Comentario agregado' });
});

app.put('/api/comments/:id', (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'El contenido no puede estar vacío' });
  }
  const existing = db.getCommentById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Comentario no encontrado' });

  db.updateComment(req.params.id, content.trim());
  res.json({ message: 'Comentario actualizado' });
});

app.delete('/api/comments/:id', (req, res) => {
  const c = db.deleteComment(req.params.id);
  if (c && c.image) {
    const filePath = path.join(uploadsDir, c.image);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
    }
  }
  res.json({ message: 'Comentario eliminado' });
});

// --- API admin (protegida) ---

app.post('/api/approvals', requireAdmin, upload.array('images', 20), (req, res) => {
  const { title, category } = req.body;
  if (!title || !req.files || req.files.length < 3) {
    if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ } });
    return res.status(400).json({ error: 'Se requiere título y al menos 3 imágenes' });
  }

  const result = db.create(
    title,
    category || 'Web',
    req.files[0].filename,
    req.files[1].filename,
    req.files[2].filename
  );

  // Extra images (Diario: páginas 4, 5, 6…)
  if (req.files.length > 3) {
    db.addExtraImages(result.lastInsertRowid, req.files.slice(3).map(f => f.filename));
  }

  res.json({ id: result.lastInsertRowid, message: 'Creado exitosamente' });
});

app.put('/api/approvals/:id/discard', requireAdmin, (req, res) => {
  const result = db.discard(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'No encontrado o ya procesado' });
  }
  res.json({ message: 'Descartado exitosamente' });
});

app.delete('/api/approvals/:id', requireAdmin, (req, res) => {
  const result = db.deleteById(req.params.id);
  if (result.record) {
    [result.record.image1, result.record.image2, result.record.image3].forEach(img => {
      const filePath = path.join(uploadsDir, img);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  }
  if (result.extraImages) {
    result.extraImages.forEach(filename => {
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    });
  }
  if (result.comments) {
    result.comments.forEach(c => {
      if (!c.image) return;
      const filePath = path.join(uploadsDir, c.image);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    });
  }
  res.json({ message: 'Eliminado exitosamente' });
});

app.post('/api/cleanup', requireAdmin, (req, res) => {
  const days = parseInt(process.env.CLEANUP_DAYS || '7');
  const deleted = performCleanup(days);
  res.json({ message: `Limpieza completada. ${deleted} registros eliminados.`, deleted });
});

function performCleanup(days) {
  const result = db.deleteOlderThan(days);
  result.records.forEach(record => {
    [record.image1, record.image2, record.image3].forEach(img => {
      const filePath = path.join(uploadsDir, img);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    });
  });
  if (result.extraImages) {
    result.extraImages.forEach(filename => {
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    });
  }
  result.comments.forEach(c => {
    if (!c.image) return;
    const filePath = path.join(uploadsDir, c.image);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
    }
  });
  console.log(`[Limpieza] ${result.records.length} registros antiguos eliminados (>${days} días)`);
  return result.records.length;
}

// --- Init ---

db.init();
initEmail();

if (process.env.AUTO_CLEANUP === 'true') {
  cron.schedule('0 3 * * 0', () => {
    const days = parseInt(process.env.CLEANUP_DAYS || '7');
    console.log('[Cron] Ejecutando limpieza semanal...');
    performCleanup(days);
  });
  console.log('[Cron] Limpieza automática programada (domingos 3:00 AM)');
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Error de archivo: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`\n  Plataforma de Aprobaciones`);
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  Admin:      http://localhost:${PORT}/admin`);
  console.log(`  Login:      http://localhost:${PORT}/admin/login\n`);
});
