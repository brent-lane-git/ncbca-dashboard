// backend/routes/displayRoutes.js
const express = require('express');
const displayController = require('../controllers/displayController');
const router = express.Router();

router.get('/conferences', displayController.getConferences);
router.get('/teams', displayController.getTeams);
router.get('/teams/:bbgm_tid', displayController.getTeamDetailsByBbgmTid);
router.get('/teams/:bbgm_tid/roster', displayController.getTeamRosterByBbgmTid);
router.get('/players/:bbgm_pid', displayController.getPlayerDetailsByBbgmPid);

module.exports = router;
