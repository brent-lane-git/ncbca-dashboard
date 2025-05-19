// backend/server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3001;
const db = require('./config/db');
const cacheService = require('./services/cacheService');
const passport = require('passport');
const sessionConfig = require('./config/session');


// Core Middleware
app.use(express.json());
// Could add other middleware like cors, morgan here later
app.use(sessionConfig); // Use the imported config
app.use(passport.initialize());
app.use(passport.session());
require('./config/passportSetup');

// API Routes
const mainApiRouter = require('./routes'); // Import the main router from routes/index.js
app.use('/api', mainApiRouter); // Mount all API routes under /api

// Test route at root of server.js (optional, can be removed)
// This is different from the /api/test we had before.
app.get('/', (req, res) => {
    res.send('NCBCA Backend is alive!');
});


// Global error handler (should remain the same as your last working version)
app.use((error, req, res, next) => {
  console.error("Global error handler caught:", error.stack);
  if (res.headersSent) {
      return next(error);
  }
  // Check if error is a MulterError or our custom file type error
  // (Assuming multer is not directly used in server.js anymore, this might need adjustment
  // if errors from multer in routes aren't caught before reaching here, or if controllers pass them via next(error))
  // For now, keeping it general. Specific multer errors are handled in the route/controller level or passed via next.
  if (error.message && error.message.includes('Invalid file type')) { // Example for a specific error string
    return res.status(400).json({ error: error.message });
  } else if (error.code && error.code.startsWith('LIMIT_')) { // Generic Multer limit error
    return res.status(400).json({ error: `File upload error: ${error.message}` });
  }
  // General server error
  return res.status(500).json({ error: `Server error: ${error.message || 'Something went wrong!'}` });
});

app.listen(port, () => {
  console.log(`NCBCA Backend server listening on port ${port}`);
  cacheService.refreshTeamCache();
});
