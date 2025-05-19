//
//  importService.js
//  
//
//  Created by Brent Lane on 5/17/25.
//
const { v4: uuidv4 } = require('uuid');

async function processConferences(conferenceDataFromExport, teamDataFromExport, client) {
    console.log('--- Entering processConferences ---');
    let conferencesProcessed = 0;
    const foundCids = new Map();

    if (conferenceDataFromExport && Array.isArray(conferenceDataFromExport)) {
        conferenceDataFromExport.forEach(conf => {
            if (conf.cid !== undefined && conf.name) {
                foundCids.set(conf.cid, conf.name);
            }
        });
        console.log(`processConferences: Found ${foundCids.size} conferences from jsonData.conferences array.`);
    }

    if (teamDataFromExport && Array.isArray(teamDataFromExport)) {
        let foundInTeams = 0;
        teamDataFromExport.forEach(team => {
            if (team.cid !== undefined && !foundCids.has(team.cid)) {
                foundCids.set(team.cid, `Conference ${team.cid}`); // Generic name
                foundInTeams++;
            }
        });
        if(foundInTeams > 0) console.log(`processConferences: Added ${foundInTeams} additional unique CIDs from team data.`);
    }
    
    if (foundCids.size === 0) {
        console.log('processConferences: No conference data to process.');
        return 0;
    }

    console.log(`processConferences: Attempting to UPSERT ${foundCids.size} unique conferences.`);

    for (const [bbgmCid, confName] of foundCids.entries()) {
        const query = `
            INSERT INTO conferences (conference_id, bbgm_cid, name, is_juco_conference, updated_at)
            VALUES ($1, $2, $3, FALSE, NOW())
            ON CONFLICT (bbgm_cid) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, conferences.name), 
                updated_at = NOW()
            RETURNING conference_id;
        `;
        const values = [uuidv4(), bbgmCid, confName];
        try {
            const result = await client.query(query, values);
            if (result.rows.length > 0) {
                conferencesProcessed++;
            }
        } catch (err) {
            console.error(`Error processing conference bbgm_cid: ${bbgmCid} (Name: ${confName}):`, err.message);
            throw err;
        }
    }
    console.log(`--- Exiting processConferences, Records processed/updated: ${conferencesProcessed} ---`);
    return conferencesProcessed;
}

async function processTeams(teamsData, client) {
  if (!teamsData || !Array.isArray(teamsData)) {
    console.log('No teams data found in JSON or data is not an array.');
    return 0;
  }
  let teamsProcessed = 0;
  for (const team of teamsData) {
    if (team.tid < 0) continue;
    const teamColors = Array.isArray(team.colors) ? team.colors.slice(0, 3) : ['#000000', '#FFFFFF', '#808080'];
    const query = `
      INSERT INTO teams (
        team_id, bbgm_tid, bbgm_cid, bbgm_did, name, abbrev, region, 
        img_url, stadium_capacity, colors, pop, strategy, 
        wins_current_season, losses_current_season, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, 0), COALESCE($14, 0), NOW())
      ON CONFLICT (bbgm_tid) DO UPDATE SET
        bbgm_cid = EXCLUDED.bbgm_cid, bbgm_did = EXCLUDED.bbgm_did, name = EXCLUDED.name, abbrev = EXCLUDED.abbrev,
        region = EXCLUDED.region, img_url = EXCLUDED.img_url, stadium_capacity = EXCLUDED.stadium_capacity,
        colors = EXCLUDED.colors, pop = EXCLUDED.pop, strategy = EXCLUDED.strategy,
        wins_current_season = COALESCE(EXCLUDED.wins_current_season, teams.wins_current_season),
        losses_current_season = COALESCE(EXCLUDED.losses_current_season, teams.losses_current_season),
        updated_at = NOW()
      RETURNING team_id;`;
    const values = [
      uuidv4(), team.tid, team.cid, team.did, team.name, team.abbrev, team.region, team.imgURL,
      team.stadiumCapacity === undefined ? 0 : parseInt(team.stadiumCapacity, 10) || 0,
      teamColors, team.pop === undefined ? 0 : Math.round(parseFloat(team.pop || 0)),
      team.strategy, team.won, team.lost,
    ];
    try {
      const result = await client.query(query, values);
      if (result.rows.length > 0) teamsProcessed++;
    } catch (err) {
      console.error(`Error processing team ${team.name || 'Unknown'} (bbgm_tid: ${team.tid}):`, err.message);
      throw err;
    }
  }
  return teamsProcessed;
}

