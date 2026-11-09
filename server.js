require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // the website

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/meta', require('./routes/meta'));
app.use('/api/notices', require('./routes/notices'));
app.use('/api/events', require('./routes/events'));
app.get('/api/health', (req, res) => res.json({ status: 'CampusPulse API is running' }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CampusPulse running at http://localhost:${port}`));
