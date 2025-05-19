// backend/services/brentpomService.js
const db = require('../config/db');
const { v4: uuidv4 } = require('uuid'); // For saving results

// Constants
const HCA_POINTS = 1.4;
const NUM_ITERATIONS = 15;
const PYTHAGOREAN_EXPONENT = 13.91;
const WAB_SCALING_FACTOR = 15;

// RPI Weights
const RPI_WEIGHT_WP = 0.25;
const RPI_WEIGHT_OWP = 0.50;
const RPI_WEIGHT_OOWP = 0.25;
const RPI_WIN_HOME_WEIGHT = 0.6;
const RPI_WIN_AWAY_WEIGHT = 1.4;
// const RPI_WIN_NEUTRAL_WEIGHT = 1.0; // Not used as we assume H/A for now
const RPI_LOSS_HOME_WEIGHT = 1.4;
const RPI_LOSS_AWAY_WEIGHT = 0.6;
// const RPI_LOSS_NEUTRAL_WEIGHT = 1.0; // Not used


async function getActiveNonJucoTeams(client, seasonYear) {
    console.log(`brentpomService: Fetching active non-JUCO teams for season ${seasonYear}...`);
    const query = `
        SELECT t.bbgm_tid, t.name, t.abbrev, t.bbgm_cid 
        FROM teams t
        JOIN conferences c ON t.bbgm_cid = c.bbgm_cid
        WHERE c.is_juco_conference = FALSE;
    `;
    const result = await client.query(query);
    console.log(`brentpomService: Found ${result.rows.length} non-JUCO teams.`);
    return result.rows;
}

async function getAllTeamGameDataForSeason(client, seasonYear, teamTids) {
    console.log(`brentpomService: Fetching all game data for ${teamTids.length} teams in season ${seasonYear}...`);
    if (!teamTids || teamTids.length === 0) {
        return [];
    }
    const gamesWithTeamStatsQuery = `
        SELECT
            g.bbgm_gid, g.season_year, g.playoffs,
            g.home_team_tid, g.away_team_tid, g.home_score, g.away_score,
            htgs.possessions AS home_possessions, 
            COALESCE(htgs.pts_for, g.home_score) AS home_tgs_pts_for,
            htgs.fgm AS home_fgm, htgs.fga AS home_fga, htgs.tpm AS home_tpm, htgs.tpa AS home_tpa, 
            htgs.ftm AS home_ftm, htgs.fta AS home_fta, htgs.orb AS home_orb, htgs.drb AS home_drb, 
            htgs.tov AS home_tov,
            atgs.possessions AS away_possessions,
            COALESCE(atgs.pts_for, g.away_score) AS away_tgs_pts_for,
            atgs.fgm AS away_fgm, atgs.fga AS away_fga, atgs.tpm AS away_tpm, atgs.tpa AS away_tpa, 
            atgs.ftm AS away_ftm, atgs.fta AS away_fta, atgs.orb AS away_orb, atgs.drb AS away_drb, 
            atgs.tov AS away_tov
        FROM games g
        INNER JOIN team_game_stats htgs ON g.bbgm_gid = htgs.bbgm_gid 
            AND g.home_team_tid = htgs.team_tid_link 
            AND g.playoffs = htgs.playoffs 
            AND g.season_year = htgs.season_year
        INNER JOIN team_game_stats atgs ON g.bbgm_gid = atgs.bbgm_gid 
            AND g.away_team_tid = atgs.team_tid_link 
            AND g.playoffs = atgs.playoffs
            AND g.season_year = atgs.season_year
        WHERE g.season_year = $1
          AND (g.home_team_tid = ANY($2::int[]) OR g.away_team_tid = ANY($2::int[])) 
          AND g.status = 'PLAYED'
          AND g.home_team_tid >= 0 AND g.away_team_tid >= 0
          AND htgs.possessions > 0 AND atgs.possessions > 0; 
    `;
    const result = await client.query(gamesWithTeamStatsQuery, [seasonYear, teamTids]);
    // console.log(`brentpomService: Found ${result.rows.length} played game records with POSITIVE possessions for both teams in season ${seasonYear}.`);
    return result.rows.map(game => ({
        ...game,
        home_score: parseInt(game.home_score, 10),
        away_score: parseInt(game.away_score, 10),
        home_possessions: parseFloat(game.home_possessions),
        away_possessions: parseFloat(game.away_possessions),
        home_actual_pts: parseInt(game.home_score, 10),
        away_actual_pts: parseInt(game.away_score, 10),
        home_fgm: parseInt(game.home_fgm || 0, 10), home_fga: parseInt(game.home_fga || 0, 10),
        home_tpm: parseInt(game.home_tpm || 0, 10), home_tpa: parseInt(game.home_tpa || 0, 10),
        home_ftm: parseInt(game.home_ftm || 0, 10), home_fta: parseInt(game.home_fta || 0, 10),
        home_orb: parseInt(game.home_orb || 0, 10), home_drb: parseInt(game.home_drb || 0, 10),
        home_tov: parseInt(game.home_tov || 0, 10),
        away_fgm: parseInt(game.away_fgm || 0, 10), away_fga: parseInt(game.away_fga || 0, 10),
        away_tpm: parseInt(game.away_tpm || 0, 10), away_tpa: parseInt(game.away_tpa || 0, 10),
        away_ftm: parseInt(game.away_ftm || 0, 10), away_fta: parseInt(game.away_fta || 0, 10),
        away_orb: parseInt(game.away_orb || 0, 10), away_drb: parseInt(game.away_drb || 0, 10),
        away_tov: parseInt(game.away_tov || 0, 10),
    }));
}

