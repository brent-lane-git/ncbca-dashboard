// backend/routes/authRoutes.js
const express = require('express');
const passport = require('passport'); // Passport is already configured in passportSetup.js
const router = express.Router();

// Route to initiate Discord OAuth flow
// GET /api/auth/discord/login
router.get('/discord/login', passport.authenticate('discord'));

// Route to handle Discord OAuth callback
// GET /api/auth/discord/callback
router.get(
  '/discord/callback',
  passport.authenticate('discord', {
    failureRedirect: '/login-failed', // Or a frontend route that shows login failure
    successRedirect: process.env.FRONTEND_URL || 'http://localhost:3000/dashboard' // Redirect to frontend dashboard after successful login
  }),
  (req, res) => {
    // This callback is only hit on successful authentication before the redirect.
    // You could log success here if needed, but the redirect handles sending the user.
    // console.log('Successfully authenticated, redirecting...');
    // res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000/dashboard'); // successRedirect does this
  }
);

// Route to check current authenticated user status
// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) { // req.isAuthenticated() is added by Passport
    // req.user contains the coach object from deserializeUser
    // We can choose what to send back to the frontend
    const { coach_id, discord_user_id, discord_username, special_discord_roles, loyalty_score } = req.user;
    res.json({
      isAuthenticated: true,
      user: {
        coach_id,
        discord_user_id,
        discord_username,
        special_discord_roles, // These are from our DB, potentially populated after fetching from Discord API
        loyalty_score
        // Add other relevant, non-sensitive coach details
      }
    });
  } else {
    res.json({ isAuthenticated: false, user: null });
  }
});

// Route to logout
// POST /api/auth/logout
// REVISED Route to logout
// POST /api/auth/logout
router.post('/logout', (req, res, next) => {
    // Check if user is authenticated before trying to log out
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(400).json({ message: 'User is not authenticated.' });
    }

    req.logout(function(err) { // req.logout() now requires a callback
        if (err) {
            console.error('Error during req.logout():', err);
            return next(err); // Pass to error handler
        }
        
        // If logout is successful, proceed to destroy the session
        if (req.session) {
            req.session.destroy(function(err) {
                if (err) {
                    console.error('Error destroying session:', err);
                    return res.status(500).json({ message: 'Failed to destroy session during logout.' });
                }
                // Session destroyed
                res.clearCookie('connect.sid', { path: '/' }); // Ensure path matches cookie path if specified
                console.log('User logged out, session destroyed, and cookie cleared.');
                return res.status(200).json({ message: 'Logged out successfully' });
            });
        } else {
            // If no session, still attempt to clear cookie and send success
            // This case might occur if session was already invalidated or not properly set up
            res.clearCookie('connect.sid', { path: '/' });
            console.log('User logged out (no active session to destroy), cookie cleared.');
            return res.status(200).json({ message: 'Logged out successfully (no active session)' });
        }
    });
});

// Example route for login failure (if failureRedirect is used)
router.get('/login-failed', (req, res) => {
  res.status(401).json({ error: 'Discord authentication failed. Please try again.' });
});


module.exports = router;
