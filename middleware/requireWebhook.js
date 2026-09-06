function requireWebhook(req, res, next) {
  const webhookToken = process.env.WEBHOOK_TOKEN;
  const providedToken = req.get("x-webhook-token");

  if (!webhookToken) {
    return res.status(500).json({ error: "Webhook not configured" });
  }

  if (!providedToken || !timingSafeEqual(providedToken, webhookToken)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

function timingSafeEqual(a, b) {
  const crypto = require("crypto");
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = requireWebhook;
