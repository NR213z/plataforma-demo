const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'approvals.db');

let db;

const VALID_CATEGORIES = ['Web', 'Diario', 'Grafica'];

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Web',
      image1 TEXT NOT NULL,
      image2 TEXT NOT NULL,
      image3 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      selected_option INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      approved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_id INTEGER NOT NULL,
      content TEXT,
      image TEXT,
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

  // Migración: agregar columna category si no existe (por bases viejas)
  const cols = db.prepare("PRAGMA table_info(approval_requests)").all();
  if (!cols.some(c => c.name === 'category')) {
    db.exec("ALTER TABLE approval_requests ADD COLUMN category TEXT NOT NULL DEFAULT 'Web'");
  }

  // Migración: agregar columna updated_at en comentarios si no existe
  const ccols = db.prepare("PRAGMA table_info(comments)").all();
  if (!ccols.some(c => c.name === 'updated_at')) {
    db.exec("ALTER TABLE comments ADD COLUMN updated_at TEXT");
  }

  return db;
}

function getPending(category) {
  const extra = `(3 + (SELECT COUNT(*) FROM approval_images WHERE approval_id = a.id)) AS image_count`;
  if (category && VALID_CATEGORIES.includes(category)) {
    return db.prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM comments WHERE approval_id = a.id) AS comment_count, ${extra}
       FROM approval_requests a WHERE status = 'pending' AND category = ? ORDER BY created_at DESC`
    ).all(category);
  }
  return db.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM comments WHERE approval_id = a.id) AS comment_count, ${extra}
     FROM approval_requests a WHERE status = 'pending' ORDER BY created_at DESC`
  ).all();
}

function getAll() {
  const extra = `(3 + (SELECT COUNT(*) FROM approval_images WHERE approval_id = a.id)) AS image_count`;
  return db.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM comments WHERE approval_id = a.id) AS comment_count, ${extra}
     FROM approval_requests a ORDER BY created_at DESC`
  ).all();
}

function getById(id) {
  return db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(id);
}

function create(title, category, image1, image2, image3) {
  const cat = VALID_CATEGORIES.includes(category) ? category : 'Web';
  const stmt = db.prepare(
    `INSERT INTO approval_requests (title, category, image1, image2, image3) VALUES (?, ?, ?, ?, ?)`
  );
  return stmt.run(title, cat, image1, image2, image3);
}

// Returns all images for an approval (image1/2/3 + any extras)
function getImages(approvalId) {
  const record = db.prepare('SELECT image1, image2, image3 FROM approval_requests WHERE id = ?').get(approvalId);
  if (!record) return [];
  const extras = db.prepare(
    'SELECT filename FROM approval_images WHERE approval_id = ? ORDER BY position ASC'
  ).all(approvalId);
  return [record.image1, record.image2, record.image3, ...extras.map(e => e.filename)];
}

// Store extra images (position 4+) for Diario
function addExtraImages(approvalId, filenames) {
  const stmt = db.prepare(
    'INSERT INTO approval_images (approval_id, position, filename) VALUES (?, ?, ?)'
  );
  filenames.forEach((filename, idx) => stmt.run(approvalId, idx + 4, filename));
}

function approve(id, selectedOption) {
  const stmt = db.prepare(
    `UPDATE approval_requests SET status = 'approved', selected_option = ?, approved_at = datetime('now', 'localtime') WHERE id = ? AND status = 'pending'`
  );
  return stmt.run(selectedOption, id);
}

function discard(id) {
  const stmt = db.prepare(
    `UPDATE approval_requests SET status = 'discarded' WHERE id = ? AND status = 'pending'`
  );
  return stmt.run(id);
}

function deleteById(id) {
  const record = getById(id);
  const comments = getComments(id);
  const extraImages = db.prepare(
    'SELECT filename FROM approval_images WHERE approval_id = ?'
  ).all(id).map(e => e.filename);
  db.prepare(`DELETE FROM approval_requests WHERE id = ?`).run(id);
  // approval_images cascade-deleted automatically
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
    const c = getComments(r.id);
    oldComments.push(...c);
    const extras = db.prepare(
      'SELECT filename FROM approval_images WHERE approval_id = ?'
    ).all(r.id).map(e => e.filename);
    allExtraImages.push(...extras);
  });
  db.prepare(
    `DELETE FROM approval_requests WHERE created_at <= datetime('now', 'localtime', ? || ' days')`
  ).run(`-${days}`);
  return { records: old, comments: oldComments, extraImages: allExtraImages };
}

// === Comments ===

function getComments(approvalId) {
  return db.prepare(
    `SELECT * FROM comments WHERE approval_id = ? ORDER BY created_at ASC`
  ).all(approvalId);
}

function addComment(approvalId, content, image) {
  const stmt = db.prepare(
    `INSERT INTO comments (approval_id, content, image) VALUES (?, ?, ?)`
  );
  return stmt.run(approvalId, content || null, image || null);
}

function deleteComment(id) {
  const c = db.prepare(`SELECT * FROM comments WHERE id = ?`).get(id);
  db.prepare(`DELETE FROM comments WHERE id = ?`).run(id);
  return c;
}

function getCommentById(id) {
  return db.prepare(`SELECT * FROM comments WHERE id = ?`).get(id);
}

function updateComment(id, content) {
  const stmt = db.prepare(
    `UPDATE comments SET content = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  );
  return stmt.run(content || null, id);
}

module.exports = {
  init,
  VALID_CATEGORIES,
  getPending, getAll, getById, create, approve, discard, deleteById,
  getOlderThan, deleteOlderThan,
  getImages, addExtraImages,
  getComments, addComment, deleteComment, getCommentById, updateComment,
};