async function processPlayers(playersData, client) {
  if (!playersData || !Array.isArray(playersData)) {
    console.log('No players data found in JSON or data is not an array.');
    return 0;
  }
  let playersProcessed = 0;
  for (const player of playersData) {
    const currentRatings = player.ratings && player.ratings.length > 0
                         ? player.ratings[player.ratings.length - 1]
                         : {};
    const query = `
      INSERT INTO players (
        player_id, bbgm_pid, bbgm_tid, first_name, last_name, born_year, born_loc, high_school,
        current_contract_amount, current_contract_exp_year,
        draft_round, draft_pick, draft_year, draft_original_tid, draft_pot, draft_ovr,
        current_hgt, current_stre, current_spd, current_jmp, current_endu, current_ins,
        current_dnk, current_ft, current_fg, current_tp, current_oiq, current_diq,
        current_drb_rating, current_pss_rating, current_reb_rating, current_pot, current_ovr,
        jersey_number, injury_type, injury_games_remaining, bbgm_awards, watch, games_until_tradable,
        calculated_class_year, is_scholarship_player, is_redshirt, 
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36,
        $37, $38, $39, 
        NULL, FALSE, FALSE, NOW() 
      )
      ON CONFLICT (bbgm_pid) DO UPDATE SET
        bbgm_tid = EXCLUDED.bbgm_tid, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
        born_year = EXCLUDED.born_year, born_loc = EXCLUDED.born_loc, high_school = EXCLUDED.high_school,
        current_contract_amount = EXCLUDED.current_contract_amount, current_contract_exp_year = EXCLUDED.current_contract_exp_year,
        draft_round = EXCLUDED.draft_round, draft_pick = EXCLUDED.draft_pick, draft_year = EXCLUDED.draft_year,
        draft_original_tid = EXCLUDED.draft_original_tid, draft_pot = EXCLUDED.draft_pot, draft_ovr = EXCLUDED.draft_ovr,
        current_hgt = EXCLUDED.current_hgt, current_stre = EXCLUDED.current_stre, current_spd = EXCLUDED.current_spd,
        current_jmp = EXCLUDED.current_jmp, current_endu = EXCLUDED.current_endu, current_ins = EXCLUDED.current_ins,
        current_dnk = EXCLUDED.current_dnk, current_ft = EXCLUDED.current_ft, current_fg = EXCLUDED.current_fg,
        current_tp = EXCLUDED.current_tp, current_oiq = EXCLUDED.current_oiq, current_diq = EXCLUDED.current_diq,
        current_drb_rating = EXCLUDED.current_drb_rating, current_pss_rating = EXCLUDED.current_pss_rating,
        current_reb_rating = EXCLUDED.current_reb_rating, current_pot = EXCLUDED.current_pot, current_ovr = EXCLUDED.current_ovr,
        jersey_number = EXCLUDED.jersey_number, injury_type = EXCLUDED.injury_type,
        injury_games_remaining = EXCLUDED.injury_games_remaining, bbgm_awards = EXCLUDED.bbgm_awards,
        watch = EXCLUDED.watch, games_until_tradable = EXCLUDED.games_until_tradable,
        calculated_class_year = players.calculated_class_year, 
        is_scholarship_player = players.is_scholarship_player,
        is_redshirt = players.is_redshirt,
        updated_at = NOW()
      RETURNING player_id;`;
    const values = [
      uuidv4(), player.pid, player.tid, player.firstName, player.lastName,
      player.born ? player.born.year : null, player.born ? player.born.loc : null, player.college || null,
      player.contract ? player.contract.amount : null, player.contract ? player.contract.exp : null,
      player.draft ? player.draft.round : null, player.draft ? player.draft.pick : null, player.draft ? player.draft.year : null,
      player.draft ? player.draft.tid : null,
      player.draft ? player.draft.pot : null, player.draft ? player.draft.ovr : null,
      currentRatings.hgt, currentRatings.stre, currentRatings.spd, currentRatings.jmp, currentRatings.endu, currentRatings.ins,
      currentRatings.dnk, currentRatings.ft, currentRatings.fg, currentRatings.tp, currentRatings.oiq, currentRatings.diq,
      currentRatings.drb, currentRatings.pss, currentRatings.reb, currentRatings.pot, currentRatings.ovr,
      player.jerseyNo || null, player.injury ? player.injury.type : 'Healthy', player.injury ? player.injury.gamesRemaining : 0,
      player.awards ? JSON.stringify(player.awards) : '[]', player.watch || false, player.gamesUntilTradable || 0
    ];
    try {
      const result = await client.query(query, values);
      if (result.rows.length > 0) playersProcessed++;
    } catch (err) {
      console.error(`Error processing player ${player.firstName || 'N/A'} ${player.lastName || 'N/A'} (bbgm_pid: ${player.pid}):`, err.message);
      throw err;
    }
  }
  return playersProcessed;
}

