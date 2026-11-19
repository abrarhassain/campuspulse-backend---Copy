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
      SELECT n.notice_id, n.title, n.body, n.audience, n.is_pinned, n.publish_at, n.created_at, (n.image_data IS NOT NULL) AS has_image,
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
    if (req.user.role === 'student') sql += " AND n.audience = 'everyone'"; // faculty-only notices are hidden from students
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
// Admin sees campus-wide numbers. Faculty see only the numbers for their own notices.
router.get('/stats', requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const mine = req.user.role === 'faculty';
    const who = mine ? ' AND created_by = ?' : '';
    const p = mine ? [req.user.id, req.user.id, req.user.id] : [];
    const [[s]] = await db.query(`SELECT
      (SELECT COUNT(*) FROM notices WHERE status = 'published'${who}) AS published,
      (SELECT COUNT(*) FROM notices WHERE status = 'pending'${who}) AS pending,
      (SELECT COUNT(*) FROM event_registrations r JOIN events e ON e.event_id = r.event_id
         WHERE r.status = 'registered'${mine ? ' AND e.created_by = ?' : ''}) AS signups`, p);
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
      `SELECT n.notice_id, n.title, n.body, n.audience, n.created_at, (n.image_data IS NOT NULL) AS has_image,
              c.name AS category, d.name AS department, u.full_name AS posted_by
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

// GET /api/notices/mine   (faculty and admin: the notices I posted, with their status)
router.get('/mine', requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT n.notice_id, n.title, n.status, n.audience, n.created_at, (n.image_data IS NOT NULL) AS has_image,
              c.name AS category, d.name AS department, e.venue, e.starts_at,
              (SELECT COUNT(*) FROM event_registrations x WHERE x.event_id = e.event_id AND x.status = 'registered') AS signups
       FROM notices n
       JOIN categories c ON c.category_id = n.category_id
       LEFT JOIN departments d ON d.department_id = n.department_id
       LEFT JOIN events e ON e.notice_id = n.notice_id
       WHERE n.created_by = ? ORDER BY n.created_at DESC LIMIT 50`, [req.user.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your notices.' });
  }
});

// GET /api/notices/:id/image   (the picture itself; published notices are visible to everyone logged in)
router.get('/:id/image', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT image_data, status, created_by, audience FROM notices WHERE notice_id = ?', [req.params.id]);
    const n = rows[0];
    if (!n || !n.image_data) return res.status(404).json({ error: 'No picture.' });
    // Unpublished pictures: only the admin and the person who posted it
    if (n.status !== 'published' && req.user.role !== 'admin' && n.created_by !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    if (n.audience === 'faculty' && req.user.role === 'student') {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(n.image_data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load the picture.' });
  }
});

// POST /api/notices   body: { title, body, category_id, department_id, venue?, starts_at?, image? }
// image is optional: a JPEG as a data URL (the website shrinks it before sending).
// Faculty notices wait for approval. Admin notices publish at once.
// Event notices also create an event (venue and starts_at required).
router.post('/', requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { title, body, category_id, department_id, venue, starts_at, image, audience } = req.body;
    if (!title || !body || !category_id) {
      return res.status(400).json({ error: 'Title, message and category are required.' });
    }
    const [[cat]] = await db.query('SELECT name FROM categories WHERE category_id = ?', [category_id]);
    if (!cat) return res.status(400).json({ error: 'Choose a valid category.' });
    const aud = audience === 'faculty' ? 'faculty' : 'everyone'; // who may read it
    const isEvent = cat.name === 'Event';
    if (isEvent && (!venue || !starts_at)) {
      return res.status(400).json({ error: 'Events need a venue and a start time.' });
    }
    // Optional picture: must be a JPEG and under 1.5 MB
    let pic = null;
    if (image) {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if (!m) return res.status(400).json({ error: 'The picture must be a JPEG, PNG or similar image file.' });
      pic = Buffer.from(m[1], 'base64');
      if (pic.length > 1.5 * 1024 * 1024) return res.status(400).json({ error: 'The picture is too big. Try a smaller one.' });
    }
    const isAdmin = req.user.role === 'admin';
    const [result] = await db.query(
      `INSERT INTO notices (title, body, category_id, department_id, created_by, approved_by, status, publish_at, image_data, audience)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, body, category_id, department_id || null, req.user.id,
       isAdmin ? req.user.id : null, isAdmin ? 'published' : 'pending', isAdmin ? new Date() : null, pic, aud]
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

// DELETE /api/notices/:id   (admin only: removes the notice, its picture and any linked event)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT title FROM notices WHERE notice_id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'That notice no longer exists.' });
    // Remove the linked event first (its sign-ups go with it), otherwise it would be left behind without a notice
    await db.query('DELETE FROM events WHERE notice_id = ?', [req.params.id]);
    await db.query('DELETE FROM notices WHERE notice_id = ?', [req.params.id]);
    await audit(req.user.id, 'DELETE_NOTICE', req.params.id, { title: rows[0].title });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the notice.' });
  }
});

module.exports = router;