async function calculateAdjustedEfficiencies(seasonYear, teams, gameData, hcaPoints, leagueAvgPpp, leagueAvgTempo) {
    // console.log(`brentpomService: Starting iterative adjustments for ${teams.length} teams, using ${gameData.length} filtered games.`);
    if (teams.length === 0 || gameData.length === 0 || isNaN(leagueAvgPpp) || isNaN(leagueAvgTempo)) {
        console.error('BrentpomService: Not enough teams/game data or invalid league averages for adjEff. LgAvgPPP:', leagueAvgPpp, 'LgAvgTempo:', leagueAvgTempo);
        return {};
    }
    const ratings = {};
    const teamGamePerformances = {};
    teams.forEach(team => {
        ratings[team.bbgm_tid] = { adjO: leagueAvgPpp, adjD: leagueAvgPpp, adjT: leagueAvgTempo, totalSeasonPossOff: 0.0 };
        teamGamePerformances[team.bbgm_tid] = { games: [] };
    });
    gameData.forEach(game => {
        const homeTid = game.home_team_tid; const awayTid = game.away_team_tid;
        if (!ratings[homeTid] || !ratings[awayTid]) return;
        const homePoss = game.home_possessions; const awayPoss = game.away_possessions;
        const homeOffPPP = (game.home_actual_pts / homePoss) * 100; const awayOffPPP = (game.away_actual_pts / awayPoss) * 100;
        const gameTempo = (homePoss + awayPoss) / 2.0;
        teamGamePerformances[homeTid].games.push({ gid: game.bbgm_gid, oppTid: awayTid, selfOffPPP: homeOffPPP, oppOffPPP: awayOffPPP, gameTempo: gameTempo, locationFactor: hcaPoints / 2.0, teamPoss: homePoss, oppPoss: awayPoss });
        teamGamePerformances[awayTid].games.push({ gid: game.bbgm_gid, oppTid: homeTid, selfOffPPP: awayOffPPP, oppOffPPP: homeOffPPP, gameTempo: gameTempo, locationFactor: -hcaPoints / 2.0, teamPoss: awayPoss, oppPoss: homePoss });
    });
    for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
        const nextRatingsIteration = {};
        for (const team of teams) {
            const tid = team.bbgm_tid;
            let sumWeightedAdjOffPPPValue = 0.0; let totalOffensivePossForTeam = 0.0;
            let sumWeightedAdjDefPPPValue = 0.0; let totalDefensivePossForTeam = 0.0;
            let sumAdjTempoGameValues = 0.0; let tempoGameCount = 0;
            const performances = teamGamePerformances[tid];
            if (performances && performances.games.length > 0) {
                performances.games.forEach(gamePerf => {
                    const oppTid = gamePerf.oppTid; if (!ratings[oppTid] || !ratings[tid]) return;
                    sumWeightedAdjOffPPPValue += (gamePerf.selfOffPPP - (ratings[oppTid].adjD - leagueAvgPpp) - gamePerf.locationFactor) * gamePerf.teamPoss;
                    totalOffensivePossForTeam += gamePerf.teamPoss;
                    sumWeightedAdjDefPPPValue += (gamePerf.oppOffPPP + (ratings[oppTid].adjO - leagueAvgPpp) + gamePerf.locationFactor) * gamePerf.oppPoss;
                    totalDefensivePossForTeam += gamePerf.oppPoss;
                    sumAdjTempoGameValues += gamePerf.gameTempo - (ratings[oppTid].adjT - leagueAvgTempo);
                    tempoGameCount++;
                });
                nextRatingsIteration[tid] = { adjO: totalOffensivePossForTeam > 0 ? (sumWeightedAdjOffPPPValue / totalOffensivePossForTeam) : leagueAvgPpp, adjD: totalDefensivePossForTeam > 0 ? (sumWeightedAdjDefPPPValue / totalDefensivePossForTeam) : leagueAvgPpp, adjT: tempoGameCount > 0 ? (sumAdjTempoGameValues / tempoGameCount) : leagueAvgTempo, totalPoss: totalOffensivePossForTeam };
            } else { nextRatingsIteration[tid] = { adjO: leagueAvgPpp, adjD: leagueAvgPpp, adjT: leagueAvgTempo, totalPoss: 0.0 }; }
        }
        let currentIterWeightedAvgO = 0.0; let currentIterWeightedAvgD = 0.0; let totalPossForNormalizationThisIter = 0.0;
        teams.forEach(team => {
            const tid = team.bbgm_tid; if (nextRatingsIteration[tid]) { if (nextRatingsIteration[tid].totalPoss > 0) { currentIterWeightedAvgO += nextRatingsIteration[tid].adjO * nextRatingsIteration[tid].totalPoss; currentIterWeightedAvgD += nextRatingsIteration[tid].adjD * nextRatingsIteration[tid].totalPoss; totalPossForNormalizationThisIter += nextRatingsIteration[tid].totalPoss; } else { currentIterWeightedAvgO += nextRatingsIteration[tid].adjO; currentIterWeightedAvgD += nextRatingsIteration[tid].adjD; totalPossForNormalizationThisIter += 1.0; } } });
        let correctionO = 0.0; let correctionD = 0.0;
        if (totalPossForNormalizationThisIter > 0) {
            const finalAvgO_iter = currentIterWeightedAvgO / totalPossForNormalizationThisIter; const finalAvgD_iter = currentIterWeightedAvgD / totalPossForNormalizationThisIter;
            correctionO = leagueAvgPpp - finalAvgO_iter; correctionD = leagueAvgPpp - finalAvgD_iter;
            teams.forEach(team => { const tid = team.bbgm_tid; if (nextRatingsIteration[tid]) { ratings[tid].adjO = nextRatingsIteration[tid].adjO + correctionO; ratings[tid].adjD = nextRatingsIteration[tid].adjD + correctionD; ratings[tid].adjT = nextRatingsIteration[tid].adjT; ratings[tid].totalSeasonPossOff = nextRatingsIteration[tid].totalPoss; } });
        }
    }
    const finalAdjustedRatings = {};
    teams.forEach(team => { const tid = team.bbgm_tid; if (ratings[tid]) { finalAdjustedRatings[tid] = { adjO: parseFloat(ratings[tid].adjO.toFixed(2)), adjD: parseFloat(ratings[tid].adjD.toFixed(2)), adjEM: parseFloat((ratings[tid].adjO - ratings[tid].adjD).toFixed(2)), adjTempo: parseFloat(ratings[tid].adjT.toFixed(1)), }; } else { finalAdjustedRatings[tid] = { adjO: leagueAvgPpp, adjD: leagueAvgPpp, adjEM: 0, adjTempo: leagueAvgTempo }; } });
    console.log('BrentpomService: Iterative adjustments complete.');
    return finalAdjustedRatings;
}

