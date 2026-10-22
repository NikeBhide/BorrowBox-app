// The marketplace: locker, needed board, matching, borrow requests, admin.
//
// Security rule used everywhere in this file: every query filters by the
// logged-in user's college_id (taken from the database, never from the form
// or cookie), so nobody can see or touch another college's data.

const express = require("express");
const { CATEGORIES, matchScore } = require("../lib/matching");
const { requireLogin, requireAdmin, flash } = require("../lib/security");

module.exports = function marketRoutes(db) {
  const router = express.Router();
  // Every page in this file needs a login. Applied per path (not router-wide)
  // so that unknown URLs still get a normal 404 page.
  router.use(["/marketplace", "/locker", "/needs", "/items", "/requests", "/admin"], requireLogin);

  const clean = (v, max) => String(v ?? "").trim().slice(0, max);
  const like = (s) => "%" + s.replace(/[\\%_]/g, "\\$&") + "%";
  const toId = (v) => (/^\d+$/.test(String(v)) ? Number(v) : 0);
  const isAdmin = (req) => req.user.role === "admin";

  function notFound(res) {
    return res.status(404).render("error", {
      title: "Not found",
      message: "We couldn't find that. It may have been removed.",
    });
  }

  // ---- matching helpers ------------------------------------------------

  function itemsForNeed(need) {
    const items = db
      .prepare(
        `SELECT items.*, users.name AS owner_name FROM items
         JOIN users ON users.id = items.user_id
         WHERE items.college_id = ? AND items.status = 'available' AND items.user_id != ?`
      )
      .all(need.college_id, need.user_id);
    return items
      .map((item) => ({ item, score: matchScore(need, item) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((m) => m.item);
  }

  function needsForItem(item) {
    const needs = db
      .prepare(
        `SELECT needs.*, users.name AS requester_name FROM needs
         JOIN users ON users.id = needs.user_id
         WHERE needs.college_id = ? AND needs.status = 'open' AND needs.user_id != ?`
      )
      .all(item.college_id, item.user_id);
    return needs
      .map((need) => ({ need, score: matchScore(need, item) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((m) => m.need);
  }

  // ---- marketplace -----------------------------------------------------

  router.get("/marketplace", (req, res) => {
    const q = clean(req.query.q, 60);
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : "";

    let sql = `SELECT items.*, users.name AS owner_name FROM items
               JOIN users ON users.id = items.user_id
               WHERE items.college_id = ?`;
    const params = [req.user.college_id];
    if (category) {
      sql += " AND items.category = ?";
      params.push(category);
    }
    if (q) {
      sql += " AND (items.name LIKE ? ESCAPE '\\' OR items.description LIKE ? ESCAPE '\\')";
      params.push(like(q), like(q));
    }
    sql += ` ORDER BY CASE items.status WHEN 'available' THEN 0 ELSE 1 END,
             items.created_at DESC, items.id DESC`;

    const items = db.prepare(sql).all(...params);
    res.render("marketplace", { title: "Marketplace", items, q, category });
  });

  // ---- locker (things I can lend) --------------------------------------

  router.get("/locker", (req, res) => {
    const items = db
      .prepare("SELECT * FROM items WHERE user_id = ? ORDER BY id DESC")
      .all(req.user.id)
      .map((item) => ({ ...item, wantedBy: needsForItem(item) }));
    res.render("locker", { title: "My locker", items, error: null, form: {} });
  });

  router.post("/locker", (req, res) => {
    const name = clean(req.body.name, 80);
    const category = req.body.category;
    const description = clean(req.body.description, 300);
    const pickup = clean(req.body.pickup_spot, 80);

    const items = () =>
      db.prepare("SELECT * FROM items WHERE user_id = ? ORDER BY id DESC").all(req.user.id)
        .map((item) => ({ ...item, wantedBy: needsForItem(item) }));
    const fail = (message) =>
      res.status(400).render("locker", {
        title: "My locker",
        items: items(),
        error: message,
        form: { name, category, description, pickup_spot: pickup },
      });

    if (name.length < 2) return fail("Give your item a name.");
    if (!CATEGORIES.includes(category)) return fail("Pick a category.");

    db.prepare(
      `INSERT INTO items (user_id, college_id, name, category, description, pickup_spot)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, req.user.college_id, name, category, description, pickup);

    flash(req, "ok", `"${name}" is now in your locker.`);
    res.redirect("/locker");
  });

  router.post("/locker/:id/delete", (req, res) => {
    const item = db
      .prepare("SELECT * FROM items WHERE id = ? AND college_id = ?")
      .get(toId(req.params.id), req.user.college_id);
    if (!item) return notFound(res);

    // Only the owner, or an admin of the same college, can remove an item.
    if (item.user_id !== req.user.id && !isAdmin(req)) {
      return res.status(403).render("error", {
        title: "Not allowed",
        message: "You can only remove your own items.",
      });
    }
    if (item.status === "lent") {
      flash(req, "error", "This item is currently lent out. Mark it returned first.");
      return res.redirect(isAdmin(req) && item.user_id !== req.user.id ? "/admin" : "/locker");
    }

    db.prepare("DELETE FROM items WHERE id = ?").run(item.id);
    flash(req, "ok", `"${item.name}" was removed.`);
    res.redirect(item.user_id === req.user.id ? "/locker" : "/admin");
  });

  // ---- needed board (things I'm looking for) ---------------------------

  function needsPageData(req) {
    const mine = db
      .prepare("SELECT * FROM needs WHERE user_id = ? ORDER BY id DESC")
      .all(req.user.id)
      .map((need) => ({ ...need, matches: need.status === "open" ? itemsForNeed(need) : [] }));
    const others = db
      .prepare(
        `SELECT needs.*, users.name AS requester_name FROM needs
         JOIN users ON users.id = needs.user_id
         WHERE needs.college_id = ? AND needs.user_id != ? AND needs.status = 'open'
         ORDER BY needs.id DESC`
      )
      .all(req.user.college_id, req.user.id);
    return { mine, others };
  }

  router.get("/needs", (req, res) => {
    res.render("needs", { title: "Needed", ...needsPageData(req), error: null, form: {} });
  });

  router.post("/needs", (req, res) => {
    const title = clean(req.body.title, 80);
    const category = req.body.category;
    const description = clean(req.body.description, 300);

    const fail = (message) =>
      res.status(400).render("needs", {
        title: "Needed",
        ...needsPageData(req),
        error: message,
        form: { title, category, description },
      });

    if (title.length < 2) return fail("Say what you need.");
    if (!CATEGORIES.includes(category)) return fail("Pick a category.");

    db.prepare(
      "INSERT INTO needs (user_id, college_id, title, category, description) VALUES (?, ?, ?, ?, ?)"
    ).run(req.user.id, req.user.college_id, title, category, description);

    flash(req, "ok", "Posted. Matching items in your college will show up here.");
    res.redirect("/needs");
  });

  router.post("/needs/:id/fulfil", (req, res) => {
    const need = db
      .prepare("SELECT * FROM needs WHERE id = ? AND user_id = ? AND college_id = ?")
      .get(toId(req.params.id), req.user.id, req.user.college_id);
    if (!need) return notFound(res);
    db.prepare("UPDATE needs SET status = 'fulfilled' WHERE id = ?").run(need.id);
    flash(req, "ok", "Marked as found. Glad you got it!");
    res.redirect("/needs");
  });

  router.post("/needs/:id/delete", (req, res) => {
    const need = db
      .prepare("SELECT * FROM needs WHERE id = ? AND college_id = ?")
      .get(toId(req.params.id), req.user.college_id);
    if (!need) return notFound(res);
    if (need.user_id !== req.user.id && !isAdmin(req)) {
      return res.status(403).render("error", {
        title: "Not allowed",
        message: "You can only remove your own posts.",
      });
    }
    db.prepare("DELETE FROM needs WHERE id = ?").run(need.id);
    flash(req, "ok", "Post removed.");
    res.redirect(need.user_id === req.user.id ? "/needs" : "/admin");
  });

  // ---- borrow requests -------------------------------------------------

  router.post("/items/:id/request", (req, res) => {
    const message = clean(req.body.message, 200);
    const itemId = toId(req.params.id);

    const result = db.transaction(() => {
      const item = db
        .prepare("SELECT * FROM items WHERE id = ? AND college_id = ?")
        .get(itemId, req.user.college_id);
      if (!item) return "missing";
      if (item.user_id === req.user.id) return "own";
      if (item.status !== "available") return "unavailable";

      db.prepare(
        `INSERT INTO requests (item_id, borrower_id, owner_id, college_id, message)
         VALUES (?, ?, ?, ?, ?)`
      ).run(item.id, req.user.id, item.user_id, req.user.college_id, message);
      db.prepare("UPDATE items SET status = 'requested' WHERE id = ?").run(item.id);
      return "ok";
    })();

    if (result === "missing") return notFound(res);
    if (result === "own") flash(req, "error", "That's your own item.");
    else if (result === "unavailable") flash(req, "error", "Someone else got there first. This item isn't available right now.");
    else flash(req, "ok", "Request sent. You'll see their contact details here once they accept.");
    res.redirect(result === "ok" ? "/requests" : "/marketplace");
  });

  router.get("/requests", (req, res) => {
    const incoming = db
      .prepare(
        `SELECT requests.*, items.name AS item_name, items.pickup_spot,
                users.name AS other_name, users.email AS other_email
         FROM requests
         JOIN items ON items.id = requests.item_id
         JOIN users ON users.id = requests.borrower_id
         WHERE requests.owner_id = ? ORDER BY requests.id DESC`
      )
      .all(req.user.id);
    const outgoing = db
      .prepare(
        `SELECT requests.*, items.name AS item_name, items.pickup_spot,
                users.name AS other_name, users.email AS other_email
         FROM requests
         JOIN items ON items.id = requests.item_id
         JOIN users ON users.id = requests.owner_id
         WHERE requests.borrower_id = ? ORDER BY requests.id DESC`
      )
      .all(req.user.id);
    res.render("requests", { title: "Requests", incoming, outgoing });
  });

  // Moves a request from one status to another, and updates the item to match.
  // `who` says whose action it is: only the owner (or only the borrower) may do it.
  function transition({ from, to, itemStatus, who }) {
    return (req, res) => {
      const id = toId(req.params.id);
      const ok = db.transaction(() => {
        const request = db
          .prepare("SELECT * FROM requests WHERE id = ? AND college_id = ?")
          .get(id, req.user.college_id);
        if (!request) return false;
        const actor = who === "owner" ? request.owner_id : request.borrower_id;
        if (actor !== req.user.id || request.status !== from) return false;

        db.prepare("UPDATE requests SET status = ? WHERE id = ?").run(to, request.id);
        db.prepare("UPDATE items SET status = ? WHERE id = ?").run(itemStatus, request.item_id);
        return true;
      })();

      if (!ok) return notFound(res);
      flash(req, "ok", `Request ${to}.`);
      res.redirect("/requests");
    };
  }

  router.post("/requests/:id/accept", transition({ from: "pending", to: "accepted", itemStatus: "lent", who: "owner" }));
  router.post("/requests/:id/decline", transition({ from: "pending", to: "declined", itemStatus: "available", who: "owner" }));
  router.post("/requests/:id/cancel", transition({ from: "pending", to: "cancelled", itemStatus: "available", who: "borrower" }));
  router.post("/requests/:id/return", transition({ from: "accepted", to: "returned", itemStatus: "available", who: "owner" }));

  // ---- admin (role-based access) ---------------------------------------

  router.get("/admin", requireAdmin, (req, res) => {
    const cid = req.user.college_id;
    const users = db
      .prepare("SELECT id, name, email, role, created_at FROM users WHERE college_id = ? ORDER BY id")
      .all(cid);
    const items = db
      .prepare(
        `SELECT items.*, users.name AS owner_name FROM items
         JOIN users ON users.id = items.user_id WHERE items.college_id = ? ORDER BY items.id DESC`
      )
      .all(cid);
    const needs = db
      .prepare(
        `SELECT needs.*, users.name AS requester_name FROM needs
         JOIN users ON users.id = needs.user_id WHERE needs.college_id = ? ORDER BY needs.id DESC`
      )
      .all(cid);
    res.render("admin", { title: "Admin", users, items, needs });
  });

  return router;
};
