// backend/routes/adminCalculationRoutes.js
const express = require('express');
const adminController = require('../controllers/adminController');
const router = express.Router();

// POST /api/admin/calculations/brentpom/:seasonYear
router.post('/brentpom/:seasonYear', adminController.triggerBrentpomCalculation);

module.exports = router;