async function calculateFourFactorsAndShooting(seasonYear, teams, gameData) {
    // console.log(`brentpomService: Calculating Four Factors and Shooting % for ${teams.length} teams, using ${gameData.length} games.`);
    const teamSeasonalAggregates = {};
    teams.forEach(team => { teamSeasonalAggregates[team.bbgm_tid] = { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, tov: 0, ptsFor: 0, possessions: 0, game_count: 0, opp_ptsAllowed: 0, opp_fgm: 0, opp_fga: 0, opp_tpm: 0, opp_tpa: 0, opp_ftm: 0, opp_fta: 0, opp_orb: 0, opp_drb: 0, opp_tov: 0, opp_possessions: 0 }; });
    gameData.forEach(game => {
        if (teamSeasonalAggregates[game.home_team_tid]) {
            const homeAgg = teamSeasonalAggregates[game.home_team_tid];
            homeAgg.fgm += game.home_fgm; homeAgg.fga += game.home_fga; homeAgg.tpm += game.home_tpm; homeAgg.tpa += game.home_tpa;
            homeAgg.ftm += game.home_ftm; homeAgg.fta += game.home_fta; homeAgg.orb += game.home_orb; homeAgg.drb += game.home_drb;
            homeAgg.tov += game.home_tov; homeAgg.ptsFor += game.home_actual_pts;
            homeAgg.possessions += game.home_possessions; homeAgg.game_count++;
            homeAgg.opp_ptsAllowed += game.away_actual_pts;
            homeAgg.opp_fgm += game.away_fgm; homeAgg.opp_fga += game.away_fga; homeAgg.opp_tpm += game.away_tpm; homeAgg.opp_tpa += game.away_tpa;
            homeAgg.opp_ftm += game.away_ftm; homeAgg.opp_fta += game.away_fta; homeAgg.opp_orb += game.away_orb; homeAgg.opp_drb += game.away_drb;
            homeAgg.opp_tov += game.away_tov; homeAgg.opp_possessions += game.away_possessions;
        }
        if (teamSeasonalAggregates[game.away_team_tid]) {
            const awayAgg = teamSeasonalAggregates[game.away_team_tid];
            awayAgg.fgm += game.away_fgm; awayAgg.fga += game.away_fga; awayAgg.tpm += game.away_tpm; awayAgg.tpa += game.away_tpa;
            awayAgg.ftm += game.away_ftm; awayAgg.fta += game.away_fta; awayAgg.orb += game.away_orb; awayAgg.drb += game.away_drb;
            awayAgg.tov += game.away_tov; awayAgg.ptsFor += game.away_actual_pts;
            awayAgg.possessions += game.away_possessions;
            awayAgg.game_count++;
            awayAgg.opp_ptsAllowed += game.home_actual_pts;
            awayAgg.opp_fgm += game.home_fgm; awayAgg.opp_fga += game.home_fga; awayAgg.opp_tpm += game.home_tpm; awayAgg.opp_tpa += game.home_tpa;
            awayAgg.opp_ftm += game.home_ftm; awayAgg.opp_fta += game.home_fta; awayAgg.opp_orb += game.home_orb; awayAgg.opp_drb += game.home_drb;
            awayAgg.opp_tov += game.home_tov; awayAgg.opp_possessions += game.home_possessions;
        }
    });
    const results = {};
    teams.forEach(team => {
        const tid = team.bbgm_tid; const agg = teamSeasonalAggregates[tid];
        const default_factors = {
            efg_pct_off: 0, tor_off: 0, orb_pct_off: 0, ftr_off: 0,
            efg_pct_d: 0, tor_d: 0, drb_pct_d: 0, ftr_d: 0,
            two_p_pct_off: 0, three_p_pct_off: 0, three_p_rate_off: 0,
            two_p_pct_d: 0, three_p_pct_d: 0, three_p_rate_d: 0,
            total_pts_for: 0, total_pts_allowed: 0, total_games_played: 0
        };
        if (!agg || agg.game_count === 0) { results[tid] = default_factors; return; }
        const efg_pct_off = agg.fga > 0 ? (agg.fgm + 0.5 * agg.tpm) / agg.fga : 0; const tor_off = agg.possessions > 0 ? agg.tov / agg.possessions : 0; const orb_pct_off = (agg.orb + agg.opp_drb) > 0 ? agg.orb / (agg.orb + agg.opp_drb) : 0; const ftr_off = agg.fga > 0 ? agg.ftm / agg.fga : 0;
        const efg_pct_d = agg.opp_fga > 0 ? (agg.opp_fgm + 0.5 * agg.opp_tpm) / agg.opp_fga : 0; const tor_d = agg.opp_possessions > 0 ? agg.opp_tov / agg.opp_possessions : 0; const drb_pct_d = (agg.drb + agg.opp_orb) > 0 ? agg.drb / (agg.drb + agg.opp_orb) : 0; const ftr_d = agg.opp_fga > 0 ? agg.opp_ftm / agg.opp_fga : 0;
        const two_pm_off = agg.fgm - agg.tpm; const two_pa_off = agg.fga - agg.tpa; const two_p_pct_off = two_pa_off > 0 ? two_pm_off / two_pa_off : 0; const three_p_pct_off = agg.tpa > 0 ? agg.tpm / agg.tpa : 0; const three_p_rate_off = agg.fga > 0 ? agg.tpa / agg.fga : 0;
        const two_pm_d = agg.opp_fgm - agg.opp_tpm; const two_pa_d = agg.opp_fga - agg.opp_tpa; const two_p_pct_d = two_pa_d > 0 ? two_pm_d / two_pa_d : 0; const three_p_pct_d = agg.opp_tpa > 0 ? agg.opp_tpm / agg.opp_tpa : 0; const three_p_rate_d = agg.opp_fga > 0 ? agg.opp_tpa / agg.opp_fga : 0;
        results[tid] = {
            efg_pct_off: parseFloat(efg_pct_off.toFixed(3)), tor_off: parseFloat(tor_off.toFixed(3)), orb_pct_off: parseFloat(orb_pct_off.toFixed(3)), ftr_off: parseFloat(ftr_off.toFixed(3)),
            efg_pct_d: parseFloat(efg_pct_d.toFixed(3)), tor_d: parseFloat(tor_d.toFixed(3)), drb_pct_d: parseFloat(drb_pct_d.toFixed(3)), ftr_d: parseFloat(ftr_d.toFixed(3)),
            two_p_pct_off: parseFloat(two_p_pct_off.toFixed(3)), three_p_pct_off: parseFloat(three_p_pct_off.toFixed(3)), three_p_rate_off: parseFloat(three_p_rate_off.toFixed(3)),
            two_p_pct_d: parseFloat(two_p_pct_d.toFixed(3)), three_p_pct_d: parseFloat(three_p_pct_d.toFixed(3)), three_p_rate_d: parseFloat(three_p_rate_d.toFixed(3)),
            total_pts_for: agg.ptsFor, total_pts_allowed: agg.opp_ptsAllowed, total_games_played: agg.game_count
        };
    });
    // console.log('brentpomService: Four Factors and Shooting % (and seasonal aggregates) calculated.');
    return results;
}

