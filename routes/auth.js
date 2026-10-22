// Registration, login and logout.

const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { findCollegeByEmail } = require("../data/db");
const { limiter, flash } = require("../lib/security");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcrypt cost: higher = slower for attackers (and for us). Lower in tests so they run fast.
const COST = process.env.NODE_ENV === "test" ? 4 : 10;
// A throwaway hash so a login for an unknown email takes as long as a real one.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", COST);

module.exports = function authRoutes(db) {
  const router = express.Router();
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const clean = (v, max) => String(v ?? "").trim().slice(0, max);

  // Start a fresh session for a user (also issues a new CSRF token).
  function startSession(req, userId) {
    req.session = { userId, csrf: crypto.randomBytes(24).toString("hex") };
  }

  router.get("/", (req, res) => {
    if (req.user) return res.redirect("/marketplace");
    const colleges = db.prepare("SELECT name, campus, domain FROM colleges ORDER BY name").all();
    res.render("home", { title: "Borrow on your campus", colleges });
  });

  // Used by the sign-up page to show "you're at X campus" as you type.
  router.get("/colleges/lookup", (req, res) => {
    const college = findCollegeByEmail(db, clean(req.query.email, 200));
    if (!college) return res.json({ found: false });
    res.json({ found: true, name: college.name, campus: college.campus });
  });

  router.get("/register", (req, res) => {
    if (req.user) return res.redirect("/marketplace");
    res.render("register", { title: "Create account", error: null, form: {} });
  });

  router.post("/register", limiter(10), async (req, res, next) => {
    try {
      const name = clean(req.body.name, 60);
      const email = clean(req.body.email, 200).toLowerCase();
      const password = String(req.body.password ?? "");
      const confirm = String(req.body.confirm ?? "");
      const form = { name, email };

      const fail = (message) =>
        res.status(400).render("register", { title: "Create account", error: message, form });

      if (name.length < 2) return fail("Please enter your name.");
      if (!EMAIL_RE.test(email)) return fail("Please enter a valid email address.");
      // bcrypt only reads the first 72 bytes, so longer passwords are refused.
      if (password.length < 8 || Buffer.byteLength(password) > 72) {
        return fail("Password must be 8 to 72 characters long.");
      }
      if (password !== confirm) return fail("The two passwords do not match.");

      const college = findCollegeByEmail(db, email);
      if (!college) {
        return fail("That email isn't from a college we support yet. Use your college email address.");
      }
      if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
        return fail("An account with this email already exists. Try logging in.");
      }

      const hash = await bcrypt.hash(password, COST);
      const role = adminEmails.includes(email) ? "admin" : "student";
      const info = db
        .prepare(
          "INSERT INTO users (name, email, password_hash, college_id, role) VALUES (?, ?, ?, ?, ?)"
        )
        .run(name, email, hash, college.id, role);

      startSession(req, info.lastInsertRowid);
      flash(req, "ok", `Welcome, ${name}! You're on the ${college.name} (${college.campus}) marketplace.`);
      res.redirect("/marketplace");
    } catch (err) {
      next(err);
    }
  });

  router.get("/login", (req, res) => {
    if (req.user) return res.redirect("/marketplace");
    res.render("login", { title: "Log in", error: null, form: {} });
  });

  router.post("/login", limiter(10), async (req, res, next) => {
    try {
      const email = clean(req.body.email, 200).toLowerCase();
      const password = String(req.body.password ?? "");
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

      // Same work and same message whether the email or the password was wrong,
      // so an attacker can't use the login form to find out who has an account.
      const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !ok) {
        return res
          .status(401)
          .render("login", { title: "Log in", error: "Incorrect email or password.", form: { email } });
      }

      startSession(req, user.id);
      res.redirect("/marketplace");
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", (req, res) => {
    req.session = null;
    res.redirect("/");
  });

  return router;
};
