// backend/controllers/displayController.js
const db = require('../config/db');

const getConferences = async (req, res, next) => {
    try {
        const result = await db.query('SELECT conference_id, bbgm_cid, name, is_juco_conference FROM conferences ORDER BY name');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching conferences from DB:', err.stack);
        next(err);
    }
};

const getTeams = async (req, res, next) => {
    try {
        const query = `
            SELECT 
                t.team_id, 
                t.bbgm_tid, 
                t.name, 
                t.abbrev, 
                t.img_url, 
                t.bbgm_cid, 
                c.name AS conference_name, 
                c.is_juco_conference 
            FROM teams t
            LEFT JOIN conferences c ON t.bbgm_cid = c.bbgm_cid
            ORDER BY t.name;
        `;
        const result = await db.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching teams from DB:', err.stack);
        next(err);
    }
};

const getTeamDetailsByBbgmTid = async (req, res, next) => {
    const { bbgm_tid } = req.params;
    const parsedBbgmTid = parseInt(bbgm_tid);

    if (isNaN(parsedBbgmTid)) {
        return res.status(400).json({ error: 'Invalid team ID format.' });
    }
    try {
        const teamQuery = `
            SELECT 
                t.team_id, t.bbgm_tid, t.name, t.abbrev, t.img_url, t.region,
                t.stadium_capacity, t.colors, t.pop, t.strategy,
                t.wins_current_season, t.losses_current_season,
                c.bbgm_cid AS conference_bbgm_cid, c.name AS conference_name, c.is_juco_conference
            FROM teams t
            LEFT JOIN conferences c ON t.bbgm_cid = c.bbgm_cid
            WHERE t.bbgm_tid = $1;
        `;
        const teamResult = await db.query(teamQuery, [parsedBbgmTid]);
        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found.' });
        }
        const teamDetails = teamResult.rows[0];
        const seasonQuery = `
            SELECT MAX(season_year) as current_season 
            FROM team_game_stats 
            WHERE team_tid_link = $1 AND playoffs = FALSE;
        `;
        const seasonResult = await db.query(seasonQuery, [parsedBbgmTid]);
        const currentSeason = seasonResult.rows[0]?.current_season;
        let aggregatedSeasonStats = null;
        let recentGames = [];
        if (currentSeason) {
            const teamStatsQuery = `
                SELECT 
                    AVG(pts_for) as avg_pts_for, AVG(pts_against) as avg_pts_against,
                    AVG(off_rating) as avg_off_rating, AVG(def_rating) as avg_def_rating,
                    AVG(possessions) as avg_possessions,
                    SUM(CASE WHEN pts_for > pts_against THEN 1 ELSE 0 END) as calculated_wins,
                    SUM(CASE WHEN pts_for < pts_against THEN 1 ELSE 0 END) as calculated_losses,
                    COUNT(*) as games_played_for_stats
                FROM team_game_stats
                WHERE team_tid_link = $1 AND season_year = $2 AND playoffs = FALSE
                GROUP BY team_tid_link;
            `;
            const teamStatsResult = await db.query(teamStatsQuery, [parsedBbgmTid, currentSeason]);
            if (teamStatsResult.rows.length > 0) {
                aggregatedSeasonStats = teamStatsResult.rows[0];
            }
            const recentGamesQuery = `
                SELECT 
                    g.game_id, g.bbgm_gid, g.game_date, g.day_offset, g.status,
                    g.home_score, g.away_score,
                    ht.abbrev as home_team_abbrev, ht.bbgm_tid as home_bbgm_tid,
                    at.abbrev as away_team_abbrev, at.bbgm_tid as away_bbgm_tid,
                    CASE 
                        WHEN g.home_team_tid = $1 AND g.home_score > g.away_score THEN 'W'
                        WHEN g.away_team_tid = $1 AND g.away_score > g.home_score THEN 'W'
                        WHEN g.home_score IS NOT NULL AND g.away_score IS NOT NULL THEN 'L' 
                        ELSE NULL 
                    END as outcome_for_team
                FROM games g
                JOIN teams ht ON g.home_team_tid = ht.bbgm_tid
                JOIN teams at ON g.away_team_tid = at.bbgm_tid
                WHERE (g.home_team_tid = $1 OR g.away_team_tid = $1) 
                  AND g.season_year = $2
                  AND g.status = 'PLAYED' AND g.playoffs = FALSE
                ORDER BY COALESCE(g.game_date, MAKE_DATE(g.season_year, 1, 1) + (g.day_offset || ' days')::interval) DESC, g.bbgm_gid DESC
                LIMIT 10;
            `;
            const recentGamesResult = await db.query(recentGamesQuery, [parsedBbgmTid, currentSeason]);
            recentGames = recentGamesResult.rows;
        } else {
            // console.log(`No game stats found for team ${parsedBbgmTid} to determine current season for aggregated stats.`);
        }
        res.status(200).json({
            ...teamDetails,
            currentSeasonAggregatedStats: aggregatedSeasonStats,
            recentGames: recentGames
        });
    } catch (err) {
        console.error(`Error fetching details for team bbgm_tid ${parsedBbgmTid}:`, err.stack);
        next(err);
    }
};

