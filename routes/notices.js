const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate); // every route below needs a login

async function audit(userId, action, noticeId, details) {
  await db.query(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId, action, 'notice', noticeId, JSON.stringify(details || {})]
  );
}

// GET /api/notices?q=exam&department=1&category=2   (published notices, with event info)
router.get('/', async (req, res) => {
  try {
    const { q, department, category } = req.query;
    let sql = `
      SELECT n.notice_id, n.title, n.body, n.is_pinned, n.publish_at,
             c.name AS category, d.name AS department, u.full_name AS posted_by,
             e.event_id, e.venue, e.starts_at, e.capacity,
             (SELECT COUNT(*) FROM event_registrations x WHERE x.event_id = e.event_id AND x.status = 'registered') AS signups,
             (r.registration_id IS NOT NULL) AS registered
      FROM notices n
      JOIN categories c ON c.category_id = n.category_id
      LEFT JOIN departments d ON d.department_id = n.department_id
      JOIN users u ON u.user_id = n.created_by
      LEFT JOIN events e ON e.notice_id = n.notice_id
      LEFT JOIN event_registrations r ON r.event_id = e.event_id AND r.user_id = ? AND r.status = 'registered'
      WHERE n.status = 'published' AND (n.expires_at IS NULL OR n.expires_at > NOW())`;
    const params = [req.user.id];
    if (q) { sql += ' AND (n.title LIKE ? OR n.body LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (department) { sql += ' AND n.department_id = ?'; params.push(department); }
    if (category) { sql += ' AND n.category_id = ?'; params.push(category); }
    sql += ' ORDER BY n.is_pinned DESC, n.publish_at DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load notices.' });
  }
});

// GET /api/notices/stats   (faculty and admin: dashboard numbers)
router.get('/stats', requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const [[s]] = await db.query(`SELECT
      (SELECT COUNT(*) FROM notices WHERE status = 'published') AS published,
      (SELECT COUNT(*) FROM notices WHERE status = 'pending') AS pending,
      (SELECT COUNT(*) FROM event_registrations WHERE status = 'registered') AS signups`);
    res.json(s);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load the numbers.' });
  }
});

// GET /api/notices/pending   (admin: notices waiting for approval)
router.get('/pending', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT n.notice_id, n.title, n.body, c.name AS category, d.name AS department, u.full_name AS posted_by
       FROM notices n
       JOIN categories c ON c.category_id = n.category_id
       LEFT JOIN departments d ON d.department_id = n.department_id
       JOIN users u ON u.user_id = n.created_by
       WHERE n.status = 'pending' ORDER BY n.created_at`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load pending notices.' });
  }
});

// POST /api/notices   body: { title, body, category_id, department_id, venue?, starts_at? }
// Faculty notices wait for approval. Admin notices publish at once.
// Event notices also create an event (venue and starts_at required).
router.post('/', requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { title, body, category_id, department_id, venue, starts_at } = req.body;
    if (!title || !body || !category_id) {
      return res.status(400).json({ error: 'Title, message and category are required.' });
    }
    const [[cat]] = await db.query('SELECT name FROM categories WHERE category_id = ?', [category_id]);
    if (!cat) return res.status(400).json({ error: 'Choose a valid category.' });
    const isEvent = cat.name === 'Event';
    if (isEvent && (!venue || !starts_at)) {
      return res.status(400).json({ error: 'Events need a venue and a start time.' });
    }
    const isAdmin = req.user.role === 'admin';
    const [result] = await db.query(
      `INSERT INTO notices (title, body, category_id, department_id, created_by, approved_by, status, publish_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, body, category_id, department_id || null, req.user.id,
       isAdmin ? req.user.id : null, isAdmin ? 'published' : 'pending', isAdmin ? new Date() : null]
    );
    if (isEvent) {
      await db.query(
        `INSERT INTO events (notice_id, title, description, venue, starts_at, department_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, title, body, venue, String(starts_at).replace('T', ' '), department_id || null, req.user.id]
      );
    }
    await audit(req.user.id, 'CREATE_NOTICE', result.insertId, { title });
    res.status(201).json({ notice_id: result.insertId, status: isAdmin ? 'published' : 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save the notice.' });
  }
});

// PATCH /api/notices/:id/approve  and  /reject   (admin only)
router.patch('/:id/:action(approve|reject)', requireRole('admin'), async (req, res) => {
  try {
    const approve = req.params.action === 'approve';
    const [result] = await db.query(
      `UPDATE notices SET status = ?, approved_by = ?, publish_at = ${approve ? 'NOW()' : 'NULL'}
       WHERE notice_id = ? AND status = 'pending'`,
      [approve ? 'published' : 'rejected', req.user.id, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'No pending notice with that id.' });
    await audit(req.user.id, approve ? 'APPROVE_NOTICE' : 'REJECT_NOTICE', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update the notice.' });
  }
});

module.exports = router;