async function processPlayerSeasonStats(playersData, client) {
  if (!playersData || !Array.isArray(playersData)) {
    return 0;
  }
  let seasonStatsProcessed = 0;
  for (const player of playersData) {
    if (!player.stats || !Array.isArray(player.stats) || player.stats.length === 0) {
      continue;
    }
    for (const seasonStat of player.stats) {
      if (player.pid === undefined || seasonStat.season === undefined || seasonStat.tid === undefined || seasonStat.playoffs === undefined) {
          console.warn(`PSS: Skipping for Player PID ${player.pid}, Season ${seasonStat.season}, TID ${seasonStat.tid}, Playoffs ${seasonStat.playoffs}`);
          continue;
      }
      const fgm = parseInt(seasonStat.fg || 0, 10); const fga = parseInt(seasonStat.fga || 0, 10);
      const tpm = parseInt(seasonStat.tp || 0, 10); const tpa = parseInt(seasonStat.tpa || 0, 10);
      const ftm = parseInt(seasonStat.ft || 0, 10); const fta = parseInt(seasonStat.fta || 0, 10);
      const orb = parseInt(seasonStat.orb || 0, 10); const drb_val = parseInt(seasonStat.drb || 0, 10);
      const fgp = fga > 0 ? (fgm / fga) : 0; const tpp = tpa > 0 ? (tpm / tpa) : 0; const ftp = fta > 0 ? (ftm / fta) : 0;
      const trb = orb + drb_val;
      const query = `
        INSERT INTO player_season_stats (
          player_season_stat_id, player_pid_link, season_year, team_tid_link, playoffs,
          gp, gs, min, fgm, fga, fgp, tpm, tpa, tpp, ftm, fta, ftp,
          orb, drb, trb, ast, stl, blk, tov, pf, pts, per, ewa, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, NOW())
        ON CONFLICT (player_pid_link, season_year, team_tid_link, playoffs) DO UPDATE SET
          gp = EXCLUDED.gp, gs = EXCLUDED.gs, min = EXCLUDED.min, fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fgp = EXCLUDED.fgp,
          tpm = EXCLUDED.tpm, tpa = EXCLUDED.tpa, tpp = EXCLUDED.tpp, ftm = EXCLUDED.ftm, fta = EXCLUDED.fta, ftp = EXCLUDED.ftp,
          orb = EXCLUDED.orb, drb = EXCLUDED.drb, trb = EXCLUDED.trb, ast = EXCLUDED.ast, stl = EXCLUDED.stl, blk = EXCLUDED.blk,
          tov = EXCLUDED.tov, pf = EXCLUDED.pf, pts = EXCLUDED.pts, per = EXCLUDED.per, ewa = EXCLUDED.ewa,
          updated_at = NOW()
        RETURNING player_season_stat_id;`;
      const values = [
        uuidv4(), player.pid, seasonStat.season, seasonStat.tid, seasonStat.playoffs,
        parseInt(seasonStat.gp || 0, 10), parseInt(seasonStat.gs || 0, 10), parseFloat(seasonStat.min || 0),
        fgm, fga, fgp, tpm, tpa, tpp, ftm, fta, ftp,
        orb, drb_val, trb,
        parseInt(seasonStat.ast || 0, 10), parseInt(seasonStat.stl || 0, 10), parseInt(seasonStat.blk || 0, 10),
        parseInt(seasonStat.tov || 0, 10), parseInt(seasonStat.pf || 0, 10), parseInt(seasonStat.pts || 0, 10),
        parseFloat(seasonStat.per || 0), parseFloat(seasonStat.ewa || 0)
      ];
      try {
        const result = await client.query(query, values);
        if (result.rows.length > 0) seasonStatsProcessed++;
      } catch (err) {
        console.error(`Error PSS for player_pid: ${player.pid}, season: ${seasonStat.season}, playoffs: ${seasonStat.playoffs}:`, err.message);
        throw err;
      }
    }
  }
  return seasonStatsProcessed;
}