async function calculateSOS_RPI_Components(seasonYear, teams, allGamesForSeason, client) {
    // console.log(`brentpomService: Calculating WP, OWP, OOWP for ${teams.length} teams, season ${seasonYear}...`);
    const teamRecords = {};
    const teamTidsInvolved = new Set(teams.map(t => t.bbgm_tid));
    teams.forEach(team => { teamRecords[team.bbgm_tid] = { w: 0, l: 0, weighted_w: 0.0, weighted_l: 0.0, gamesPlayed: 0, schedule: [] }; });
    allGamesForSeason.forEach(game => {
        if (!teamTidsInvolved.has(game.home_team_tid) || !teamTidsInvolved.has(game.away_team_tid)) { return; }
        const homeRecord = teamRecords[game.home_team_tid];
        if (homeRecord) { homeRecord.gamesPlayed++; homeRecord.schedule.push({ oppTid: game.away_team_tid, location: 'H' }); if (game.home_actual_pts > game.away_actual_pts) { homeRecord.w++; homeRecord.weighted_w += RPI_WIN_HOME_WEIGHT; } else { homeRecord.l++; homeRecord.weighted_l += RPI_LOSS_HOME_WEIGHT; } }
        const awayRecord = teamRecords[game.away_team_tid];
        if (awayRecord) { awayRecord.gamesPlayed++; awayRecord.schedule.push({ oppTid: game.home_team_tid, location: 'A' }); if (game.away_actual_pts > game.home_actual_pts) { awayRecord.w++; awayRecord.weighted_w += RPI_WIN_AWAY_WEIGHT; } else { awayRecord.l++; awayRecord.weighted_l += RPI_LOSS_AWAY_WEIGHT; } }
    });
    const teamCalculatedWPs = {};
    teams.forEach(team => {
        const tid = team.bbgm_tid; const record = teamRecords[tid];
        if (record && record.gamesPlayed > 0) { teamCalculatedWPs[tid] = { raw_wp: record.w / record.gamesPlayed, rpi_wp_numerator: record.weighted_w, rpi_wp_denominator: record.weighted_w + record.weighted_l, rpi_wp: (record.weighted_w + record.weighted_l) > 0 ? record.weighted_w / (record.weighted_w + record.weighted_l) : 0.0 }; }
        else { teamCalculatedWPs[tid] = { raw_wp: 0.0, rpi_wp_numerator: 0.0, rpi_wp_denominator: 0.0, rpi_wp: 0.0 }; }
    });
    const teamOWPs = {};
    teams.forEach(team => {
        const tid = team.bbgm_tid; const record = teamRecords[tid]; let sumOpponentRawWP = 0; let numOpponents = 0;
        if (record && record.schedule.length > 0) { record.schedule.forEach(gameScheduled => { const oppTid = gameScheduled.oppTid; if (teamCalculatedWPs[oppTid] && teamRecords[oppTid] && teamRecords[oppTid].gamesPlayed > 0) { sumOpponentRawWP += teamCalculatedWPs[oppTid].raw_wp; numOpponents++; } }); teamOWPs[tid] = numOpponents > 0 ? sumOpponentRawWP / numOpponents : 0.0; }
        else { teamOWPs[tid] = 0.0; }
    });
    const teamOOWPs = {};
    teams.forEach(team => {
        const tid = team.bbgm_tid; const record = teamRecords[tid]; let sumOpponentOWP = 0; let numOpponentsForOOWP = 0;
        if (record && record.schedule.length > 0) { record.schedule.forEach(gameScheduled => { const oppTid = gameScheduled.oppTid; if (teamOWPs.hasOwnProperty(oppTid)) { sumOpponentOWP += teamOWPs[oppTid]; numOpponentsForOOWP++; } }); teamOOWPs[tid] = numOpponentsForOOWP > 0 ? sumOpponentOWP / numOpponentsForOOWP : 0.0; }
        else { teamOOWPs[tid] = 0.0; }
    });
    // console.log('brentpomService: WP, OWP, OOWP calculated.');
    return { teamWPs: teamCalculatedWPs, teamOWPs, teamOOWPs, teamRecords };
}

function calculateRawSOS(owp, oowp) {
    if (typeof owp !== 'number' || typeof oowp !== 'number' || isNaN(owp) || isNaN(oowp)) return null;
    return (2/3 * owp) + (1/3 * oowp);
}

function calculateRPI(rpi_wp, owp, oowp) {
    if (typeof rpi_wp !== 'number' || typeof owp !== 'number' || typeof oowp !== 'number' || isNaN(rpi_wp) || isNaN(owp) || isNaN(oowp)) return null;
    return (rpi_wp * RPI_WEIGHT_WP) + (owp * RPI_WEIGHT_OWP) + (oowp * RPI_WEIGHT_OOWP);
}

function calculateLuck(actualWins, gamesPlayed, totalPtsFor, totalPtsAllowed, pythagoreanExponent) {
    if (gamesPlayed === 0) return null;
    if (totalPtsFor < 0) totalPtsFor = 0;
    if (totalPtsAllowed < 0) totalPtsAllowed = 0;
    let expectedWinPct;
    if (totalPtsFor === 0 && totalPtsAllowed === 0) { expectedWinPct = 0.5; }
    else if (totalPtsAllowed === 0 && totalPtsFor > 0) { expectedWinPct = 1.0; }
    else if (totalPtsFor === 0 && totalPtsAllowed > 0) { expectedWinPct = 0.0; }
    else {
         expectedWinPct = (Math.pow(totalPtsFor, pythagoreanExponent)) /
                           (Math.pow(totalPtsFor, pythagoreanExponent) + Math.pow(totalPtsAllowed, pythagoreanExponent));
    }
    if (isNaN(expectedWinPct)) { return null; }
    const expectedWins = expectedWinPct * gamesPlayed;
    return actualWins - expectedWins;
}

