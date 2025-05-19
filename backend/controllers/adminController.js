// backend/controllers/adminController.js
const brentpomService = require('../services/brentpomService');

const triggerBrentpomCalculation = async (req, res, next) => {
    const { seasonYear } = req.params;
    const parsedSeasonYear = parseInt(seasonYear);

    if (isNaN(parsedSeasonYear)) {
        return res.status(400).json({ error: 'Invalid season year format.' });
    }

    try {
        console.log(`AdminController: Received request to calculate BrentPom for season ${parsedSeasonYear}`);
        const result = await brentpomService.calculateBrentpomForSeason(parsedSeasonYear);
        
        if (result.success) {
            res.status(200).json({ message: result.message, data: result.data });
        } else {
            res.status(400).json({ message: result.message || "Brentpom calculation failed or found no data to process."})
        }
    } catch (error) {
        console.error(`AdminController: Error triggering BrentPom calculation for season ${parsedSeasonYear}:`, error);
        next(error);
    }
};

module.exports = {
    triggerBrentpomCalculation
};
