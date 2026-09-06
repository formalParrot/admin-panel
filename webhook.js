const express = require('express');
const requireWebhook = require('./middleware/requireWebhook');
const { webhookLimiter } = require('./middleware/rateLimiter');
const router = express.Router();

router.post('/notifications', webhookLimiter, requireWebhook, (req, res) => {
  const { message, service } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message required" });
  }

  const notification = require('./notifications').createNotification(message, service);
  res.status(201).json(notification);
})

module.exports = router
