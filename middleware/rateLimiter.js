const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 1000 * 60 * 15,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, try again later." }
});

const apiLimiter = rateLimit({
  windowMs: 1000 * 60 * 15,
  limit: Number(process.env.API_RATE_LIMIT) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." }
});

module.exports = { loginLimiter, apiLimiter };
