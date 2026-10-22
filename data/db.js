// Database layer for BorrowBox (SQLite via better-sqlite3).
//
// Everything is stored in one file (default: data/borrowbox.db, override with
// DB_PATH). Tests use ":memory:". The rest of the app only talks to the
// object returned by openDb(), so swapping SQLite for Postgres later means
// changing this file and the queries, not the pages.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const colleges = require("./colleges.json");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS colleges (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  campus  TEXT NOT NULL,
  domain  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  college_id    INTEGER NOT NULL REFERENCES colleges(id),
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The "locker": things a person is happy to lend.
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  college_id  INTEGER NOT NULL REFERENCES colleges(id),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pickup_spot TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'requested', 'lent')),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The "needed" board: things a person is looking for.
CREATE TABLE IF NOT EXISTS needs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  college_id  INTEGER NOT NULL REFERENCES colleges(id),
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled')),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A borrow request on one locker item.
CREATE TABLE IF NOT EXISTS requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  borrower_id INTEGER NOT NULL REFERENCES users(id),
  owner_id    INTEGER NOT NULL REFERENCES users(id),
  college_id  INTEGER NOT NULL REFERENCES colleges(id),
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'accepted', 'declined', 'returned', 'cancelled')),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_college    ON items(college_id, status);
CREATE INDEX IF NOT EXISTS idx_needs_college    ON needs(college_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_owner   ON requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_requests_borrower ON requests(borrower_id);
`;

function openDb(file) {
  const target = file || process.env.DB_PATH || path.join(__dirname, "borrowbox.db");
  if (target !== ":memory:") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }

  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const upsert = db.prepare(
    `INSERT INTO colleges (name, campus, domain) VALUES (@name, @campus, @domain)
     ON CONFLICT(domain) DO UPDATE SET name = excluded.name, campus = excluded.campus`
  );
  for (const c of colleges) upsert.run(c);

  return db;
}

// Find the college whose email domain matches this address.
// "aditi@students.northfield.edu.in" matches the domain "northfield.edu.in".
function findCollegeByEmail(db, email) {
  const domain = String(email).toLowerCase().split("@")[1];
  if (!domain) return undefined;
  return db
    .prepare("SELECT * FROM colleges WHERE ? = domain OR ? LIKE '%.' || domain")
    .get(domain, domain);
}

module.exports = { openDb, findCollegeByEmail };
