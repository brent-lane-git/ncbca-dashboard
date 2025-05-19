//
//  statsService.js
//  
//
//  Created by Brent Lane on 5/17/25.
//


const fs = require('fs');
const csv = require('csv-parser');
const { v4: uuidv4 } = require('uuid');
const cacheService = require('./cacheService'); // For teamAbbrevToTidCache

async function processPlayerGameStats(filePath, client, processedGidsSet) {
  console.log('--- Entering processPlayerGameStats ---');
  const gameStatsRows = [];
  return new Promise((resolve, reject) => {
    let rowsProcessedCount = 0;
    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '') }))
      .on('data', (row) => {
        gameStatsRows.push(row);
        const gid = parseInt(row.gid, 10);
        if (!isNaN(gid)) {
            processedGidsSet.add(gid);
        }
      })
      .on('end', async () => {
        console.log(`CSV file successfully parsed. ${gameStatsRows.length} rows found. ${processedGidsSet.size} unique GIDs collected.`);
        if (gameStatsRows.length === 0) { resolve(0); return; }

        // Use cacheService here
        if (Object.keys(cacheService.getTeamAbbrevCache()).length === 0) {
            console.log('Team cache is empty in processPlayerGameStats, attempting refresh from cacheService...');
            await cacheService.refreshTeamCache(client);
        }
        
        const currentTeamCache = cacheService.getTeamAbbrevCache(); // Get the cache once

        for (const row of gameStatsRows) {
          try {
            const playerPid = parseInt(row.pid, 10); const gameGid = parseInt(row.gid, 10);
            const season = parseInt(row.Season, 10);
            const playoffs = row.Playoffs && row.Playoffs.trim() !== '' && row.Playoffs !== '0' ? true : false;
            if (isNaN(playerPid) || isNaN(gameGid) || isNaN(season)) {
              console.warn('PGS: Skipping CSV row for invalid pid/gid/season:', {pid: row.pid, gid: row.gid, season: row.Season, name: row.Name});
              continue;
            }
            const teamAbbrevFromCSV = row.Team ? row.Team.trim().toUpperCase() : null;
            const oppAbbrevFromCSV = row.Opp ? row.Opp.trim().toUpperCase() : null;
            
            const teamTid = teamAbbrevFromCSV ? currentTeamCache[teamAbbrevFromCSV] : null; // Use currentTeamCache
            const oppTid = oppAbbrevFromCSV ? currentTeamCache[oppAbbrevFromCSV] : null;   // Use currentTeamCache

            if (teamTid === null || teamTid === undefined) {
              if (teamAbbrevFromCSV === 'BC') { // Debug for BC
                  console.log(`DEBUG LOOKUP (PGS): Failed for 'BC'. Original CSV Team: '${row.Team}'. Processed Abbrev: '${teamAbbrevFromCSV}'. Cache has 'BC' (hasOwnProperty)?: ${currentTeamCache.hasOwnProperty('BC')}, Cache 'BC' value: ${currentTeamCache['BC']}`);
              }
              console.warn(`PGS: Could not find bbgm_tid for team abbrev: '${row.Team}' (as '${teamAbbrevFromCSV}') for player ${playerPid} (${row.Name}), game ${gameGid}. Skipping.`);
              continue;
            }
            const fgm = parseInt(row.FGM || 0, 10); const fga = parseInt(row.FGA || 0, 10);
            const tpm = parseInt(row['3PM'] || 0, 10); const tpa = parseInt(row['3PA'] || 0, 10);
            const ftm = parseInt(row.FTM || 0, 10); const fta = parseInt(row.FTA || 0, 10);
            const orb = parseInt(row.ORB || 0, 10); const drb = parseInt(row.DRB || 0, 10);
            const trb_csv = parseInt(row.TRB || (orb + drb), 10);
            const fgp = fga > 0 ? (fgm / fga) : 0.0; const tpp = tpa > 0 ? (tpm / tpa) : 0.0; const ftp = fta > 0 ? (ftm / fta) : 0.0;
            const query = ` INSERT INTO player_game_stats ( player_game_stat_id, player_pid_link, bbgm_gid, season_year, playoffs, team_tid_link, opponent_tid_link, minutes_played, points, fgm, fga, fgp, tpm, tpa, tpp, ftm, fta, ftp, orb, drb_stat, trb, ast, stl, blk, tov_stat, pf_stat, plus_minus, updated_at ) VALUES ( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW() ) ON CONFLICT (player_pid_link, bbgm_gid, playoffs) DO UPDATE SET season_year = EXCLUDED.season_year, team_tid_link = EXCLUDED.team_tid_link, opponent_tid_link = EXCLUDED.opponent_tid_link, minutes_played = EXCLUDED.minutes_played, points = EXCLUDED.points, fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fgp = EXCLUDED.fgp, tpm = EXCLUDED.tpm, tpa = EXCLUDED.tpa, tpp = EXCLUDED.tpp, ftm = EXCLUDED.ftm, fta = EXCLUDED.fta, ftp = EXCLUDED.ftp, orb = EXCLUDED.orb, drb_stat = EXCLUDED.drb_stat, trb = EXCLUDED.trb, ast = EXCLUDED.ast, stl = EXCLUDED.stl, blk = EXCLUDED.blk, tov_stat = EXCLUDED.tov_stat, pf_stat = EXCLUDED.pf_stat, plus_minus = EXCLUDED.plus_minus, updated_at = NOW() RETURNING player_game_stat_id;`;
            const values = [
              uuidv4(), playerPid, gameGid, season, playoffs, teamTid, oppTid,
              parseFloat(row.Min || 0), parseInt(row.PTS || 0, 10), fgm, fga, parseFloat(fgp.toFixed(3)),
              tpm, tpa, parseFloat(tpp.toFixed(3)), ftm, fta, parseFloat(ftp.toFixed(3)), orb, drb, trb_csv,
              parseInt(row.AST || 0, 10), parseInt(row.STL || 0, 10), parseInt(row.BLK || 0, 10),
              parseInt(row.TO || 0, 10), parseInt(row.PF || 0, 10), parseInt(row['+/-'] || 0, 10)
            ];
            const result = await client.query(query, values);
            if (result.rows.length > 0) rowsProcessedCount++;
          } catch (dbErr) {
            console.error(`Error processing CSV row for player ${row.pid} (${row.Name}), game ${row.gid}:`, dbErr.message);
            throw dbErr;
          }
        }
        console.log(`--- Exiting processPlayerGameStats, Records processed: ${rowsProcessedCount} ---`);
        resolve(rowsProcessedCount);
      }).on('error', (err) => { console.error('Error reading CSV stream:', err); reject(err); });
  });
}

