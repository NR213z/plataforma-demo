const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'approvals.db');
let db;

const VALID_CATEGORIES = ['Web', 'Diario', 'Grafica'];
const VALID_ROLES = ['usuario', 'moderador', 'administrador'];

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'usuario',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Web',
      image1 TEXT NOT NULL DEFAULT '',
      image2 TEXT NOT NULL DEFAULT '',
      image3 TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      selected_option INTEGER,
      approved_by_id INTEGER,
      approved_by_username TEXT,
      created_by_id INTEGER,
      created_by_username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      approved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_id INTEGER NOT NULL,
      content TEXT,
      image TEXT,
      author_username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT,
      FOREIGN KEY (approval_id) REFERENCES approval_requests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approval_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      filename TEXT NOT NULL,
      FOREIGN KEY (approval_id) REFERENCES approval_requests(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_comments_approval ON comments(approval_id);
    CREATE INDEX IF NOT EXISTS idx_approval_images ON approval_images(approval_id);
  `);

  // ── Migrations for existing databases ──────────────────────────────────────
  const arCols = db.prepare('PRAGMA table_info(approval_requests)').all().map(c => c.name);
  if (!arCols.includes('category'))              db.exec("ALTER TABLE approval_requests ADD COLUMN category TEXT NOT NULL DEFAULT 'Web'");
  if (!arCols.includes('approved_by_id'))        db.exec('ALTER TABLE approval_requests ADD COLUMN approved_by_id INTEGER');
  if (!arCols.includes('approved_by_username'))  db.exec('ALTER TABLE approval_requests ADD COLUMN approved_by_username TEXT');
  if (!arCols.includes('created_by_id'))         db.exec('ALTER TABLE approval_requests ADD COLUMN created_by_id INTEGER');
  if (!arCols.includes('created_by_username'))   db.exec('ALTER TABLE approval_requests ADD COLUMN created_by_username TEXT');

  const cCols = db.prepare('PRAGMA table_info(comments)').all().map(c => c.name);
  if (!cCols.includes('updated_at'))      db.exec('ALTER TABLE comments ADD COLUMN updated_at TEXT');
  if (!cCols.includes('author_username')) db.exec('ALTER TABLE comments ADD COLUMN author_username TEXT');

  // ── Default admin user ──────────────────────────────────────────────────────
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (userCount === 0) {
    const bcrypt = require('bcryptjs');
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin123';
    const hashed = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(adminUser, hashed, 'administrador');
    console.log(`[DB] Usuario administrador creado: ${adminUser}`);
  }

  return db;
}

// ══════════════════════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════════════════════

function getUsers() {
  return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC').all();
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
}

function createUser(username, hashedPassword, role) {
  return db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hashedPassword, role);
}

function updateUserPassword(id, hashedPassword) {
  return db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, id);
}

function deleteUser(id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ══════════════════════════════════════════════════════════════════════════════
// APPROVALS
// ══════════════════════════════════════════════════════════════════════════════

const _extra = `
  (SELECT COUNT(*) FROM comments WHERE approval_id = a.id) AS comment_count,
  (3 + (SELECT COUNT(*) FROM approval_images WHERE approval_id = a.id)) AS image_count
`;

function _buildWhere(opts = {}) {
  const { status, category, month, approvedById } = opts;
  const conditions = [];
  const params = [];

  if (status && status !== 'all') { conditions.push(`a.status = ?`); params.push(status); }
  if (category && VALID_CATEGORIES.includes(category)) { conditions.push(`a.category = ?`); params.push(category); }
  if (month) { conditions.push(`strftime('%Y-%m', a.created_at) = ?`); params.push(month); }
  if (approvedById) { conditions.push(`a.approved_by_id = ?`); params.push(approvedById); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}

function getPending(opts = {}) {
  const { where, params } = _buildWhere({ ...opts, status: 'pending' });
  return db.prepare(`SELECT a.*, ${_extra} FROM approval_requests a ${where} ORDER BY a.created_at DESC`).all(...params);
}

function getApproved(opts = {}) {
  const { where, params } = _buildWhere({ ...opts, status: 'approved' });
  return db.prepare(`SELECT a.*, ${_extra} FROM approval_requests a ${where} ORDER BY a.approved_at DESC`).all(...params);
}

function getAll(opts = {}) {
  const { where, params } = _buildWhere(opts);
  return db.prepare(`SELECT a.*, ${_extra} FROM approval_requests a ${where} ORDER BY a.created_at DESC`).all(...params);
}

function getById(id) {
  return db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
}

function create(title, category, image1, image2, image3, createdById, createdByUsername) {
  const cat = VALID_CATEGORIES.includes(category) ? category : 'Web';
  return db.prepare(
    `INSERT INTO approval_requests (title, category, image1, image2, image3, created_by_id, created_by_username)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(title, cat, image1 || '', image2 || '', image3 || '', createdById || null, createdByUsername || null);
}