async function processPlayedGames(playedGamesData, client) {
  console.log('--- Entering processPlayedGames (from importService) ---');
  if (!playedGamesData || !Array.isArray(playedGamesData)) {
    console.log('processPlayedGames: No playedGamesData (jsonData.games) array found or it is not an array. Exiting.');
    return 0;
  }
  console.log(`processPlayedGames: Processing ${playedGamesData.length} played games from JSON.`);
  
  let gamesProcessed = 0;
  for (const game of playedGamesData) {
    const playoffsStatus = typeof game.playoffs === 'boolean' ? game.playoffs : false;

    // Check for essential fields in the game object and its nested team objects
    if (game.gid === undefined ||
        !game.teams || !Array.isArray(game.teams) || game.teams.length !== 2 ||
        game.teams[0].tid === undefined || game.teams[1].tid === undefined ||
        game.teams[0].pts === undefined || game.teams[1].pts === undefined ||
        game.season === undefined) {
      console.warn('processPlayedGames: Skipping game record due to missing essential fields (gid, teams array, team tids/pts, season). Game GID:', game.gid);
      continue;
    }

    const homeTeamTid = game.teams[0].tid;
    const awayTeamTid = game.teams[1].tid;

    // Skip games involving "non-teams" like Free Agents (tid < 0)
    if (homeTeamTid < 0 || awayTeamTid < 0) {
      console.warn(`processPlayedGames: Skipping game GID ${game.gid} because it involves a non-standard team TID (HomeTID: ${homeTeamTid}, AwayTID: ${awayTeamTid}).`);
      continue;
    }

    const homeScore = parseInt(game.teams[0].pts, 10);
    const awayScore = parseInt(game.teams[1].pts, 10);
    
    let gameDate = null;
    if (game.day) { // Assuming game.day might be a string like "YYYY-MM-DD" or a directly parseable date format
        const parsedDate = new Date(game.day);
        // Check if the parsedDate is valid and falls within a reasonable year range
        if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 1900 && parsedDate.getFullYear() < 2200) {
             gameDate = parsedDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
        } else {
            // console.warn(`processPlayedGames: game.day "${game.day}" (gid ${game.gid}) resulted in an unlikely date, storing game_date as NULL.`);
        }
    }

    // UPSERT into the 'games' table (this table replaced 'game_outcomes')
    const query = `
      INSERT INTO games (
        game_id, bbgm_gid, season_year, playoffs,
        home_team_tid, away_team_tid, home_score, away_score, 
        game_date, status, source_of_truth, day_offset, updated_at 
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PLAYED', 'BBGM_PLAYED_GAME', $10, NOW())
      ON CONFLICT (bbgm_gid) DO UPDATE SET
        season_year = EXCLUDED.season_year,
        playoffs = EXCLUDED.playoffs,
        home_team_tid = EXCLUDED.home_team_tid,
        away_team_tid = EXCLUDED.away_team_tid,
        home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score,
        game_date = EXCLUDED.game_date, 
        status = 'PLAYED', 
        source_of_truth = 'BBGM_PLAYED_GAME',
        day_offset = EXCLUDED.day_offset, -- Also update day_offset if it's in game object
        updated_at = NOW()
      RETURNING game_id; 
    `;
    // Note: jsonData.games[i].day is usually the day offset for played games as well.
    // The `games` table schema has `day_offset INTEGER`.
    const dayOffset = game.day !== undefined ? parseInt(game.day, 10) : null;


    const values = [
      uuidv4(),       // $1 game_id
      game.gid,       // $2 bbgm_gid
      game.season,    // $3 season_year
      playoffsStatus, // $4 playoffs
      homeTeamTid,    // $5 home_team_tid
      awayTeamTid,    // $6 away_team_tid
      homeScore,      // $7 home_score
      awayScore,      // $8 away_score
      gameDate,       // $9 game_date
      dayOffset       // $10 day_offset
    ];

    try {
      const result = await client.query(query, values);
      if (result.rows.length > 0) {
        gamesProcessed++;
      }
    } catch (err) {
      console.error(`Error processing played game (formerly game_outcome) for bbgm_gid: ${game.gid}:`, err.message);
      // console.error("Problematic game object from jsonData.games:", JSON.stringify(game)); // For debugging
      throw err; // Re-throw to be caught by the main transaction handler in the controller
    }
  }
  console.log(`--- Exiting processPlayedGames, Records processed: ${gamesProcessed} ---`);
  return gamesProcessed;
}

