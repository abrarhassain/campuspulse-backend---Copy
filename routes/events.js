const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate);

// POST /api/events/:id/register  -> register, or cancel if already registered
router.post('/:id/register', async (req, res) => {
  try {
    const [ev] = await db.query('SELECT event_id, capacity FROM events WHERE event_id = ?', [req.params.id]);
    if (!ev[0]) return res.status(404).json({ error: 'Event not found.' });

    const [ex] = await db.query(
      'SELECT registration_id, status FROM event_registrations WHERE event_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (ex[0] && ex[0].status === 'registered') {
      await db.query("UPDATE event_registrations SET status = 'cancelled' WHERE registration_id = ?", [ex[0].registration_id]);
      return res.json({ registered: false });
    }
    if (ev[0].capacity) {
      const [[c]] = await db.query(
        "SELECT COUNT(*) AS n FROM event_registrations WHERE event_id = ? AND status = 'registered'", [req.params.id]);
      if (c.n >= ev[0].capacity) return res.status(409).json({ error: 'This event is full.' });
    }
    if (ex[0]) {
      await db.query("UPDATE event_registrations SET status = 'registered' WHERE registration_id = ?", [ex[0].registration_id]);
    } else {
      await db.query('INSERT INTO event_registrations (event_id, user_id) VALUES (?, ?)', [req.params.id, req.user.id]);
    }
    res.json({ registered: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update your registration.' });
  }
});

module.exports = router;
