//
//  cacheService.js
//  
//
//  Created by Brent Lane on 5/17/25.
//


// backend/services/cacheService.js
const db = require('../config/db'); // Assumes db.js is in backend/config/

let teamAbbrevToTidCache = {};

async function refreshTeamCache(clientDB = db) {
    console.log('Refreshing team abbreviation cache (from cacheService)...');
    try {
        // Ensure the teams table exists before querying, or handle error if it doesn't
        // For now, assuming it exists as per schema.sql
        const result = await clientDB.query('SELECT bbgm_tid, abbrev, name FROM teams');
        const oldCacheSize = Object.keys(teamAbbrevToTidCache).length;
        teamAbbrevToTidCache = {}; // Clear old cache

        result.rows.forEach(team => {
            if (team.abbrev && team.bbgm_tid !== null) {
                const upperAbbrev = team.abbrev.toUpperCase().trim(); 
                if (upperAbbrev) { 
                    teamAbbrevToTidCache[upperAbbrev] = team.bbgm_tid;
                    // Example debug log (can be removed if no longer needed for BC)
                    // if (upperAbbrev === 'BC') {
                    //     console.log(`DEBUG CACHE POPULATE (cacheService): Adding/Updating '<span class="math-inline">\{upperAbbrev\}' \(from DB team '</span>{team.name}', tid ${team.bbgm_tid}) to cache with TID <span class="math-inline">\{team\.bbgm\_tid\}\. Original abbrev from DB\: '</span>{team.abbrev}'`);
                    // }
                }
            }
        });

        console.log(`Team cache refreshed (cacheService). ${Object.keys(teamAbbrevToTidCache).length} teams loaded. Was ${oldCacheSize} before.`);
        // Example debug check (can be removed if no longer needed for BC)
        // if (teamAbbrevToTidCache.hasOwnProperty('BC')) {
        //     console.log("DEBUG CACHE CHECK (cacheService): 'BC' IS in cache with TID:", teamAbbrevToTidCache['BC']);
        // } else {
        //     console.log("DEBUG CACHE CHECK (cacheService): 'BC' was NOT found in cache after refresh.");
        // }

    } catch (error) {
        console.error('Error refreshing team cache (cacheService):', error);
        // If this happens on startup and teams table doesn't exist, app might still start
        // but cache will be empty. Consider if this should throw to halt startup
        // if cache is critical immediately.
    }
}

function getTeamAbbrevCache() {
    return teamAbbrevToTidCache;
}

module.exports = {
    refreshTeamCache,
    getTeamAbbrevCache 
};