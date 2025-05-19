-- backend/schema.sql
-- Full database schema for NCBCA Dashboard

-- Drop existing tables in an order that respects dependencies,
-- or use CASCADE to handle them automatically.
DROP TABLE IF EXISTS changelog_entries CASCADE;
DROP TABLE IF EXISTS team_game_stats CASCADE;
DROP TABLE IF EXISTS player_game_stats CASCADE;
DROP TABLE IF EXISTS games CASCADE; -- This table replaces 'game_outcomes'
DROP TABLE IF EXISTS league_events CASCADE;
DROP TABLE IF EXISTS player_season_stats CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS conferences CASCADE;
DROP TABLE IF EXISTS coaches CASCADE;
DROP TABLE IF EXISTS team_season_advanced_stats CASCADE;
--------------------------------------------------------------------------------
-- Table: coaches
--------------------------------------------------------------------------------
CREATE TABLE coaches (
    coach_id UUID PRIMARY KEY,
    discord_user_id VARCHAR(255) UNIQUE NOT NULL,
    discord_username VARCHAR(255),
    loyalty_score INTEGER DEFAULT 50,
    all_time_record_wins INTEGER DEFAULT 0,
    all_time_record_losses INTEGER DEFAULT 0,
    championships_won_ncbca INTEGER DEFAULT 0,
    coach_status VARCHAR(50) DEFAULT 'Active',           -- e.g., "Active", "Applicant", "Retired", "Banned"
    special_discord_roles TEXT[] DEFAULT '{}',          -- e.g., {"Admin", "Judging Panel"}
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_coaches_discord_user_id ON coaches(discord_user_id);

--------------------------------------------------------------------------------
-- Table: conferences
--------------------------------------------------------------------------------
CREATE TABLE conferences (
    conference_id UUID PRIMARY KEY,
    bbgm_cid INTEGER UNIQUE NOT NULL,                 -- Conference ID from BBGM (teams[j].cid)
    name VARCHAR(255),                                -- Conference name (e.g., "Big Sky", "JUCO League 1")
    is_juco_conference BOOLEAN NOT NULL DEFAULT FALSE, -- Flag to mark if this is a JUCO conference
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_conferences_bbgm_cid ON conferences(bbgm_cid);
CREATE INDEX idx_conferences_is_juco ON conferences(is_juco_conference);

--------------------------------------------------------------------------------
-- Table: teams
--------------------------------------------------------------------------------
CREATE TABLE teams (
    team_id UUID PRIMARY KEY,
    bbgm_tid INTEGER UNIQUE NOT NULL,
    bbgm_cid INTEGER, -- Conceptually links to conferences.bbgm_cid
    bbgm_did INTEGER,
    name VARCHAR(255) NOT NULL,
    abbrev VARCHAR(10) NOT NULL,
    region VARCHAR(255),
    img_url TEXT,
    stadium_capacity INTEGER,
    colors VARCHAR(25)[] DEFAULT '{}',
    pop BIGINT,
    strategy VARCHAR(50),
    coach_id UUID REFERENCES coaches(coach_id) ON DELETE SET NULL,
    prestige_score INTEGER DEFAULT 50,
    wins_current_season INTEGER DEFAULT 0,
    losses_current_season INTEGER DEFAULT 0,
    conf_wins_current_season INTEGER DEFAULT 0,
    conf_losses_current_season INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_teams_bbgm_tid ON teams(bbgm_tid);
CREATE INDEX idx_teams_coach_id ON teams(coach_id);
CREATE INDEX idx_teams_abbrev ON teams(abbrev);
CREATE INDEX idx_teams_bbgm_cid ON teams(bbgm_cid);

--------------------------------------------------------------------------------
-- Table: players
--------------------------------------------------------------------------------
CREATE TABLE players (
    player_id UUID PRIMARY KEY,
    bbgm_pid INTEGER UNIQUE NOT NULL,
    bbgm_tid INTEGER NOT NULL, -- Player's current team ID from BBGM
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    born_year INTEGER,
    born_loc VARCHAR(255),
    high_school VARCHAR(255),
    current_contract_amount INTEGER,
    current_contract_exp_year INTEGER,
    draft_round INTEGER,
    draft_pick INTEGER,
    draft_year INTEGER,
    draft_original_tid INTEGER,
    draft_pot INTEGER,
    draft_ovr INTEGER,
    current_hgt INTEGER,
    current_stre INTEGER,
    current_spd INTEGER,
    current_jmp INTEGER,
    current_endu INTEGER,
    current_ins INTEGER,
    current_dnk INTEGER,
    current_ft INTEGER,
    current_fg INTEGER,
    current_tp INTEGER,
    current_oiq INTEGER,
    current_diq INTEGER,
    current_drb_rating INTEGER,
    current_pss_rating INTEGER,
    current_reb_rating INTEGER,
    current_pot INTEGER,
    current_ovr INTEGER,
    jersey_number VARCHAR(5),
    injury_type VARCHAR(255) DEFAULT 'Healthy',
    injury_games_remaining INTEGER DEFAULT 0,
    bbgm_awards JSONB DEFAULT '[]',
    watch BOOLEAN DEFAULT FALSE,
    games_until_tradable INTEGER DEFAULT 0,
    calculated_class_year VARCHAR(50),
    is_scholarship_player BOOLEAN DEFAULT FALSE,
    is_redshirt BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_players_bbgm_pid ON players(bbgm_pid);
CREATE INDEX idx_players_bbgm_tid ON players(bbgm_tid);

--------------------------------------------------------------------------------
-- Table: player_season_stats
--------------------------------------------------------------------------------
CREATE TABLE player_season_stats (
    player_season_stat_id UUID PRIMARY KEY,
    player_pid_link INTEGER NOT NULL, -- REFERENCES players(bbgm_pid) ON DELETE CASCADE, (Consider adding FK later if data import order is guaranteed)
    season_year INTEGER NOT NULL,
    team_tid_link INTEGER NOT NULL,   -- REFERENCES teams(bbgm_tid) ON DELETE CASCADE, (Consider adding FK later)
    playoffs BOOLEAN NOT NULL DEFAULT FALSE,
    gp INTEGER DEFAULT 0,
    gs INTEGER DEFAULT 0,
    min DOUBLE PRECISION DEFAULT 0.0,
    fgm INTEGER DEFAULT 0,
    fga INTEGER DEFAULT 0,
    fgp DECIMAL(5,3) DEFAULT 0.0,     -- Calculated: FGM / FGA
    tpm INTEGER DEFAULT 0,
    tpa INTEGER DEFAULT 0,
    tpp DECIMAL(5,3) DEFAULT 0.0,     -- Calculated: 3PM / 3PA
    ftm INTEGER DEFAULT 0,
    fta INTEGER DEFAULT 0,
    ftp DECIMAL(5,3) DEFAULT 0.0,     -- Calculated: FTM / FTA
    orb INTEGER DEFAULT 0,
    drb INTEGER DEFAULT 0,            -- Player's defensive rebounds for that season stat line
    trb INTEGER DEFAULT 0,            -- Player's total rebounds for that season stat line (can be calculated ORB+DRB)
    ast INTEGER DEFAULT 0,
    stl INTEGER DEFAULT 0,
    blk INTEGER DEFAULT 0,
    tov INTEGER DEFAULT 0,            -- Turnovers
    pf INTEGER DEFAULT 0,             -- Personal Fouls
    pts INTEGER DEFAULT 0,
    per DOUBLE PRECISION DEFAULT 0.0, -- Player Efficiency Rating
    ewa DOUBLE PRECISION DEFAULT 0.0, -- Estimated Wins Added
    UNIQUE (player_pid_link, season_year, team_tid_link, playoffs),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pss_player_pid ON player_season_stats(player_pid_link);
CREATE INDEX idx_pss_season_year ON player_season_stats(season_year);
CREATE INDEX idx_pss_playoffs ON player_season_stats(playoffs);
CREATE INDEX idx_pss_team_tid ON player_season_stats(team_tid_link);

--------------------------------------------------------------------------------
-- Table: games (replaces 'game_outcomes' and holds scheduled & played games)
--------------------------------------------------------------------------------
CREATE TABLE games (
    game_id UUID PRIMARY KEY,
    bbgm_gid INTEGER UNIQUE, -- From BBGM JSON (jsonData.games[i].gid or jsonData.schedule[i].gid), NULLABLE for purely user-scheduled games not yet linked
    season_year INTEGER NOT NULL,
    playoffs BOOLEAN NOT NULL DEFAULT FALSE,
    home_team_tid INTEGER NOT NULL REFERENCES teams(bbgm_tid) ON DELETE CASCADE,
    away_team_tid INTEGER NOT NULL REFERENCES teams(bbgm_tid) ON DELETE CASCADE,
    home_score INTEGER,
    away_score INTEGER,
    game_date DATE,
    day_offset INTEGER,      -- For games from jsonData.schedule[i].day (if it's an offset)
    status VARCHAR(50) NOT NULL DEFAULT 'Scheduled', -- e.g., 'USER_SCHEDULED', 'BBGM_SCHEDULED', 'PLAYED', 'CANCELLED'
    source_of_truth VARCHAR(50), -- e.g., 'USER', 'BBGM_SCHEDULE', 'BBGM_PLAYED_GAME'
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_games_season_playoffs ON games(season_year, playoffs);
CREATE INDEX idx_games_home_team ON games(home_team_tid);
CREATE INDEX idx_games_away_team ON games(away_team_tid);
CREATE INDEX idx_games_bbgm_gid ON games(bbgm_gid);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_date ON games(game_date);
CREATE INDEX idx_games_day_offset ON games(day_offset);
-- For preventing duplicate scheduled games before a bbgm_gid is assigned:
CREATE UNIQUE INDEX idx_unique_scheduled_game ON games (season_year, home_team_tid, away_team_tid, day_offset, playoffs) WHERE bbgm_gid IS NULL;


--------------------------------------------------------------------------------
-- Table: player_game_stats (from CSV)
--------------------------------------------------------------------------------
CREATE TABLE player_game_stats (
    player_game_stat_id UUID PRIMARY KEY,
    player_pid_link INTEGER NOT NULL, -- Conceptually REFERENCES players(bbgm_pid)
    bbgm_gid INTEGER NOT NULL,        -- Should correspond to a game in games.bbgm_gid
    season_year INTEGER NOT NULL,
    playoffs BOOLEAN NOT NULL DEFAULT FALSE,
    team_tid_link INTEGER NOT NULL,   -- Conceptually REFERENCES teams(bbgm_tid)
    opponent_tid_link INTEGER,        -- Conceptually REFERENCES teams(bbgm_tid)
    game_date DATE,                   -- Optional, if CSV provides it directly
    minutes_played DOUBLE PRECISION DEFAULT 0.0,
    points INTEGER DEFAULT 0,
    fgm INTEGER DEFAULT 0,
    fga INTEGER DEFAULT 0,
    fgp DECIMAL(5,3) DEFAULT 0.0,     -- For storing calculated FG%
    tpm INTEGER DEFAULT 0,            -- 3 Pointers Made
    tpa INTEGER DEFAULT 0,            -- 3 Pointers Attempted
    tpp DECIMAL(5,3) DEFAULT 0.0,     -- For storing calculated 3P%
    ftm INTEGER DEFAULT 0,
    fta INTEGER DEFAULT 0,
    ftp DECIMAL(5,3) DEFAULT 0.0,     -- For storing calculated FT%
    orb INTEGER DEFAULT 0,
    drb_stat INTEGER DEFAULT 0,       -- From CSV 'DRB'
    trb INTEGER DEFAULT 0,            -- From CSV 'TRB'
    ast INTEGER DEFAULT 0,
    stl INTEGER DEFAULT 0,
    blk INTEGER DEFAULT 0,
    tov_stat INTEGER DEFAULT 0,       -- From CSV 'TO' (Turnovers)
    pf_stat INTEGER DEFAULT 0,        -- From CSV 'PF' (Personal Fouls)
    plus_minus INTEGER DEFAULT 0,     -- From CSV '+/-'
    UNIQUE (player_pid_link, bbgm_gid, playoffs),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    -- CONSTRAINT fk_pgs_bbgm_gid FOREIGN KEY (bbgm_gid) REFERENCES games(bbgm_gid) ON DELETE CASCADE -- Add if desired
);
CREATE INDEX idx_pgs_player_pid ON player_game_stats(player_pid_link);
CREATE INDEX idx_pgs_bbgm_gid ON player_game_stats(bbgm_gid);
CREATE INDEX idx_pgs_playoffs ON player_game_stats(playoffs);
CREATE INDEX idx_pgs_team_tid ON player_game_stats(team_tid_link);
CREATE INDEX idx_pgs_opponent_tid ON player_game_stats(opponent_tid_link);

--------------------------------------------------------------------------------
-- Table: team_game_stats (aggregated and calculated)
--------------------------------------------------------------------------------
CREATE TABLE team_game_stats (
    team_game_stat_id UUID PRIMARY KEY,
    bbgm_gid INTEGER NOT NULL REFERENCES games(bbgm_gid) ON DELETE CASCADE,
    team_tid_link INTEGER NOT NULL REFERENCES teams(bbgm_tid) ON DELETE CASCADE,
    opponent_tid_link INTEGER NOT NULL REFERENCES teams(bbgm_tid) ON DELETE CASCADE,
    season_year INTEGER NOT NULL,
    playoffs BOOLEAN NOT NULL DEFAULT FALSE,
    is_home_team BOOLEAN NOT NULL,
    pts_for INTEGER DEFAULT 0,
    pts_against INTEGER DEFAULT 0,
    fgm INTEGER DEFAULT 0,
    fga INTEGER DEFAULT 0,
    fgp DECIMAL(5,3) DEFAULT 0.0,
    tpm INTEGER DEFAULT 0,
    tpa INTEGER DEFAULT 0,
    tpp DECIMAL(5,3) DEFAULT 0.0,
    ftm INTEGER DEFAULT 0,
    fta INTEGER DEFAULT 0,
    ftp DECIMAL(5,3) DEFAULT 0.0,
    orb INTEGER DEFAULT 0,
    drb INTEGER DEFAULT 0,            -- Team's total defensive rebounds (sum of player drb_stats)
    trb INTEGER DEFAULT 0,            -- Team's total rebounds
    ast INTEGER DEFAULT 0,
    stl INTEGER DEFAULT 0,
    blk INTEGER DEFAULT 0,
    tov INTEGER DEFAULT 0,            -- Team's total turnovers
    pf INTEGER DEFAULT 0,             -- Team's total personal fouls
    possessions DECIMAL(6,1) DEFAULT 0.0,
    off_rating DECIMAL(7,2) DEFAULT 0.0,
    def_rating DECIMAL(7,2) DEFAULT 0.0,
    UNIQUE (bbgm_gid, team_tid_link, playoffs),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tgs_game_team ON team_game_stats(bbgm_gid, team_tid_link);
CREATE INDEX idx_tgs_season_playoffs_team ON team_game_stats(season_year, playoffs, team_tid_link);

--------------------------------------------------------------------------------
-- Table: league_events
--------------------------------------------------------------------------------
CREATE TABLE league_events (
    league_event_id UUID PRIMARY KEY,
    bbgm_eid INTEGER,
    season INTEGER NOT NULL,
    event_type VARCHAR(100),
    text TEXT NULL, -- Changed to NULLABLE
    pids INTEGER[] DEFAULT '{}',
    tids INTEGER[] DEFAULT '{}',
    score INTEGER,
    -- If eid is unique per season, this is good.
    -- If eid can repeat for different event types in the same season, add event_type
    UNIQUE (bbgm_eid, season, event_type),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_league_events_season_type ON league_events(season, event_type);
CREATE INDEX idx_league_events_pids ON league_events USING GIN (pids);
CREATE INDEX idx_league_events_tids ON league_events USING GIN (tids);

--------------------------------------------------------------------------------
-- Table: changelog_entries
--------------------------------------------------------------------------------
CREATE TABLE changelog_entries (
    changelog_entry_id UUID PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    coach_id_actor UUID REFERENCES coaches(coach_id) ON DELETE SET NULL,
    actor_username_snapshot VARCHAR(255),
    entity_type VARCHAR(100) NOT NULL,
    entity_id TEXT,
    action_type VARCHAR(100) NOT NULL,
    details_before_change JSONB,
    details_of_change JSONB,
    reason_for_manual_edit TEXT,
    ip_address_actor INET,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_changelog_entries_timestamp ON changelog_entries(timestamp);
CREATE INDEX idx_changelog_entries_entity_type_id ON changelog_entries(entity_type, entity_id);

CREATE TABLE team_season_advanced_stats (
    stat_id UUID PRIMARY KEY,
    team_tid_link INTEGER NOT NULL REFERENCES teams(bbgm_tid) ON DELETE CASCADE,
    season_year INTEGER NOT NULL,

    -- Core Adjusted Pomeroy-Style Metrics & Ranks
    adj_o DECIMAL(6,2),
    rank_adj_o INTEGER,
    adj_d DECIMAL(6,2),
    rank_adj_d INTEGER,
    adj_em DECIMAL(6,2),
    rank_overall_adj_em INTEGER,
    adj_tempo DECIMAL(5,1),
    rank_adj_tempo INTEGER,

    -- Four Factors (Offense) & Ranks
    efg_pct_off DECIMAL(5,3),
    rank_efg_pct_off INTEGER,
    tor_off DECIMAL(5,3),       -- Turnover Rate (lower is better for rank)
    rank_tor_off INTEGER,
    orb_pct_off DECIMAL(5,3),
    rank_orb_pct_off INTEGER,
    ftr_off DECIMAL(5,3),       -- Free Throw Rate
    rank_ftr_off INTEGER,

    -- Four Factors (Defense) & Ranks
    efg_pct_d DECIMAL(5,3),     -- Opponent eFG% (lower is better for rank)
    rank_efg_pct_d INTEGER,
    tor_d DECIMAL(5,3),         -- Opponent Turnover Rate (higher is better for rank)
    rank_tor_d INTEGER,
    drb_pct_d DECIMAL(5,3),     -- Defensive Rebound %
    rank_drb_pct_d INTEGER,
    ftr_d DECIMAL(5,3),         -- Opponent Free Throw Rate (lower is better for rank)
    rank_ftr_d INTEGER,

    -- Detailed Shooting (Offense)
    two_p_pct_off DECIMAL(5,3),
    three_p_pct_off DECIMAL(5,3),
    three_p_rate_off DECIMAL(5,3),
    
    -- Detailed Shooting (Defense)
    two_p_pct_d DECIMAL(5,3),
    three_p_pct_d DECIMAL(5,3),
    three_p_rate_d DECIMAL(5,3),

    -- Strength of Schedule & Record Metrics & Ranks
    raw_sos DECIMAL(6,4),
    rank_raw_sos INTEGER,
    adj_sos DECIMAL(6,2),
    rank_adj_sos INTEGER,
    adj_ncsos DECIMAL(6,2),
    rpi DECIMAL(6,4),
    rank_rpi INTEGER,
    sor_simplified DECIMAL(6,2),
    rank_sor_simplified INTEGER,

    -- Other Outcome-Based Metrics
    luck DECIMAL(5,2),
    wab DECIMAL(5,2),
    rank_wab INTEGER,

    -- Quadrant Records (Regular Season Only, typically)
    q1_wins INTEGER DEFAULT 0, q1_losses INTEGER DEFAULT 0,
    q2_wins INTEGER DEFAULT 0, q2_losses INTEGER DEFAULT 0,
    q3_wins INTEGER DEFAULT 0, q3_losses INTEGER DEFAULT 0,
    q4_wins INTEGER DEFAULT 0, q4_losses INTEGER DEFAULT 0,
    
    -- For context if needed (already in teamSeasonalAggregates in service)
    total_games_played INTEGER,
    total_pts_for INTEGER,
    total_pts_allowed INTEGER,

    last_calculated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (team_tid_link, season_year)
);

CREATE INDEX idx_tsas_team_season ON team_season_advanced_stats(team_tid_link, season_year);
CREATE INDEX idx_tsas_season_rank_adjem ON team_season_advanced_stats(season_year, rank_overall_adj_em);
CREATE INDEX idx_tsas_season_adjem ON team_season_advanced_stats(season_year, adj_em);
CREATE INDEX idx_tsas_season_rpi_rank ON team_season_advanced_stats(season_year, rank_rpi);
CREATE INDEX idx_tsas_season_sos_rank ON team_season_advanced_stats(season_year, rank_raw_sos);