async function calculateAdjustedSOS(seasonYear, teams, gameData, adjustedEfficiencies, client) {
    // console.log('brentpomService: Calculating Adjusted SOS...');
    const adjSosResults = {};
    const teamConferenceMap = {};
    teams.forEach(t => { teamConferenceMap[t.bbgm_tid] = t.bbgm_cid; });
    for (const team of teams) {
        const tid = team.bbgm_tid; let sumOpponentAdjEM_All = 0; let gameCountSOS_All = 0;
        let sumOpponentAdjEM_NC = 0; let gameCountNCSOS_NC = 0;
        const teamGames = gameData.filter(g => g.home_team_tid === tid || g.away_team_tid === tid);
        for (const game of teamGames) {
            const opponentTid = (game.home_team_tid === tid) ? game.away_team_tid : game.home_team_tid;
            if (adjustedEfficiencies[opponentTid]) {
                const oppAdjEM = adjustedEfficiencies[opponentTid].adjEM;
                if (typeof oppAdjEM === 'number' && !isNaN(oppAdjEM)) {
                    sumOpponentAdjEM_All += oppAdjEM; gameCountSOS_All++;
                    const teamCid = teamConferenceMap[tid]; const oppCid = teamConferenceMap[opponentTid];
                    if (teamCid !== undefined && oppCid !== undefined && teamCid !== oppCid) { sumOpponentAdjEM_NC += oppAdjEM; gameCountNCSOS_NC++; }
                }
            }
        }
        adjSosResults[tid] = { adjSOS: gameCountSOS_All > 0 ? parseFloat((sumOpponentAdjEM_All / gameCountSOS_All).toFixed(2)) : null, adjNCSOS: gameCountNCSOS_NC > 0 ? parseFloat((sumOpponentAdjEM_NC / gameCountNCSOS_NC).toFixed(2)) : null, };
    }
    // console.log('brentpomService: Adjusted SOS calculated.');
    return adjSosResults;
}

function rankTeams(teams, metricsData, metricField, ascending = false) {
    const teamsWithMetric = teams.filter(team =>
        metricsData[team.bbgm_tid] &&
        metricsData[team.bbgm_tid].hasOwnProperty(metricField) && // Check if property exists
        typeof metricsData[team.bbgm_tid][metricField] === 'number' &&
        !isNaN(metricsData[team.bbgm_tid][metricField])
    );
    const sortedTeams = teamsWithMetric.sort((a, b) => {
        const metricA = metricsData[a.bbgm_tid][metricField];
        const metricB = metricsData[b.bbgm_tid][metricField];
        return ascending ? metricA - metricB : metricB - metricA;
    });
    const ranks = {};
    sortedTeams.forEach((team, index) => {
        ranks[team.bbgm_tid] = index + 1;
    });
    teams.forEach(team => { // Ensure all teams get an entry, even if null
        if (!ranks.hasOwnProperty(team.bbgm_tid)) {
            ranks[team.bbgm_tid] = null;
        }
    });
    return ranks;
}

async function calculateSimplifiedSOR(teams, gameData, adjustedEfficiencies) {
    // console.log('brentpomService: Calculating Simplified SOR...');
    const sorResults = {};
    for (const team of teams) {
        const tid = team.bbgm_tid; let sumAdjEMBeaten = 0; let winsCount = 0; let sumAdjEMLostTo = 0; let lossesCount = 0;
        const teamGames = gameData.filter(g => g.home_team_tid === tid || g.away_team_tid === tid);
        for (const game of teamGames) {
            const opponentTid = (game.home_team_tid === tid) ? game.away_team_tid : game.home_team_tid;
            const teamScore = (game.home_team_tid === tid) ? game.home_actual_pts : game.away_actual_pts;
            const oppScore = (game.home_team_tid === tid) ? game.away_actual_pts : game.home_actual_pts;
            if (adjustedEfficiencies[opponentTid] && typeof adjustedEfficiencies[opponentTid].adjEM === 'number') {
                if (teamScore > oppScore) { sumAdjEMBeaten += adjustedEfficiencies[opponentTid].adjEM; winsCount++; }
                else if (teamScore < oppScore) { sumAdjEMLostTo += adjustedEfficiencies[opponentTid].adjEM; lossesCount++; }
            }
        }
        const avgAdjEMBeaten = winsCount > 0 ? sumAdjEMBeaten / winsCount : 0;
        const avgAdjEMLostTo = lossesCount > 0 ? sumAdjEMLostTo / lossesCount : 0;
        sorResults[tid] = { sor_simplified: parseFloat((avgAdjEMBeaten - avgAdjEMLostTo).toFixed(2)) };
    }
    // console.log('brentpomService: Simplified SOR calculated.');
    return sorResults;
}

async function calculateWAB(seasonYear, teams, gameData, adjustedEfficiencies, teamRankingsByAdjEM, numNonJucoTeams, hcaPoints) {
    // console.log('brentpomService: Calculating WAB...');
    const wabResults = {}; let bubbleAdjEMSum = 0; let bubbleTeamCount = 0;
    const bubbleRankStart = 28; const bubbleRankEnd = Math.min(38, numNonJucoTeams);
    teams.forEach(team => {
        const rank = teamRankingsByAdjEM[team.bbgm_tid];
        if (rank && rank >= bubbleRankStart && rank <= bubbleRankEnd) {
            if (adjustedEfficiencies[team.bbgm_tid] && typeof adjustedEfficiencies[team.bbgm_tid].adjEM === 'number') {
                bubbleAdjEMSum += adjustedEfficiencies[team.bbgm_tid].adjEM; bubbleTeamCount++;
            }
        }
    });
    const bubbleTeamAdjEM = bubbleTeamCount > 0 ? bubbleAdjEMSum / bubbleTeamCount : 0;
    // console.log(`BrentpomService: Bubble Team AdjEM: ${bubbleTeamAdjEM.toFixed(2)} (from ${bubbleTeamCount} teams)`);
    const actualWinsMap = {}; teams.forEach(t => actualWinsMap[t.bbgm_tid] = { wins: 0 });
    gameData.forEach(game => { if (actualWinsMap.hasOwnProperty(game.home_team_tid) && actualWinsMap.hasOwnProperty(game.away_team_tid)) { if (game.home_actual_pts > game.away_actual_pts) { if(actualWinsMap[game.home_team_tid]) actualWinsMap[game.home_team_tid].wins++; } else if (game.away_actual_pts > game.home_actual_pts) { if(actualWinsMap[game.away_team_tid]) actualWinsMap[game.away_team_tid].wins++; } } });
    for (const team of teams) {
        const tid = team.bbgm_tid; let expectedBubbleWins = 0;
        const teamGames = gameData.filter(g => g.home_team_tid === tid || g.away_team_tid === tid);
        for (const game of teamGames) {
            const opponentTid = (game.home_team_tid === tid) ? game.away_team_tid : game.home_team_tid;
            const isHomeGameForBubbleTeamPerspective = (game.home_team_tid === tid);
            const opponentAdjEM = (adjustedEfficiencies[opponentTid] && typeof adjustedEfficiencies[opponentTid].adjEM === 'number') ? adjustedEfficiencies[opponentTid].adjEM : 0;
            let hcaEffect = 0; if (isHomeGameForBubbleTeamPerspective) hcaEffect = hcaPoints / 2; else hcaEffect = -hcaPoints / 2;
            const margin = bubbleTeamAdjEM - opponentAdjEM + hcaEffect;
            const winProbBubble = 1 / (1 + Math.pow(10, (-margin / WAB_SCALING_FACTOR)));
            expectedBubbleWins += winProbBubble;
        }
        const actualTeamWins = actualWinsMap[tid] ? actualWinsMap[tid].wins : 0;
        wabResults[tid] = { wab: parseFloat((actualTeamWins - expectedBubbleWins).toFixed(2)) };
    }
    // console.log('brentpomService: WAB calculated.');
    return wabResults;
}