// --- NEW function to process BBGM Auto Schedule (jsonData.schedule) ---
async function processBBGMAutoSchedule(bbgmScheduleData, client, currentSeason) {
    console.log('--- Entering processBBGMAutoSchedule (from importService) ---');
    if (!bbgmScheduleData || !Array.isArray(bbgmScheduleData)) {
        console.log('processBBGMAutoSchedule: No BBGM schedule data (jsonData.schedule) found. Exiting.');
        return 0;
    }
    console.log(`processBBGMAutoSchedule: Processing ${bbgmScheduleData.length} games from BBGM's schedule array for season ${currentSeason}.`);
    
    let gamesLinkedCount = 0; // Count of user-scheduled games that got a GID linked
    let bbgmScheduledGamesSkippedNoMatch = 0;

    for (const bbgmGame of bbgmScheduleData) {
        if (bbgmGame.gid === undefined || bbgmGame.homeTid === undefined || bbgmGame.awayTid === undefined || bbgmGame.day === undefined) {
            console.warn('processBBGMAutoSchedule: Skipping BBGM schedule entry due to missing gid, homeTid, awayTid, or day:', bbgmGame);
            continue;
        }

        if (bbgmGame.homeTid < 0 || bbgmGame.awayTid < 0) {
            // console.warn(`processBBGMAutoSchedule: Skipping BBGM scheduled game GID ${bbgmGame.gid} involving non-standard team TID (Home: ${bbgmGame.homeTid}, Away: ${bbgmGame.awayTid}).`);
            continue; // Silently skip these for now, or log if preferred
        }
        
        // Try to find a USER_SCHEDULED game in our DB that matches this BBGM slot and doesn't have a bbgm_gid yet
        // For matching, we'll use season, home_team_tid, away_team_tid, and day_offset.
        // Playoffs for jsonData.schedule are typically all regular season (false).
        const findUserScheduledQuery = `
            UPDATE games
            SET bbgm_gid = $1, 
                day_offset = $5, -- Update day_offset from BBGM's schedule if it was user-scheduled
                status = CASE 
                            WHEN status = 'USER_SCHEDULED' THEN 'USER_SCHEDULED_GID_LINKED' 
                            ELSE status 
                         END, -- Indicate GID is linked
                updated_at = NOW()
            WHERE home_team_tid = $2 
              AND away_team_tid = $3 
              AND season_year = $4 
              AND day_offset = $5 
              AND playoffs = FALSE 
              AND status = 'USER_SCHEDULED' -- Only match games explicitly scheduled by users
              AND bbgm_gid IS NULL           -- Only if not already linked
            RETURNING game_id; 
        `;
        
        const findUserScheduledValues = [bbgmGame.gid, bbgmGame.homeTid, bbgmGame.awayTid, currentSeason, bbgmGame.day];
        
        try {
            const updateResult = await client.query(findUserScheduledQuery, findUserScheduledValues);
            if (updateResult.rowCount > 0) {
                console.log(`processBBGMAutoSchedule: Linked BBGM GID ${bbgmGame.gid} to existing USER_SCHEDULED game for season ${currentSeason}, day ${bbgmGame.day}, ${bbgmGame.homeTid}v${bbgmGame.awayTid}.`);
                gamesLinkedCount++;
            } else {
                // If no USER_SCHEDULED game matched, we DISCARD this BBGM auto-scheduled game.
                // Our 'games' table will only contain USER_SCHEDULED games (until they are played)
                // or games directly from jsonData.games (played games).
                // console.log(`processBBGMAutoSchedule: BBGM GID ${bbgmGame.gid} (Day ${bbgmGame.day}, ${bbgmGame.homeTid}v${bbgmGame.awayTid}) did not match any unlinked user-scheduled game. Discarding BBGM default.`);
                bbgmScheduledGamesSkippedNoMatch++;
            }
        } catch (err) {
            console.error(`Error trying to link BBGM scheduled game GID ${bbgmGame.gid} for season ${currentSeason}:`, err.message);
            throw err;
        }
    }
    console.log(`--- Exiting processBBGMAutoSchedule, User games GID-linked: ${gamesLinkedCount}, BBGM default games discarded (no user match): ${bbgmScheduledGamesSkippedNoMatch} ---`);
    return gamesLinkedCount; // Return how many user games were successfully linked
}
// --- End NEW Helper function ---

