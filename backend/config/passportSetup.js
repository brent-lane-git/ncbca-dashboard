// backend/config/passportSetup.js
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const db = require('./db'); // Our database connection module
const { v4: uuidv4 } = require('uuid');
// const cacheService = require('../services/cacheService'); // Not directly used in this file

// Tells Passport how to save a user in the session
passport.serializeUser((user, done) => {
    // 'user' here is our 'coach' object from the database that the DiscordStrategy's verify callback provides
    done(null, user.coach_id); // We store the coach_id in the session
});

// Tells Passport how to retrieve a user from the session
passport.deserializeUser(async (coach_id, done) => {
    // coach_id is what we stored in the session via serializeUser
    try {
        const result = await db.query('SELECT * FROM coaches WHERE coach_id = $1', [coach_id]);
        if (result.rows.length > 0) {
            done(null, result.rows[0]); // Attaches the coach object to req.user
        } else {
            done(new Error('Failed to deserialize user: Coach not found.'), null);
        }
    } catch (err) {
        done(err, null);
    }
});

// Configure the Discord strategy for Passport
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email', 'guilds'] // Requesting basic user info, email, and servers they're in
},
async (accessToken, refreshToken, profile, done) => {
    // This 'verify' callback is called after Discord successfully authenticates the user.
    // 'profile' contains the user's Discord information (id, username, discriminator, email, guilds, etc.)

    // Construct the username based on modern Discord usernames vs. legacy discriminators
    let displayUsername;
    if (profile.discriminator && profile.discriminator !== "0" && profile.discriminator !== "0000") {
        displayUsername = `${profile.username}#${profile.discriminator}`;
    } else {
        displayUsername = profile.username; // Modern unique username (discriminator is "0")
    }

    console.log('Discord Profile Received (passportSetup):', {
        id: profile.id,
        usernameFromProfile: profile.username, // This is the unique username part
        discriminator: profile.discriminator,
        global_name: profile.global_name, // This is the "Display Name", can be non-unique
        derivedDisplayUsername: displayUsername,
        email: profile.email
    });

    try {
        // Check if coach exists in our database based on their Discord ID
        let coachResult = await db.query('SELECT * FROM coaches WHERE discord_user_id = $1', [profile.id]);
        let coachEntity; // This will be our coach object from the DB

        if (coachResult.rows.length > 0) {
            // Coach exists
            coachEntity = coachResult.rows[0];
            let fieldsToUpdate = [];
            const valuesToUpdate = [];
            let queryParamIndex = 1;

            // Update discord_username if it has changed in Discord
            if (coachEntity.discord_username !== displayUsername) {
                fieldsToUpdate.push(`discord_username = $${queryParamIndex++}`);
                valuesToUpdate.push(displayUsername);
            }
            
            // Always update last_login_at
            fieldsToUpdate.push(`last_login_at = NOW()`);
            
            if (fieldsToUpdate.length > 0) {
                fieldsToUpdate.push(`updated_at = NOW()`); // Also update updated_at timestamp
                const updateQuery = `UPDATE coaches SET ${fieldsToUpdate.join(', ')} WHERE coach_id = $${queryParamIndex++}`;
                valuesToUpdate.push(coachEntity.coach_id);
                
                await db.query(updateQuery, valuesToUpdate);
                
                // Refetch the coach to ensure the object passed to 'done' is the most up-to-date
                const updatedCoachResult = await db.query('SELECT * FROM coaches WHERE coach_id = $1', [coachEntity.coach_id]);
                coachEntity = updatedCoachResult.rows[0];
            }
            console.log(`Coach found and updated (passportSetup): ${coachEntity.discord_username}`);
        } else {
            // New coach, create a new record in our database
            const newCoachId = uuidv4();
            const insertResult = await db.query(
                `INSERT INTO coaches (coach_id, discord_user_id, discord_username, coach_status, special_discord_roles, last_login_at, created_at, updated_at) 
                 VALUES ($1, $2, $3, 'Active', '{}', NOW(), NOW(), NOW()) RETURNING *`,
                [newCoachId, profile.id, displayUsername]
            );
            coachEntity = insertResult.rows[0];
            console.log(`New coach created (passportSetup): ${coachEntity.discord_username}`);
        }

        // TODO LATER for full role sync:
        // Use 'accessToken' and 'profile.guilds' or specific guild IDs
        // to fetch the user's roles from YOUR NCBCA Discord server via the Discord API.
        // Then, update the 'coachEntity.special_discord_roles' array in the database.
        // This is more advanced and requires careful handling of API calls to Discord.
        // For now, special_discord_roles defaults to '{}'.

        return done(null, coachEntity); // Pass our coach object to passport.serializeUser

    } catch (err) {
        console.error('Error in Discord strategy verify callback (passportSetup):', err);
        return done(err, null);
    }
}));

module.exports = passport;