async function calculateQuadrantRecords(seasonYear, teams, gameData, teamRankingsByAdjEM, numNonJucoTeams) {
    // console.log('brentpomService: Calculating Quadrant Records...');
    const quadrantResults = {};
    const q1HomeMaxRank = Math.max(1, Math.round(numNonJucoTeams * 0.08)); const q1RoadMaxRank = Math.max(1, Math.round(numNonJucoTeams * 0.21));
    const q2HomeMinRank = q1HomeMaxRank + 1; const q2HomeMaxRank = Math.max(q2HomeMinRank, Math.round(numNonJucoTeams * 0.21));
    const q2RoadMinRank = q1RoadMaxRank + 1; const q2RoadMaxRank = Math.max(q2RoadMinRank, Math.round(numNonJucoTeams * 0.37));
    const q3HomeMinRank = q2HomeMaxRank + 1; const q3HomeMaxRank = Math.max(q3HomeMinRank, Math.round(numNonJucoTeams * 0.44));
    const q3RoadMinRank = q2RoadMaxRank + 1; const q3RoadMaxRank = Math.max(q3RoadMinRank, Math.round(numNonJucoTeams * 0.66));
    // console.log(`Quadrant Cutoffs (numTeams: ${numNonJucoTeams}): Q1H(1-${q1HomeMaxRank}), Q1R(1-${q1RoadMaxRank}), Q2H(${q2HomeMinRank}-${q2HomeMaxRank}), Q2R(${q2RoadMinRank}-${q2RoadMaxRank}), Q3H(${q3HomeMinRank}-${q3HomeMaxRank}), Q3R(${q3RoadMinRank}-${q3RoadMaxRank})`);
    teams.forEach(team => { quadrantResults[team.bbgm_tid] = { q1_wins: 0, q1_losses: 0, q2_wins: 0, q2_losses: 0, q3_wins: 0, q3_losses: 0, q4_wins: 0, q4_losses: 0 }; });
    for (const game of gameData) {
        const homeTid = game.home_team_tid; const awayTid = game.away_team_tid;
        if (!quadrantResults[homeTid] || !quadrantResults[awayTid] || !teamRankingsByAdjEM[homeTid] || !teamRankingsByAdjEM[awayTid]) { continue; }
        const homeWin = game.home_actual_pts > game.away_actual_pts;
        const oppRankForHomeTeam = teamRankingsByAdjEM[awayTid]; const homeTeamRecord = quadrantResults[homeTid];
        if (oppRankForHomeTeam <= q1HomeMaxRank) { homeWin ? homeTeamRecord.q1_wins++ : homeTeamRecord.q1_losses++; }
        else if (oppRankForHomeTeam <= q2HomeMaxRank) { homeWin ? homeTeamRecord.q2_wins++ : homeTeamRecord.q2_losses++; }
        else if (oppRankForHomeTeam <= q3HomeMaxRank) { homeWin ? homeTeamRecord.q3_wins++ : homeTeamRecord.q3_losses++; }
        else { homeWin ? homeTeamRecord.q4_wins++ : homeTeamRecord.q4_losses++; }
        const oppRankForAwayTeam = teamRankingsByAdjEM[homeTid]; const awayTeamRecord = quadrantResults[awayTid];
        const awayWin = !homeWin;
        if (oppRankForAwayTeam <= q1RoadMaxRank) { awayWin ? awayTeamRecord.q1_wins++ : awayTeamRecord.q1_losses++; }
        else if (oppRankForAwayTeam <= q2RoadMaxRank) { awayWin ? awayTeamRecord.q2_wins++ : awayTeamRecord.q2_losses++; }
        else if (oppRankForAwayTeam <= q3RoadMaxRank) { awayWin ? awayTeamRecord.q3_wins++ : awayTeamRecord.q3_losses++; }
        else { awayWin ? awayTeamRecord.q4_wins++ : awayTeamRecord.q4_losses++; }
    }
    // console.log('brentpomService: Quadrant Records calculated.');
    return quadrantResults;
}

