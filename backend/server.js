// backend/server.js
const express = require('express');
const app = express();
const port = process.env.PORT || 3001; // We'll use port 3001 for the backend

// Middleware to parse JSON bodies
app.use(express.json());

// A simple test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Hello from the NCBCA Dashboard Backend!' });
});

app.listen(port, () => {
  console.log(`NCBCA Backend server listening on port ${port}`);
});
