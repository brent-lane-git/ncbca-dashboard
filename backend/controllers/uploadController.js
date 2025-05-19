// backend/controllers/uploadController.js
const fs = require('fs');
const db = require('../config/db');
const cacheService = require('../services/cacheService');
const importService = require('../services/importService'); // Should contain all JSON import functions
const statsService = require('../services/statsService');

const handleLeagueExportUpload = async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded or file was rejected by filter.' });
    }
    const filePath = req.file.path;
    console.log('JSON File received (controller):', req.file.originalname, 'Stored at:', filePath);

    const client = await db.pool.connect();
    let jsonData;
    let conferencesProcessedCount = 0;
    let teamsProcessedCount = 0;
    let playersProcessedCount = 0;
    let playerSeasonStatsProcessedCount = 0;
    let playedGamesProcessedCount = 0; // Renamed
    let bbgmScheduledGamesLinkedCount = 0; // New
    let leagueEventsProcessedCount = 0; // New
    let teamGameStatsCalculatedCount = 0;

    try {
        await client.query('BEGIN');

        const fileContent = await fs.promises.readFile(filePath, 'utf8');
        jsonData = JSON.parse(fileContent);
        console.log('JSON parsed successfully (controller)!');

        teamsProcessedCount = await importService.processTeams(jsonData.teams, client);
        console.log(`${teamsProcessedCount} teams processed (controller).`);
        
        if (jsonData.gameAttributes && jsonData.gameAttributes.confs && Array.isArray(jsonData.gameAttributes.confs)) {
            conferencesProcessedCount = await importService.processConferences(jsonData.gameAttributes.confs, jsonData.teams, client);
        } else {
            conferencesProcessedCount = await importService.processConferences(null, jsonData.teams, client);
        }
        console.log(`${conferencesProcessedCount} conferences processed (controller).`);

        await cacheService.refreshTeamCache(client);
        
        playersProcessedCount = await importService.processPlayers(jsonData.players, client);
        console.log(`${playersProcessedCount} players processed (controller).`);
        
        playerSeasonStatsProcessedCount = await importService.processPlayerSeasonStats(jsonData.players, client);
        console.log(`${playerSeasonStatsProcessedCount} player season stat records processed (controller).`);

        // Process BBGM's auto-generated schedule (jsonData.schedule)
        const currentSeason = jsonData.meta && jsonData.meta.season !== undefined ? jsonData.meta.season : (jsonData.season || new Date().getFullYear());
        if (jsonData.schedule && Array.isArray(jsonData.schedule)) {
            bbgmScheduledGamesLinkedCount = await importService.processBBGMAutoSchedule(jsonData.schedule, client, currentSeason);
            console.log(`${bbgmScheduledGamesLinkedCount} BBGM auto-scheduled game entries checked/linked (controller).`);
        } else {
            console.log('No "schedule" array (upcoming BBGM games) found in JSON export (controller).');
        }
        
        // Process played games (jsonData.games)
        if (jsonData.games && Array.isArray(jsonData.games)) {
            playedGamesProcessedCount = await importService.processPlayedGames(jsonData.games, client); // Use renamed function
            console.log(`${playedGamesProcessedCount} played game outcomes processed (controller).`);

            const gidsFromCurrentJsonPlayedGames = jsonData.games.map(g => g.gid).filter(gid => gid !== undefined);
            if (gidsFromCurrentJsonPlayedGames.length > 0) {
                teamGameStatsCalculatedCount = await statsService.calculateAndStoreTeamGameStats(client, gidsFromCurrentJsonPlayedGames);
                console.log(`${teamGameStatsCalculatedCount} team game stat entries calculated for played games (controller).`);
            }
        } else {
            console.log('No "games" array (played games) found in JSON export (controller).');
        }

        // Process league events (jsonData.events)
        if (jsonData.events && Array.isArray(jsonData.events)) {
            leagueEventsProcessedCount = await importService.processLeagueEvents(jsonData.events, client);
            console.log(`${leagueEventsProcessedCount} league events processed (controller).`);
        } else {
            console.log('No "events" array found in JSON export (controller).');
        }

        await client.query('COMMIT');
        
        res.status(200).json({
            message: 'File processed successfully by controller! All data updated.',
            filename: req.file.originalname,
            conferencesProcessed: conferencesProcessedCount,
            teamsProcessed: teamsProcessedCount,
            playersProcessed: playersProcessedCount,
            playerSeasonStatsProcessed: playerSeasonStatsProcessedCount,
            playedGamesProcessed: playedGamesProcessedCount, // Renamed
            bbgmScheduledGamesLinked: bbgmScheduledGamesLinkedCount, // New
            leagueEventsProcessed: leagueEventsProcessedCount, // New
            teamGameStatsCalculated: teamGameStatsCalculatedCount
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in handleLeagueExportUpload controller:', error);
        res.status(500).json({
            error: 'Failed to process JSON league export or update database (controller).',
            details: error.message
        });
    } finally {
        client.release();
        if (filePath) {
            try {
                await fs.promises.unlink(filePath);
                console.log('Successfully deleted temporary JSON upload file (controller):', filePath);
            } catch (unlinkError) {
                console.error('Error deleting temporary JSON upload file (controller):', filePath, unlinkError);
            }
        }
    }
};

// handleStatsCsvUpload function should remain here as it was, using statsService
const handleStatsCsvUpload = async (req, res, next) => {
    // ... (your full working version of handleStatsCsvUpload from the last complete server.js)
    if (!req.file) { return res.status(400).json({ error: 'No CSV file uploaded.' }); }
    const filePath = req.file.path;
    const client = await db.pool.connect();
    let playerGameStatsProcessedCount = 0;
    let teamGameStatsCalculatedCount = 0;
    const processedGidsFromCsv = new Set();
    try {
        await client.query('BEGIN');
        playerGameStatsProcessedCount = await statsService.processPlayerGameStats(filePath, client, processedGidsFromCsv);
        console.log(`${playerGameStatsProcessedCount} player game stat records processed from CSV (controller).`);
        const gidsToProcess = Array.from(processedGidsFromCsv);
        if (gidsToProcess.length > 0) {
            teamGameStatsCalculatedCount = await statsService.calculateAndStoreTeamGameStats(client, gidsToProcess);
            console.log(`${teamGameStatsCalculatedCount} team game stat entries calculated for CSV games (controller).`);
        }
        await client.query('COMMIT');
        res.status(200).json({
            message: 'CSV processed by controller!', playerGameStatsProcessed: playerGameStatsProcessedCount,
            teamGameStatsCalculated: teamGameStatsCalculatedCount
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in handleStatsCsvUpload controller:', error);
        res.status(500).json({ error: 'Failed to process CSV (controller).', details: error.message });
    } finally {
        client.release();
        if (filePath) { try { await fs.promises.unlink(filePath); } catch (e) { console.error('Error unlinking CSV:', e); } }
    }
};


module.exports = {
    handleLeagueExportUpload,
    handleStatsCsvUpload
};