const getTeamRosterByBbgmTid = async (req, res, next) => {
    const { bbgm_tid } = req.params;
    const parsedBbgmTid = parseInt(bbgm_tid);

    if (isNaN(parsedBbgmTid)) {
        return res.status(400).json({ error: 'Invalid team ID format.' });
    }
    try {
        const rosterQuery = `
            WITH MaxPlayerSeason AS (
                SELECT MAX(pss.season_year) as season
                FROM player_season_stats pss
                JOIN players p_join ON pss.player_pid_link = p_join.bbgm_pid
                WHERE p_join.bbgm_tid = $1 AND pss.playoffs = FALSE
            )
            SELECT 
                p.player_id, p.bbgm_pid, p.first_name, p.last_name, p.jersey_number,
                p.calculated_class_year, p.is_scholarship_player, p.is_redshirt,
                p.current_ovr, p.current_pot,
                COALESCE(pss.gp, 0) as gp, 
                ROUND(CAST(pss.pts AS DECIMAL) / NULLIF(pss.gp, 0), 1) AS ppg,
                ROUND(CAST(pss.trb AS DECIMAL) / NULLIF(pss.gp, 0), 1) AS rpg,
                ROUND(CAST(pss.ast AS DECIMAL) / NULLIF(pss.gp, 0), 1) AS apg
            FROM players p
            LEFT JOIN player_season_stats pss ON p.bbgm_pid = pss.player_pid_link 
                AND pss.season_year = (SELECT season FROM MaxPlayerSeason)
                AND pss.playoffs = FALSE 
                AND pss.team_tid_link = p.bbgm_tid 
            WHERE p.bbgm_tid = $1
            ORDER BY p.current_ovr DESC, p.last_name, p.first_name;
        `;
        const rosterResult = await db.query(rosterQuery, [parsedBbgmTid]);
        if (rosterResult.rows.length === 0) {
            const teamExistsResult = await db.query('SELECT 1 FROM teams WHERE bbgm_tid = $1', [parsedBbgmTid]);
            if (teamExistsResult.rows.length === 0) {
                return res.status(404).json({ error: 'Team not found.' });
            }
        }
        const roster = rosterResult.rows.map(player => ({
            ...player,
            ppg: player.ppg === null ? 0.0 : parseFloat(player.ppg),
            rpg: player.rpg === null ? 0.0 : parseFloat(player.rpg),
            apg: player.apg === null ? 0.0 : parseFloat(player.apg),
            gp: player.gp === null ? 0 : parseInt(player.gp)
        }));
        res.status(200).json(roster);
    } catch (err) {
        console.error(`Error fetching roster for team bbgm_tid ${parsedBbgmTid}:`, err.stack);
        next(err);
    }
};

