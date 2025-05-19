//
//  index.js
//  
//
//  Created by Brent Lane on 5/17/25.
//

// backend/routes/index.js
const express = require('express');
const adminUploadRoutes = require('./adminUploadRoutes');
const authRoutes = require('./authRoutes');
const displayRoutes = require('./displayRoutes');
const adminCalculationRoutes = require('./adminCalculationRoutes');
const router = express.Router();


router.use('/admin/uploads', adminUploadRoutes);
router.use('/auth', authRoutes);
router.use(displayRoutes);
router.use('/admin/calculations', adminCalculationRoutes);

// A simple test route for the main API router
router.get('/test-main-router', (req, res) => {
    res.json({ message: 'Main API router is working!' });
});

module.exports = router;
