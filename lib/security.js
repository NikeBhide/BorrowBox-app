// Security helpers: CSRF protection, rate limiting, login/role checks.

const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// CSRF: every form carries a secret token that only our own pages know.
// A malicious site can make your browser send a request, but it can't read
// the token, so the forged request is rejected.
function csrf(req, res, next) {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(24).toString("hex");
  }
  res.locals.csrfToken = req.session.csrf;

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const sent = req.body && req.body._csrf;
  if (!sent || !safeEqual(sent, req.session.csrf)) {
    return res.status(403).render("error", {
      title: "Request blocked",
      message:
        "Your session expired or the form could not be verified. Go back, refresh the page and try again.",
    });
  }
  next();
}

// Limits repeated attempts from one address (slows down password guessing).
function limiter(max) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "test" ? 1000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).render("error", {
        title: "Too many attempts",
        message: "Too many attempts from your connection. Please wait a few minutes and try again.",
      }),
  });
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect("/login");
  if (req.user.role !== "admin") {
    return res.status(403).render("error", {
      title: "Not allowed",
      message: "Only college admins can open this page.",
    });
  }
  next();
}

function flash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = { csrf, limiter, requireLogin, requireAdmin, flash };