function approve(id, selectedOption, userId, username) {
  return db.prepare(
    `UPDATE approval_requests
     SET status = 'approved', selected_option = ?,
         approved_at = datetime('now', 'localtime'),
         approved_by_id = ?, approved_by_username = ?
     WHERE id = ? AND status = 'pending'`
  ).run(selectedOption, userId || null, username || null, id);
}

function discard(id) {
  return db.prepare(
    `UPDATE approval_requests SET status = 'discarded' WHERE id = ? AND status = 'pending'`
  ).run(id);
}

function deleteById(id) {
  const record = getById(id);
  const comments = getComments(id);
  const extraImages = db.prepare('SELECT filename FROM approval_images WHERE approval_id = ?').all(id).map(e => e.filename);
  db.prepare('DELETE FROM approval_requests WHERE id = ?').run(id);
  return { record, comments, extraImages };
}

function getOlderThan(days) {
  return db.prepare(
    `SELECT * FROM approval_requests WHERE created_at <= datetime('now', 'localtime', ? || ' days')`
  ).all(`-${days}`);
}

function deleteOlderThan(days) {
  const old = getOlderThan(days);
  const oldComments = [];
  const allExtraImages = [];
  old.forEach(r => {
    oldComments.push(...getComments(r.id));
    allExtraImages.push(...db.prepare('SELECT filename FROM approval_images WHERE approval_id = ?').all(r.id).map(e => e.filename));
  });
  db.prepare(`DELETE FROM approval_requests WHERE created_at <= datetime('now', 'localtime', ? || ' days')`).run(`-${days}`);
  return { records: old, comments: oldComments, extraImages: allExtraImages };
}

// ══════════════════════════════════════════════════════════════════════════════
// IMAGES
// ══════════════════════════════════════════════════════════════════════════════

function getImages(approvalId) {
  const record = db.prepare('SELECT image1, image2, image3 FROM approval_requests WHERE id = ?').get(approvalId);
  if (!record) return [];
  const extras = db.prepare('SELECT filename FROM approval_images WHERE approval_id = ? ORDER BY position ASC').all(approvalId);
  const base = [record.image1, record.image2, record.image3].filter(f => f && f !== '');
  return [...base, ...extras.map(e => e.filename)];
}

function addExtraImages(approvalId, filenames) {
  const stmt = db.prepare('INSERT INTO approval_images (approval_id, position, filename) VALUES (?, ?, ?)');
  filenames.forEach((filename, idx) => stmt.run(approvalId, idx + 4, filename));
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMENTS
// ══════════════════════════════════════════════════════════════════════════════

function getComments(approvalId) {
  return db.prepare('SELECT * FROM comments WHERE approval_id = ? ORDER BY created_at ASC').all(approvalId);
}

function addComment(approvalId, content, image, authorUsername) {
  return db.prepare(
    'INSERT INTO comments (approval_id, content, image, author_username) VALUES (?, ?, ?, ?)'
  ).run(approvalId, content || null, image || null, authorUsername || null);
}

function getCommentById(id) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
}

function updateComment(id, content) {
  return db.prepare(
    `UPDATE comments SET content = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(content || null, id);
}

function deleteComment(id) {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  return c;
}

module.exports = {
  init,
  VALID_CATEGORIES, VALID_ROLES,
  // users
  getUsers, getUserByUsername, getUserById, createUser, updateUserPassword, deleteUser,
  // approvals
  getPending, getApproved, getAll, getById, create, approve, discard, deleteById,
  getOlderThan, deleteOlderThan,
  // images
  getImages, addExtraImages,
  // comments
  getComments, addComment, getCommentById, updateComment, deleteComment,
};
