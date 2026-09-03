function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  const providedKey = req.get("x-admin-key");

  if (adminKey && providedKey && timingSafeEqual(providedKey, adminKey)) {
    return next();
  }

  if (req.session?.admin) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized" });
}

function timingSafeEqual(a, b) {
  const crypto = require("crypto");
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}


module.exports = requireAdmin