async function calculateAndStoreTeamGameStats(client, relevantGameGids = []) {
  console.log('--- Entering calculateAndStoreTeamGameStats ---');
  if (!Array.isArray(relevantGameGids) || relevantGameGids.length === 0) {
    console.log('calculateAndStoreTeamGameStats: No specific game GIDs provided. Exiting.');
    return 0;
  }
  const gamesToProcessQuery = `
    SELECT go.bbgm_gid, go.season_year, go.playoffs, 
           go.home_team_tid, go.away_team_tid,
           go.home_score, go.away_score
    FROM games go
    WHERE go.bbgm_gid = ANY($1::int[])
    ORDER BY go.bbgm_gid;`;
  const queryParams = [relevantGameGids];
  const gameOutcomesResult = await client.query(gamesToProcessQuery, queryParams);
  console.log(`calculateAndStoreTeamGameStats: Found ${gameOutcomesResult.rows.length} game outcomes to process for team stats from GID list.`);
  if (gameOutcomesResult.rows.length === 0) {
    return 0;
  }
  let teamGameStatsUpsertedCount = 0;
  for (const game of gameOutcomesResult.rows) {
    // console.log(`Calculating team stats for GID: ${game.bbgm_gid}, Season: ${game.season_year}, Playoffs: ${game.playoffs}`);
    const teamsInGame = [
      { tid: game.home_team_tid, isHome: true, officialScore: game.home_score, opponentOfficialScore: game.away_score, opponentTid: game.away_team_tid },
      { tid: game.away_team_tid, isHome: false, officialScore: game.away_score, opponentOfficialScore: game.home_score, opponentTid: game.home_team_tid }
    ];
    const teamStatsBuffer = {};
    for (const teamInfo of teamsInGame) {
      const playerStatsResult = await client.query(
        `SELECT fgm, fga, tpm, tpa, ftm, fta, orb, drb_stat, trb, ast, tov_stat, stl, blk, pf_stat 
         FROM player_game_stats 
         WHERE bbgm_gid = $1 AND team_tid_link = $2 AND playoffs = $3 AND season_year = $4`,
        [game.bbgm_gid, teamInfo.tid, game.playoffs, game.season_year]
      );
      // console.log(`  Team TID: ${teamInfo.tid} in GID: ${game.bbgm_gid} - Found ${playerStatsResult.rows.length} player_game_stats rows for aggregation.`);
      const agg = { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, trb: 0, ast: 0, tov: 0, stl: 0, blk: 0, pf: 0 };
      playerStatsResult.rows.forEach(ps => {
        agg.fgm += ps.fgm || 0; agg.fga += ps.fga || 0; agg.tpm += ps.tpm || 0; agg.tpa += ps.tpa || 0;
        agg.ftm += ps.ftm || 0; agg.fta += ps.fta || 0; agg.orb += ps.orb || 0; agg.drb += ps.drb_stat || 0;
        agg.trb += ps.trb || 0; agg.ast += ps.ast || 0; agg.tov += ps.tov_stat || 0;
        agg.stl += ps.stl || 0; agg.blk += ps.blk || 0; agg.pf += ps.pf_stat || 0;
      });
      const possessions = (agg.fga) - (agg.orb) + (agg.tov) + (0.44 * agg.fta);
      teamStatsBuffer[teamInfo.tid] = { ...agg, possessions: possessions };
    }
    for (const teamInfo of teamsInGame) {
        const currentTeamAgg = teamStatsBuffer[teamInfo.tid];
        const opponentAgg = teamStatsBuffer[teamInfo.opponentTid];
        if (!currentTeamAgg) {
            console.warn(`calculateAndStoreTeamGameStats: Missing aggregated stats buffer for team ${teamInfo.tid} in game ${game.bbgm_gid}. Skipping UPSERT.`);
            continue;
        }
        const possessions = currentTeamAgg.possessions;
        const opponentPossessions = opponentAgg ? opponentAgg.possessions : 1;
        const offRating = (possessions !== 0 && typeof possessions === 'number') ? (teamInfo.officialScore / possessions) * 100 : 0;
        const defRating = (opponentPossessions !== 0 && typeof opponentPossessions === 'number') ? (teamInfo.opponentOfficialScore / opponentPossessions) * 100 : 0;
        const calculated_fgp = currentTeamAgg.fga > 0 ? (currentTeamAgg.fgm / currentTeamAgg.fga) : 0;
        const calculated_tpp = currentTeamAgg.tpa > 0 ? (currentTeamAgg.tpm / currentTeamAgg.tpa) : 0;
        const calculated_ftp = currentTeamAgg.fta > 0 ? (currentTeamAgg.ftm / currentTeamAgg.fta) : 0;
        const upsertQuery = `
        INSERT INTO team_game_stats (
            team_game_stat_id, bbgm_gid, team_tid_link, opponent_tid_link, season_year, playoffs, is_home_team,
            pts_for, pts_against, fgm, fga, fgp, tpm, tpa, tpp, ftm, fta, ftp,
            orb, drb, trb, ast, stl, blk, tov, pf,
            possessions, off_rating, def_rating, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, NOW())
        ON CONFLICT (bbgm_gid, team_tid_link, playoffs) DO UPDATE SET
            opponent_tid_link = EXCLUDED.opponent_tid_link, is_home_team = EXCLUDED.is_home_team,
            pts_for = EXCLUDED.pts_for, pts_against = EXCLUDED.pts_against, fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fgp = EXCLUDED.fgp,
            tpm = EXCLUDED.tpm, tpa = EXCLUDED.tpa, tpp = EXCLUDED.tpp, ftm = EXCLUDED.ftm, fta = EXCLUDED.fta, ftp = EXCLUDED.ftp,
            orb = EXCLUDED.orb, drb = EXCLUDED.drb, trb = EXCLUDED.trb, ast = EXCLUDED.ast, stl = EXCLUDED.stl, blk = EXCLUDED.blk,
            tov = EXCLUDED.tov, pf = EXCLUDED.pf, possessions = EXCLUDED.possessions, off_rating = EXCLUDED.off_rating, 
            def_rating = EXCLUDED.def_rating, updated_at = NOW()
        RETURNING team_game_stat_id;`;
        const upsertValues = [
            uuidv4(), game.bbgm_gid, teamInfo.tid, teamInfo.opponentTid, game.season_year, game.playoffs, teamInfo.isHome,
            teamInfo.officialScore, teamInfo.opponentOfficialScore,
            currentTeamAgg.fgm, currentTeamAgg.fga, parseFloat(calculated_fgp.toFixed(3)),
            currentTeamAgg.tpm, currentTeamAgg.tpa, parseFloat(calculated_tpp.toFixed(3)),
            currentTeamAgg.ftm, currentTeamAgg.fta, parseFloat(calculated_ftp.toFixed(3)),
            currentTeamAgg.orb, currentTeamAgg.drb, currentTeamAgg.trb,
            currentTeamAgg.ast, currentTeamAgg.stl, currentTeamAgg.blk, currentTeamAgg.tov, currentTeamAgg.pf,
            parseFloat(possessions.toFixed(1)), parseFloat(offRating.toFixed(2)), parseFloat(defRating.toFixed(2))
        ];
        try {
            const result = await client.query(upsertQuery, upsertValues);
            if (result.rows.length > 0) teamGameStatsUpsertedCount++;
        } catch (dbErr) {
            console.error(`Error UPSERTING team_game_stats for game ${game.bbgm_gid}, team ${teamInfo.tid}:`, dbErr.message); throw dbErr;
        }
    }
  }
  console.log(`--- Exiting calculateAndStoreTeamGameStats, Team game stat records UPSERTED: ${teamGameStatsUpsertedCount} ---`);
  return teamGameStatsUpsertedCount;
}

module.exports = {
    processPlayerGameStats,
    calculateAndStoreTeamGameStats
};
