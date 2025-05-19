//
//  adminUploadRoutes.js
//  
//
//  Created by Brent Lane on 5/17/25.
//
// backend/routes/adminUploadRoutes.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const uploadController = require('../controllers/uploadController');

const router = express.Router();

// --- Multer Configuration (Moved here from server.js) ---
const uploadDir = path.join(__dirname, '..', 'uploads'); // Adjusted path relative to this file
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
destination: (req, file, cb) => cb(null, uploadDir),
filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const jsonUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/json') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type: Only JSON files are allowed for this route.'), false);
    }
  },
  limits: { fileSize: 1024 * 1024 * 1024 }
});

const csvUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type: Only CSV files are allowed for this route.'), false);
    }
  },
  limits: { fileSize: 1024 * 1024 * 1024 }
});
// --- End Multer Configuration ---

// Define routes
router.post('/league-export', jsonUpload.single('leagueFile'), uploadController.handleLeagueExportUpload);
router.post('/stats-csv', csvUpload.single('statsFile'), uploadController.handleStatsCsvUpload);

module.exports = router;