// --- NEW Helper function to process league events ---
async function processLeagueEvents(eventsData, client) {
    console.log('--- Entering processLeagueEvents (from importService) ---');
    if (!eventsData || !Array.isArray(eventsData)) {
        console.log('processLeagueEvents: No events data (jsonData.events) found. Exiting.');
        return 0;
    }
    console.log(`processLeagueEvents: Processing ${eventsData.length} events.`);
    let eventsProcessed = 0;

    for (const event of eventsData) {
        // MODIFIED VALIDATION: Only check for eid, season, and type as essential. Text can be null.
        if (event.eid === undefined || event.season === undefined || !event.type) {
            console.warn('processLeagueEvents: Skipping event due to missing eid, season, or type:', event);
            continue;
        }

        // Use new UNIQUE constraint target: (bbgm_eid, season, event_type)
        const query = `
            INSERT INTO league_events (
                league_event_id, bbgm_eid, season, event_type, text, pids, tids, score, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (bbgm_eid, season, event_type) DO UPDATE SET 
                text = EXCLUDED.text, -- Update text if it changes (e.g. from null to actual)
                pids = EXCLUDED.pids,
                tids = EXCLUDED.tids,
                score = EXCLUDED.score,
                updated_at = NOW()
            RETURNING league_event_id;
        `;
        
        const pidsArray = Array.isArray(event.pids) ? event.pids : (event.pids !== undefined ? [event.pids] : []);
        const tidsArray = Array.isArray(event.tids) ? event.tids : (event.tids !== undefined ? [event.tids] : []);

        const values = [
            uuidv4(),
            event.eid,
            event.season,
            event.type,
            event.text || null, // Pass event.text or null if it's missing
            pidsArray,
            tidsArray,
            event.score !== undefined ? event.score : null
        ];

        try {
            const result = await client.query(query, values);
            if (result.rows.length > 0) {
                eventsProcessed++;
            }
        } catch (err) {
            console.error(`Error processing event eid: ${event.eid}, season: ${event.season}, type: ${event.type}:`, err.message);
            // console.error("Problematic event object:", JSON.stringify(event));
            throw err;
        }
    }
    console.log(`--- Exiting processLeagueEvents, Events processed/updated: ${eventsProcessed} ---`);
    return eventsProcessed;
}
// --- End NEW Helper function ---


module.exports = {
    processConferences,
    processTeams,
    processPlayers,
    processPlayerSeasonStats,
    processPlayedGames, // Renamed from processGameOutcomes
    processBBGMAutoSchedule, // NEW
    processLeagueEvents      // NEW
};
