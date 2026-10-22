// BorrowBox: a campus borrowing marketplace.
//
// createApp() builds the whole web app and is used both by `npm start` and by
// the tests (which pass in an in-memory database).
//
// Settings (environment variables):
//   PORT            port to listen on (default 3000)
//   SESSION_SECRET  long random string used to sign login cookies. Strongly
//                   recommended in production. If it is missing, the app makes a
//                   random one for that run (everyone is logged out on restart).
//                   Never commit it to the repo.
//   DB_PATH         where the SQLite file lives (default data/borrowbox.db)
//   ADMIN_EMAILS    comma-separated emails that become college admins on sign-up
//   COOKIE_SECURE   "true" when the site is served over HTTPS
//   TRUST_PROXY     number of proxies in front of the app (1 on Render/most hosts)

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieSession = require("cookie-session");
const { openDb } = require("./data/db");
const { CATEGORIES } = require("./lib/matching");
const { csrf } = require("./lib/security");

function createApp(options = {}) {
  const db = options.db || openDb();
  const app = express();

  const isProd = process.env.NODE_ENV === "production";
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (isProd) {
      // A random key can't be guessed, so login cookies stay unforgeable. The cost:
      // every restart logs everyone out (and copies of the app can't share logins).
      secret = crypto.randomBytes(32).toString("hex");
      console.warn(
        "WARNING: SESSION_SECRET is not set. Using a random key for this run, so everyone is " +
          "logged out when the app restarts. Set SESSION_SECRET to fix this."
      );
    } else {
      secret = "dev-only-secret-change-me"; // local development only
    }
  }
  const secureCookies = process.env.COOKIE_SECURE === "true";
  const proxies = Number(process.env.TRUST_PROXY) || 0;
  if (proxies > 0) app.set("trust proxy", proxies);

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  // Log non-healthcheck incoming requests to stdout
  app.use((req, res, next) => {
    if (req.path !== "/health") {
      console.log("[" + new Date().toISOString() + "] " + req.method + " " + req.url);
    }
    next();
  });

  // Security headers. Pages load only our own scripts and styles.
  // (upgrade-insecure-requests is switched off so the app also works on plain HTTP.)
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "upgrade-insecure-requests": null,
        },
      },
      hsts: secureCookies,
    })
  );

  // Health check: used by Docker, Kubernetes and the hosting platform.
  app.get("/health", (req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.status(200).json({ status: "ok" });
    } catch (err) {
      res.status(503).json({ status: "database unavailable" });
    }
  });

  app.use(express.static(path.join(__dirname, "public")));
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));

  // Login state lives in a signed cookie, so it works even with several copies
  // of the app running behind a load balancer.
  app.use(
    cookieSession({
      name: "borrowbox_session",
      keys: [secret],
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
  );

  // Who is logged in? Always re-read from the database so role and college
  // can't be tampered with through the cookie.
  app.use((req, res, next) => {
    req.user = req.session.userId
      ? db
          .prepare(
            `SELECT users.id, users.name, users.email, users.role, users.college_id,
                    colleges.name AS college_name, colleges.campus AS campus
             FROM users JOIN colleges ON colleges.id = users.college_id
             WHERE users.id = ?`
          )
          .get(req.session.userId)
      : undefined;
    if (req.session.userId && !req.user) req.session = null; // user no longer exists

    res.locals.user = req.user || null;
    res.locals.categories = CATEGORIES;
    res.locals.currentPath = req.path;
    res.locals.flash = req.session && req.session.flash;
    if (req.session && req.session.flash) delete req.session.flash;
    next();
  });

  app.use(csrf);

  app.use(require("./routes/auth")(db));
  app.use(require("./routes/market")(db));

  app.use((req, res) => {
    res.status(404).render("error", { title: "Page not found", message: "That page doesn't exist." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render("error", {
      title: "Something went wrong",
      message: "Something went wrong on our side. Please try again.",
    });
  });

  app.locals.db = db;
  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createApp().listen(PORT, () => {
    console.log(`BorrowBox running on port ${PORT}`);
  });
}

module.exports = { createApp };
