// backend/config/session.js
const session = require('express-session');
require('dotenv').config(); // Ensure .env variables are available

const sessionConfig = session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // store: new pgSession(...), // Optional: For persistent sessions (add later if needed)
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true, // Good practice: client-side JS can't access cookie
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
});

module.exports = sessionConfig;