// --- NEW function to save all calculated advanced stats to the database ---
async function saveAdvancedStatsToDB(seasonYear, finalMetricsData, client) {
    console.log(`brentpomService: Saving advanced stats for ${Object.keys(finalMetricsData).length} teams for season ${seasonYear} to DB...`);
    let recordsUpserted = 0;

    const allColumnNames = [
        'stat_id', 'team_tid_link', 'season_year',
        'adj_o', 'rank_adj_o', 'adj_d', 'rank_adj_d', 'adj_em', 'rank_overall_adj_em', 'adj_tempo', 'rank_adj_tempo',
        'efg_pct_off', 'rank_efg_pct_off', 'tor_off', 'rank_tor_off', 'orb_pct_off', 'rank_orb_pct_off', 'ftr_off', 'rank_ftr_off',
        'efg_pct_d', 'rank_efg_pct_d', 'tor_d', 'rank_tor_d', 'drb_pct_d', 'rank_drb_pct_d', 'ftr_d', 'rank_ftr_d',
        'two_p_pct_off', 'three_p_pct_off', 'three_p_rate_off',
        'two_p_pct_d', 'three_p_pct_d', 'three_p_rate_d',
        'raw_sos', 'rank_raw_sos', 'adj_sos', 'rank_adj_sos', 'adj_ncsos',
        'rpi', 'rank_rpi', 'sor_simplified', 'rank_sor_simplified',
        'luck', 'wab', 'rank_wab',
        'q1_wins', 'q1_losses', 'q2_wins', 'q2_losses',
        'q3_wins', 'q3_losses', 'q4_wins', 'q4_losses',
        'total_games_played', 'total_pts_for', 'total_pts_allowed',
        'last_calculated_at'
    ]; // 52 columns (stat_id + 2 linking + 48 data + last_calculated_at)
      // My team_season_advanced_stats table has 52 columns as defined.

    const placeholders = allColumnNames.map((_, i) => `$${i + 1}`).join(', ');
    
    const updateSetClauses = allColumnNames.slice(3) // Skip stat_id, team_tid_link, season_year
        .map(colName => `${colName} = EXCLUDED.${colName}`)
        .join(', ');

    const query = `
        INSERT INTO team_season_advanced_stats (${allColumnNames.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT (team_tid_link, season_year) DO UPDATE SET
            ${updateSetClauses}
        RETURNING stat_id;
    `;

    for (const team_tid_str in finalMetricsData) {
        const team_tid = parseInt(team_tid_str, 10);
        const metrics = finalMetricsData[team_tid];

        const values = [
            uuidv4(), team_tid, seasonYear,
            metrics.adjO, metrics.rank_adj_o, metrics.adjD, metrics.rank_adj_d, metrics.adjEM, metrics.rank_overall_adj_em, metrics.adjTempo, metrics.rank_adj_tempo,
            metrics.efg_pct_off, metrics.rank_efg_pct_off, metrics.tor_off, metrics.rank_tor_off, metrics.orb_pct_off, metrics.rank_orb_pct_off, metrics.ftr_off, metrics.rank_ftr_off,
            metrics.efg_pct_d, metrics.rank_efg_pct_d, metrics.tor_d, metrics.rank_tor_d, metrics.drb_pct_d, metrics.rank_drb_pct_d, metrics.ftr_d, metrics.rank_ftr_d,
            metrics.two_p_pct_off, metrics.three_p_pct_off, metrics.three_p_rate_off,
            metrics.two_p_pct_d, metrics.three_p_pct_d, metrics.three_p_rate_d,
            metrics.raw_sos, metrics.rank_raw_sos, metrics.adj_sos, metrics.rank_adj_sos, metrics.adj_ncsos,
            metrics.rpi, metrics.rank_rpi, metrics.sor_simplified, metrics.rank_sor_simplified,
            metrics.luck, metrics.wab, metrics.rank_wab,
            metrics.q1_wins, metrics.q1_losses, metrics.q2_wins, metrics.q2_losses,
            metrics.q3_wins, metrics.q3_losses, metrics.q4_wins, metrics.q4_losses,
            metrics.total_games_played, metrics.total_pts_for, metrics.total_pts_allowed,
            new Date() // last_calculated_at
        ];
        
        const sanitizedValues = values.map(v => (v === undefined ? null : v));

        try {
            await client.query(query, sanitizedValues);
            recordsUpserted++;
        } catch (err) {
            console.error(`Error UPSERTING advanced stats for team ${team_tid}, season ${seasonYear}:`, err.message);
            console.error('Problematic metrics object for save:', metrics);
            // console.error('Problematic sanitized values array for save:', sanitizedValues); // Can be very verbose
            throw err;
        }
    }
    console.log(`brentpomService: Saved/Updated advanced stats for ${recordsUpserted} teams to DB.`);
    return recordsUpserted;
}
// --- End NEW function ---


