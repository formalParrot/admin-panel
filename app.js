require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt')
const session = require('express-session');
const requireAdmin = require('./middleware/requireAdmin');
const { loginLimiter, apiLimiter } = require('./middleware/rateLimiter');
const path = require('path');

const app = express()
app.use(express.json());
const router = express.Router();

const notificationRouter = require('./notifications')

const allowedActions = {
  issue: "/lock/admin/issue",
  revoke: "/lock/admin/revoke",
  tokens: "/lock/admin/tokens"
};

app.use(session({
  name: 'admin_session',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, //https
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.get("/admin", (req, res) => {
  if (!req.session?.admin) {
    return res.sendFile(__dirname + "/public/login.html");
  }

  return res.sendFile(__dirname + "/public/admin.html");
});

router.post("/login", loginLimiter, async (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({
      ok: false,
      error: "PIN required"
    });
  }

  const valid = await bcrypt.compare(
    pin,
    process.env.ADMIN_PIN
  );

  if (!valid) {
    return res.status(401).json({
      ok: false,
      error: "Invalid PIN"
    });
  }

  req.session.regenerate(err => {
    if (err) {
      return res.status(500).json({
        ok: false,
        error: "Failed to create session"
      });
    }

    req.session.admin = true;

    req.session.save((saveErr) => {
      if (saveErr) {
        return res.status(500).json({
          ok: false,
          error: "Failed to save session"
        });
      }

      return res.json({
        ok: true
      });
    });
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({
        ok: false,
        error: "Failed to log out."
      });
    };

    res.clearCookie("admin_session");

    return res.json({
      ok: true
    })
  });
})

router.post("/lock", requireAdmin, async (req, res) => {
  const { action, ...body } = req.body;

  const path = allowedActions[action];

  if (!path) {
    return res.status(400).json({
      error: "Invalid action"
    });
  }

  const url = `${process.env.LOCK_API_URL}${path}`;

  console.log(`[lock] ${action} -> ${url}`);

  let response;
  try {
    response = await fetch(
      url,
      {
        method: action === "tokens" ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": process.env.LOCK_ADMIN_SECRET
        },
        ...(action !== "tokens" && {
          body: JSON.stringify(body)
        })
      }
    );
  } catch (err) {
    console.error(`[lock] ${action} fetch failed:`, err.message, err.cause || "");
    return res.status(502).json({
      error: "Lock API unreachable"
    });
  }

  console.log(`[lock] ${action} upstream status:`, response.status);

  const text = await response.text();

  if (response.status === 502) {
    console.error(`[lock] ${action} got 502 from upstream (origin behind Cloudflare likely down):`);
    console.error(`[lock] body (first 400 chars):`, text.slice(0, 400));
  } else {
    console.log(`[lock] ${action} response (first 500 chars):`, text.slice(0, 500));
  }

  return res.status(response.status).send(text);
});

app.use("/admin", router);
app.use("/admin/notifications", notificationRouter)

app.use(express.static(path.join(__dirname, 'public/assets/')));

const PORT = process.env.PORT || 9879;
app.listen(PORT, () => console.log(`Admin API running on port ${PORT}`));