// --- NEW FUNCTION for Player Details ---
const getPlayerDetailsByBbgmPid = async (req, res, next) => {
    const { bbgm_pid } = req.params;
    const parsedBbgmPid = parseInt(bbgm_pid);

    if (isNaN(parsedBbgmPid)) {
        return res.status(400).json({ error: 'Invalid player ID format.' });
    }

    try {
        // 1. Get core player details (including current team info)
        const playerDetailsQuery = `
            SELECT 
                p.*, 
                t.name AS team_name, 
                t.abbrev AS team_abbrev,
                t.bbgm_tid AS team_bbgm_tid,
                c.name AS conference_name,
                c.is_juco_conference
            FROM players p
            LEFT JOIN teams t ON p.bbgm_tid = t.bbgm_tid
            LEFT JOIN conferences c ON t.bbgm_cid = c.bbgm_cid
            WHERE p.bbgm_pid = $1;
        `;
        const playerDetailsResult = await db.query(playerDetailsQuery, [parsedBbgmPid]);

        if (playerDetailsResult.rows.length === 0) {
            return res.status(404).json({ error: 'Player not found.' });
        }
        const details = playerDetailsResult.rows[0];

        // 2. Get all season stats for the player
        const seasonStatsQuery = `
            SELECT 
                pss.*, 
                t.abbrev AS team_abbrev  -- Add team abbreviation for that season
            FROM player_season_stats pss
            LEFT JOIN teams t ON pss.team_tid_link = t.bbgm_tid
            WHERE pss.player_pid_link = $1
            ORDER BY pss.season_year ASC, pss.playoffs ASC; 
        `;
        const seasonStatsResult = await db.query(seasonStatsQuery, [parsedBbgmPid]);
        
        // 3. Get recent game stats for the player (e.g., last 10 games across all seasons, or current season)
        // For simplicity, let's get all game stats for the latest season the player has game stats for.
        const latestSeasonWithGameStatsQuery = `
            SELECT MAX(season_year) as latest_season 
            FROM player_game_stats 
            WHERE player_pid_link = $1 AND playoffs = FALSE;
        `;
        const latestSeasonResult = await db.query(latestSeasonWithGameStatsQuery, [parsedBbgmPid]);
        const latestGameStatSeason = latestSeasonResult.rows[0]?.latest_season;

        let recentGameStats = [];
        if (latestGameStatSeason) {
            const recentGameStatsQuery = `
                SELECT 
                    pgs.*, 
                    my_team.abbrev AS team_abbrev,
                    opp_team.abbrev AS opponent_abbrev,
                    g.home_score, 
                    g.away_score,
                    CASE 
                        WHEN pgs.team_tid_link = g.home_team_tid AND g.home_score > g.away_score THEN 'W'
                        WHEN pgs.team_tid_link = g.away_team_tid AND g.away_score > g.home_score THEN 'W'
                        WHEN g.home_score IS NOT NULL AND g.away_score IS NOT NULL THEN 'L'
                        ELSE NULL
                    END as game_outcome
                FROM player_game_stats pgs
                LEFT JOIN teams my_team ON pgs.team_tid_link = my_team.bbgm_tid
                LEFT JOIN teams opp_team ON pgs.opponent_tid_link = opp_team.bbgm_tid
                LEFT JOIN games g ON pgs.bbgm_gid = g.bbgm_gid AND pgs.playoffs = g.playoffs AND pgs.season_year = g.season_year 
                WHERE pgs.player_pid_link = $1 AND pgs.season_year = $2 AND pgs.playoffs = FALSE
                ORDER BY COALESCE(g.game_date, MAKE_DATE(pgs.season_year, 1, 1) + (g.day_offset || ' days')::interval) DESC, pgs.bbgm_gid DESC
                LIMIT 10; -- Last 10 regular season games from their latest season with game logs
            `;
            // Note: Joining player_game_stats with games table via bbgm_gid and playoffs/season for context like scores.
            // Assumes player_game_stats.game_date might be null and tries to use games.day_offset as fallback for ordering.
            // This part needs careful checking against your `games` table `day_offset` if `game_date` isn't reliably in `player_game_stats`.
            // For simplicity, I'll use the player_game_stats.game_date directly if it exists.
            const gameStatsQuerySimplified = `
                SELECT 
                    pgs.*,
                    my_team.abbrev AS team_abbrev,
                    opp_team.abbrev AS opponent_abbrev
                FROM player_game_stats pgs
                LEFT JOIN teams my_team ON pgs.team_tid_link = my_team.bbgm_tid
                LEFT JOIN teams opp_team ON pgs.opponent_tid_link = opp_team.bbgm_tid
                WHERE pgs.player_pid_link = $1 AND pgs.season_year = $2 AND pgs.playoffs = FALSE
                ORDER BY pgs.game_date DESC NULLS LAST, pgs.bbgm_gid DESC 
                LIMIT 10;
            `;

            const recentGameStatsResult = await db.query(gameStatsQuerySimplified, [parsedBbgmPid, latestGameStatSeason]);
            recentGameStats = recentGameStatsResult.rows;
        }

        res.status(200).json({
            details: details,
            season_stats: seasonStatsResult.rows,
            recent_game_stats: recentGameStats
        });

    } catch (err) {
        console.error(`Error fetching details for player bbgm_pid ${parsedBbgmPid}:`, err.stack);
        next(err);
    }
};


module.exports = {
    getConferences,
    getTeams,
    getTeamDetailsByBbgmTid,
    getTeamRosterByBbgmTid,
    getPlayerDetailsByBbgmPid // ADDED
};