async function calculateBrentpomForSeason(seasonYear) {
    console.log(`BrentpomService: Starting FULL BrentPom calculations for season: ${seasonYear}`);
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const teams = await getActiveNonJucoTeams(client, seasonYear);
        if (teams.length === 0) { console.log(`No non-JUCO teams for S${seasonYear}.`); await client.query('ROLLBACK'); client.release(); return { success: false, message: `No non-JUCO teams for S${seasonYear}.`}; }
        const numNonJucoTeams = teams.length;
        
        const gameData = await getAllTeamGameDataForSeason(client, seasonYear, teams.map(t => t.bbgm_tid));
        if (gameData.length === 0) { console.log(`No valid game data for S${seasonYear}.`); await client.query('ROLLBACK'); client.release(); return { success: false, message: `No valid game data for S${seasonYear}.`}; }
        
        let totalLeaguePoints = 0.0; let totalLeaguePossessions = 0.0;
        let tempGameTempoSum = 0.0; let tempGameTempoCount = 0;
        gameData.forEach(game => {
            totalLeaguePossessions += game.home_possessions + game.away_possessions;
            totalLeaguePoints += game.home_actual_pts + game.away_actual_pts;
            tempGameTempoSum += (game.home_possessions + game.away_possessions) / 2.0;
            tempGameTempoCount++;
        });
        const leagueAvgPpp = totalLeaguePossessions > 0 ? (totalLeaguePoints / totalLeaguePossessions) * 100 : 100.0;
        const leagueAvgTempo = tempGameTempoCount > 0 ? tempGameTempoSum / tempGameTempoCount : 65.0;
        // console.log(`BrentpomService: League Avgs: PPP=${leagueAvgPpp.toFixed(2)}, Tempo=${leagueAvgTempo.toFixed(1)}`);

        const adjustedEfficiencies = await calculateAdjustedEfficiencies(seasonYear, teams, gameData, HCA_POINTS, leagueAvgPpp, leagueAvgTempo);
        const fourFactorsAndShooting = await calculateFourFactorsAndShooting(seasonYear, teams, gameData);
        const { teamWPs, teamOWPs, teamOOWPs, teamRecords } = await calculateSOS_RPI_Components(seasonYear, teams, gameData, client);
        const adjustedSOSData = await calculateAdjustedSOS(seasonYear, teams, gameData, adjustedEfficiencies, client);
        
        const teamRankingsByAdjEM = rankTeams(teams, adjustedEfficiencies, 'adjEM', false);
        const teamRankingsByAdjO = rankTeams(teams, adjustedEfficiencies, 'adjO', false);
        const teamRankingsByAdjD = rankTeams(teams, adjustedEfficiencies, 'adjD', true);
        const teamRankingsByAdjT = rankTeams(teams, adjustedEfficiencies, 'adjTempo', false);

        const simplifiedSORData = await calculateSimplifiedSOR(teams, gameData, adjustedEfficiencies);
        const wabData = await calculateWAB(seasonYear, teams, gameData, adjustedEfficiencies, teamRankingsByAdjEM, numNonJucoTeams, HCA_POINTS);
        const quadrantData = await calculateQuadrantRecords(seasonYear, teams, gameData, teamRankingsByAdjEM, numNonJucoTeams);

        let tempFinalMetrics = {}; // Temporary object to hold metrics before assigning ranks that depend on other metrics
        teams.forEach(team => {
            const tid = team.bbgm_tid;
            const adjEff = adjustedEfficiencies[tid] || {};
            const factors = fourFactorsAndShooting[tid] || {};
            const wps = teamWPs[tid] || { rpi_wp: 0.0, raw_wp: 0.0 };
            const record = teamRecords[tid] || { w:0, gamesPlayed: 0 };
            const owp = teamOWPs[tid] || 0.0;
            const oowp = teamOOWPs[tid] || 0.0;
            const adjSOSInfo = adjustedSOSData[tid] || { adjSOS: null, adjNCSOS: null };
            const sorInfo = simplifiedSORData[tid] || { sor_simplified: null };
            const wabInfo = wabData[tid] || { wab: null };
            const quadInfo = quadrantData[tid] || { q1_wins: 0, q1_losses: 0, q2_wins: 0, q2_losses: 0, q3_wins: 0, q3_losses: 0, q4_wins: 0, q4_losses: 0 };

            const rawSOSValue = calculateRawSOS(owp, oowp);
            const rpiValue = calculateRPI(wps.rpi_wp, owp, oowp);
            const luckValue = calculateLuck(record.w, record.gamesPlayed, factors.total_pts_for, factors.total_pts_allowed, PYTHAGOREAN_EXPONENT);

            tempFinalMetrics[tid] = {
                adjO: adjEff.adjO, rank_adj_o: teamRankingsByAdjO[tid] || null,
                adjD: adjEff.adjD, rank_adj_d: teamRankingsByAdjD[tid] || null,
                adjEM: adjEff.adjEM, rank_overall_adj_em: teamRankingsByAdjEM[tid] || null,
                adjTempo: adjEff.adjTempo, rank_adj_tempo: teamRankingsByAdjT[tid] || null,
                
                efg_pct_off: factors.efg_pct_off, tor_off: factors.tor_off, orb_pct_off: factors.orb_pct_off, ftr_off: factors.ftr_off,
                efg_pct_d: factors.efg_pct_d, tor_d: factors.tor_d, drb_pct_d: factors.drb_pct_d, ftr_d: factors.ftr_d,
                two_p_pct_off: factors.two_p_pct_off, three_p_pct_off: factors.three_p_pct_off, three_p_rate_off: factors.three_p_rate_off,
                two_p_pct_d: factors.two_p_pct_d, three_p_pct_d: factors.three_p_pct_d, three_p_rate_d: factors.three_p_rate_d,
                
                raw_sos: rawSOSValue !== null ? parseFloat(rawSOSValue.toFixed(4)) : null,
                rpi: rpiValue !== null ? parseFloat(rpiValue.toFixed(4)) : null,
                luck: luckValue !== null ? parseFloat(luckValue.toFixed(2)) : null,
                adj_sos: adjSOSInfo.adjSOS,
                adj_ncsos: adjSOSInfo.adjNCSOS,
                wab: wabInfo.wab,
                sor_simplified: sorInfo.sor_simplified,
                ...quadInfo,
                total_games_played: factors.total_games_played,
                total_pts_for: factors.total_pts_for,
                total_pts_allowed: factors.total_pts_allowed,
            };
        });
        
        // Now calculate all ranks using tempFinalMetrics
        const finalMetricsToSave = {};
        const metricsToRankConfig = [
            { field: 'raw_sos', ascending: false, rankField: 'rank_raw_sos' },
            { field: 'rpi', ascending: false, rankField: 'rank_rpi' },
            { field: 'efg_pct_off', ascending: false, rankField: 'rank_efg_pct_off' },
            { field: 'tor_off', ascending: true, rankField: 'rank_tor_off' }, // Lower is better
            { field: 'orb_pct_off', ascending: false, rankField: 'rank_orb_pct_off' },
            { field: 'ftr_off', ascending: false, rankField: 'rank_ftr_off' },
            { field: 'efg_pct_d', ascending: true, rankField: 'rank_efg_pct_d' },    // Lower is better
            { field: 'tor_d', ascending: false, rankField: 'rank_tor_d' },      // Higher is better (force more TOs)
            { field: 'drb_pct_d', ascending: false, rankField: 'rank_drb_pct_d' },
            { field: 'ftr_d', ascending: true, rankField: 'rank_ftr_d' },      // Lower is better
            { field: 'sor_simplified', ascending: false, rankField: 'rank_sor_simplified' },
            { field: 'wab', ascending: false, rankField: 'rank_wab' }
        ];

        teams.forEach(team => {
            const tid = team.bbgm_tid;
            finalMetricsToSave[tid] = { ...tempFinalMetrics[tid] }; // Copy base metrics
        });

        metricsToRankConfig.forEach(metricInfo => {
            const ranksForMetric = rankTeams(teams, finalMetricsToSave, metricInfo.field, metricInfo.ascending);
            teams.forEach(team => {
                const tid = team.bbgm_tid;
                finalMetricsToSave[tid][metricInfo.rankField] = ranksForMetric[tid] || null;
            });
        });
        
        await saveAdvancedStatsToDB(seasonYear, finalMetricsToSave, client);
        
        if (teams.length > 0 && finalMetricsToSave[teams[0].bbgm_tid]) {
             console.log(`BrentpomService: Final Metrics Sample (after all calcs & ranks) for ${teams[0].abbrev} (TID ${teams[0].bbgm_tid}):`, finalMetricsToSave[teams[0].bbgm_tid]);
        }
        
        await client.query('COMMIT');
        console.log(`BrentpomService: All BrentPom metrics for season ${seasonYear} calculated and SAVED to DB.`);
        return {
            success: true,
            message: `All BrentPom metrics calculated and saved for season ${seasonYear}.`,
            data: finalMetricsToSave
        };

    } catch (error) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (rbError) { console.error('Error during ROLLBACK:', rbError); }
        }
        console.error(`BrentpomService: Error during BrentPom calculation for season ${seasonYear}:`, error.stack);
        throw error;
    } finally {
        if (client) { client.release(); }
    }
}

module.exports = {
    calculateBrentpomForSeason
};
