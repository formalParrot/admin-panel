require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt')
const session = require('express-session');
const requireAdmin = require('./middleware/requireAdmin');
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
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.get("/admin", (req, res) => {
  if (!req.session?.admin) {
    return res.sendFile(__dirname + "/public/login.html");
  }

  return res.sendFile(__dirname + "/public/admin.html");
});

router.post("/login", async (req, res) => {
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

    return res.json({
      ok: true
    });
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return status(500).json({
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

  const response = await fetch(
    `${process.env.LOCK_API_URL}${path}`,
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

  console.log("Lock API status:", response.status);

  const text = await response.text();

  console.log("Lock API response:", text);

  return res.status(response.status).send(text);
});

app.use("/admin", router);
app.use("/admin/notifications", notificationRouter)

app.use(express.static(path.join(__dirname, 'public/assets/')));

const PORT = process.env.PORT || 9879;
app.listen(PORT, () => console.log(`Admin API running on port ${PORT}`));
