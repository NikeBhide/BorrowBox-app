const request = require("supertest");
const { createApp } = require("../server");
const { openDb } = require("../data/db");
const { matchScore } = require("../lib/matching");

// ---- helpers --------------------------------------------------------------

function makeApp() {
  return createApp({ db: openDb(":memory:") });
}

// Every form has a hidden CSRF token; read it from a page like a browser would.
async function tokenFrom(agent, page) {
  const res = await agent.get(page);
  const match = res.text.match(/name="_csrf" value="([^"]+)"/);
  return match[1];
}

// Sign up a new user and return a logged-in agent (it keeps the session cookie).
async function signUp(app, overrides = {}) {
  const user = {
    name: "Aditi",
    email: "aditi@northfield.edu.in",
    password: "password123",
    ...overrides,
  };
  const agent = request.agent(app);
  const _csrf = await tokenFrom(agent, "/register");
  const res = await agent
    .post("/register")
    .type("form")
    .send({ _csrf, name: user.name, email: user.email, password: user.password, confirm: user.password });
  return { agent, res, user };
}

// Log in through the real form (token is fetched first, then the request is built).
async function logIn(agent, email, password) {
  const _csrf = await tokenFrom(agent, "/login");
  return agent.post("/login").type("form").send({ _csrf, email, password });
}

// POST a form as a logged-in user.
async function post(agent, url, body = {}) {
  const _csrf = await tokenFrom(agent, "/marketplace");
  return agent.post(url).type("form").send({ _csrf, ...body });
}

const addItem = (agent, name, extra = {}) =>
  post(agent, "/locker", { name, category: "Electronics", ...extra });

const itemId = (app, name) =>
  app.locals.db.prepare("SELECT id FROM items WHERE name = ?").get(name).id;

const itemStatus = (app, name) =>
  app.locals.db.prepare("SELECT status FROM items WHERE name = ?").get(name).status;

// ---- basics ---------------------------------------------------------------

describe("health and access", () => {
  it("GET /health returns ok", async () => {
    const res = await request(makeApp()).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("home page loads for visitors", async () => {
    const res = await request(makeApp()).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Borrow what you need");
  });

  it("sends logged-out visitors to the login page", async () => {
    const app = makeApp();
    for (const url of ["/marketplace", "/locker", "/needs", "/requests"]) {
      const res = await request(app).get(url);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/login");
    }
  });

  it("returns a friendly 404", async () => {
    const res = await request(makeApp()).get("/nope");
    expect(res.statusCode).toBe(404);
  });
});

// ---- registration and login ----------------------------------------------

describe("registration", () => {
  it("accepts a college email and detects the college and campus", async () => {
    const app = makeApp();
    const { agent, res } = await signUp(app);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/marketplace");

    const page = await agent.get("/marketplace");
    expect(page.text).toContain("Northfield Institute of Technology");
    expect(page.text).toContain("Main Campus");
  });

  it("accepts subdomains of a college domain", async () => {
    const { res } = await signUp(makeApp(), { email: "x@students.riverside.edu.in" });
    expect(res.statusCode).toBe(302);
  });

  it("rejects an email from an unsupported domain", async () => {
    const { res } = await signUp(makeApp(), { email: "someone@gmail.com" });
    expect(res.statusCode).toBe(400);
    expect(res.text).toContain("from a college we support");
  });

  it("does not treat lookalike domains as a college", async () => {
    const { res } = await signUp(makeApp(), { email: "evil@notnorthfield.edu.in" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects short passwords", async () => {
    const { res } = await signUp(makeApp(), { password: "short" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a duplicate email", async () => {
    const app = makeApp();
    await signUp(app);
    const { res } = await signUp(app);
    expect(res.statusCode).toBe(400);
    expect(res.text).toContain("already exists");
  });

  it("stores passwords hashed, never as plain text", async () => {
    const app = makeApp();
    await signUp(app, { password: "password123" });
    const row = app.locals.db.prepare("SELECT password_hash FROM users").get();
    expect(row.password_hash).not.toContain("password123");
    expect(row.password_hash.startsWith("$2")).toBe(true);
  });

  it("looks up the college for an email", async () => {
    const res = await request(makeApp()).get("/colleges/lookup?email=a@lakeview.edu.in");
    expect(res.body).toEqual({ found: true, name: "Lakeview College of Arts", campus: "North Campus" });
    const none = await request(makeApp()).get("/colleges/lookup?email=a@gmail.com");
    expect(none.body.found).toBe(false);
  });
});

describe("login", () => {
  it("logs in with the right password and rejects the wrong one", async () => {
    const app = makeApp();
    const { user } = await signUp(app);

    const agent = request.agent(app);
    const bad = await logIn(agent, user.email, "wrong-password");
    expect(bad.statusCode).toBe(401);
    expect(bad.text).toContain("Incorrect email or password");

    const good = await logIn(agent, user.email, user.password);
    expect(good.statusCode).toBe(302);
    expect((await agent.get("/marketplace")).statusCode).toBe(200);
  });

  it("gives the same error for an unknown email", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const res = await logIn(agent, "ghost@northfield.edu.in", "whatever123");
    expect(res.statusCode).toBe(401);
    expect(res.text).toContain("Incorrect email or password");
  });

  it("logs out", async () => {
    const app = makeApp();
    const { agent } = await signUp(app);
    await post(agent, "/logout");
    const res = await agent.get("/marketplace");
    expect(res.statusCode).toBe(302);
  });
});

// ---- security -------------------------------------------------------------

describe("security", () => {
  it("blocks form posts without a CSRF token", async () => {
    const app = makeApp();
    const { agent } = await signUp(app);
    const res = await agent.post("/locker").type("form").send({ name: "Sneaky", category: "Books" });
    expect(res.statusCode).toBe(403);
    expect(app.locals.db.prepare("SELECT COUNT(*) AS n FROM items").get().n).toBe(0);
  });

  it("blocks form posts with a wrong CSRF token", async () => {
    const app = makeApp();
    const { agent } = await signUp(app);
    const res = await agent
      .post("/locker")
      .type("form")
      .send({ _csrf: "not-the-token", name: "Sneaky", category: "Books" });
    expect(res.statusCode).toBe(403);
  });

  it("escapes HTML in user content", async () => {
    const app = makeApp();
    const { agent } = await signUp(app);
    await addItem(agent, "<script>alert(1)</script>");
    const page = await agent.get("/marketplace");
    expect(page.text).not.toContain("<script>alert(1)</script>");
    expect(page.text).toContain("&lt;script&gt;");
  });

  it("sets security headers and a strict content policy", async () => {
    const res = await request(makeApp()).get("/");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("marks the session cookie HttpOnly", async () => {
    const res = await request(makeApp()).get("/login");
    const cookie = [].concat(res.headers["set-cookie"] || []).join(";");
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("starts in production without SESSION_SECRET, using a random key and a warning", () => {
    const oldEnv = process.env.NODE_ENV;
    const oldSecret = process.env.SESSION_SECRET;
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => createApp({ db: openDb(":memory:") })).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("SESSION_SECRET is not set"));
    } finally {
      warn.mockRestore();
      process.env.NODE_ENV = oldEnv;
      if (oldSecret !== undefined) process.env.SESSION_SECRET = oldSecret;
    }
  });
});

// ---- college isolation (the core rule) -----------------------------------

describe("college isolation", () => {
  it("never shows another college's items and blocks actions on them", async () => {
    const app = makeApp();
    const { agent: northfield } = await signUp(app);
    const { agent: riverside } = await signUp(app, { name: "Rhea", email: "rhea@riverside.edu.in" });

    await addItem(northfield, "Northfield Calculator");

    // Riverside student can't see it...
    const page = await riverside.get("/marketplace");
    expect(page.text).not.toContain("Northfield Calculator");

    // ...can't request it, even by guessing the id...
    const id = itemId(app, "Northfield Calculator");
    const req = await post(riverside, `/items/${id}/request`);
    expect(req.statusCode).toBe(404);
    expect(itemStatus(app, "Northfield Calculator")).toBe("available");

    // ...and can't delete it.
    const del = await post(riverside, `/locker/${id}/delete`);
    expect(del.statusCode).toBe(404);
    expect(app.locals.db.prepare("SELECT COUNT(*) AS n FROM items").get().n).toBe(1);
  });

  it("keeps needed posts inside one college", async () => {
    const app = makeApp();
    const { agent: a } = await signUp(app);
    const { agent: b } = await signUp(app, { name: "Rhea", email: "rhea@riverside.edu.in" });
    await post(a, "/needs", { title: "Soldering iron", category: "Tools" });
    expect((await b.get("/needs")).text).not.toContain("Soldering iron");
  });
});

// ---- locker, requests -----------------------------------------------------

describe("locker and borrowing", () => {
  it("adds items to the locker and lists them on the marketplace", async () => {
    const app = makeApp();
    const { agent } = await signUp(app);
    const res = await addItem(agent, "Scientific Calculator", { pickup_spot: "Library entrance" });
    expect(res.statusCode).toBe(302);

    const page = await agent.get("/marketplace");
    expect(page.text).toContain("Scientific Calculator");
    expect(page.text).toContain("Library entrance");
  });

  it("validates item fields", async () => {
    const { agent } = await signUp(makeApp());
    expect((await addItem(agent, "x")).statusCode).toBe(400);
    expect((await post(agent, "/locker", { name: "Valid name", category: "Nonsense" })).statusCode).toBe(400);
  });

  it("runs the full request, accept and return flow", async () => {
    const app = makeApp();
    const { agent: owner } = await signUp(app);
    const { agent: borrower } = await signUp(app, { name: "Rohan", email: "rohan@northfield.edu.in" });
    await addItem(owner, "Data Structures Book", { category: "Books" });
    const id = itemId(app, "Data Structures Book");

    // Borrower requests: item becomes "requested". Owner's email stays hidden.
    expect((await post(borrower, `/items/${id}/request`, { message: "Need it Friday" })).statusCode).toBe(302);
    expect(itemStatus(app, "Data Structures Book")).toBe("requested");
    expect((await borrower.get("/requests")).text).not.toContain("aditi@northfield.edu.in");

    // Someone else can't request it while it's taken.
    const { agent: third } = await signUp(app, { name: "Meera", email: "meera@northfield.edu.in" });
    await post(third, `/items/${id}/request`);
    expect(app.locals.db.prepare("SELECT COUNT(*) AS n FROM requests").get().n).toBe(1);

    const requestId = app.locals.db.prepare("SELECT id FROM requests").get().id;

    // The borrower and a bystander can't accept; only the owner can.
    expect((await post(borrower, `/requests/${requestId}/accept`)).statusCode).toBe(404);
    expect((await post(third, `/requests/${requestId}/accept`)).statusCode).toBe(404);
    expect((await post(owner, `/requests/${requestId}/accept`)).statusCode).toBe(302);
    expect(itemStatus(app, "Data Structures Book")).toBe("lent");

    // After accepting, contact details are shared both ways.
    expect((await borrower.get("/requests")).text).toContain("aditi@northfield.edu.in");
    expect((await owner.get("/requests")).text).toContain("rohan@northfield.edu.in");

    // A lent item can't be removed. Owner marks it returned.
    expect((await post(owner, `/locker/${id}/delete`)).statusCode).toBe(302);
    expect(itemStatus(app, "Data Structures Book")).toBe("lent");
    expect((await post(owner, `/requests/${requestId}/return`)).statusCode).toBe(302);
    expect(itemStatus(app, "Data Structures Book")).toBe("available");
  });

  it("lets an owner decline and a borrower cancel", async () => {
    const app = makeApp();
    const { agent: owner } = await signUp(app);
    const { agent: borrower } = await signUp(app, { name: "Rohan", email: "rohan@northfield.edu.in" });
    await addItem(owner, "Drill");
    const id = itemId(app, "Drill");

    await post(borrower, `/items/${id}/request`);
    let requestId = app.locals.db.prepare("SELECT id FROM requests ORDER BY id DESC").get().id;
    await post(owner, `/requests/${requestId}/decline`);
    expect(itemStatus(app, "Drill")).toBe("available");

    await post(borrower, `/items/${id}/request`);
    requestId = app.locals.db.prepare("SELECT id FROM requests ORDER BY id DESC").get().id;
    await post(borrower, `/requests/${requestId}/cancel`);
    expect(itemStatus(app, "Drill")).toBe("available");
  });

  it("doesn't let you borrow your own item", async () => {
    const app = makeApp();
    const { agent } = await signUp(app);
    await addItem(agent, "My Own Thing");
    await post(agent, `/items/${itemId(app, "My Own Thing")}/request`);
    expect(app.locals.db.prepare("SELECT COUNT(*) AS n FROM requests").get().n).toBe(0);
    expect(itemStatus(app, "My Own Thing")).toBe("available");
  });

  it("only lets the owner remove their own item", async () => {
    const app = makeApp();
    const { agent: owner } = await signUp(app);
    const { agent: other } = await signUp(app, { name: "Rohan", email: "rohan@northfield.edu.in" });
    await addItem(owner, "Protected Item");
    const res = await post(other, `/locker/${itemId(app, "Protected Item")}/delete`);
    expect(res.statusCode).toBe(403);
    expect(app.locals.db.prepare("SELECT COUNT(*) AS n FROM items").get().n).toBe(1);
  });

  it("filters and searches the marketplace", async () => {
    const app = makeApp();
    const { agent } = await signUp(app);
    await addItem(agent, "Arduino Kit", { category: "Electronics" });
    await addItem(agent, "Cricket Bat", { category: "Sports" });
    const sports = await agent.get("/marketplace?category=Sports");
    expect(sports.text).toContain("Cricket Bat");
    expect(sports.text).not.toContain("Arduino Kit");
    const search = await agent.get("/marketplace?q=ardu");
    expect(search.text).toContain("Arduino Kit");
    expect(search.text).not.toContain("Cricket Bat");
  });
});

// ---- needed board and matching -------------------------------------------

describe("needed board and matching", () => {
  it("shows matching locker items under a needed post, and the reverse", async () => {
    const app = makeApp();
    const { agent: owner } = await signUp(app);
    const { agent: seeker } = await signUp(app, { name: "Rohan", email: "rohan@northfield.edu.in" });
    await addItem(owner, "USB-C Charger 65W");
    await post(seeker, "/needs", { title: "Need a USB-C charger", category: "Electronics" });

    const needs = await seeker.get("/needs");
    expect(needs.text).toContain("Available in your college");
    expect(needs.text).toContain("USB-C Charger 65W");

    const locker = await owner.get("/locker");
    expect(locker.text).toContain("Someone is looking for this");
    expect(locker.text).toContain("Need a USB-C charger");
  });

  it("lets people mark a need as found and delete it", async () => {
    const app = makeApp();
    const { agent } = await signUp(app);
    await post(agent, "/needs", { title: "Lab coat", category: "Clothing" });
    const id = app.locals.db.prepare("SELECT id FROM needs").get().id;
    await post(agent, `/needs/${id}/fulfil`);
    expect(app.locals.db.prepare("SELECT status FROM needs").get().status).toBe("fulfilled");
    await post(agent, `/needs/${id}/delete`);
    expect(app.locals.db.prepare("SELECT COUNT(*) AS n FROM needs").get().n).toBe(0);
  });

  it("scores matches by keyword overlap", () => {
    const need = { title: "need a charger", category: "Electronics" };
    expect(matchScore(need, { name: "USB Charger", description: "", category: "Electronics" })).toBeGreaterThan(0);
    expect(matchScore(need, { name: "Cricket bat", description: "", category: "Sports" })).toBe(0);
  });
});

// ---- roles ----------------------------------------------------------------

describe("roles", () => {
  it("keeps the admin page away from students", async () => {
    const { agent } = await signUp(makeApp());
    expect((await agent.get("/admin")).statusCode).toBe(403);
  });

  it("lets a college admin moderate their own college only", async () => {
    process.env.ADMIN_EMAILS = "boss@northfield.edu.in";
    let app;
    try {
      app = makeApp();
    } finally {
      delete process.env.ADMIN_EMAILS;
    }

    const { agent: admin } = await signUp(app, { name: "Boss", email: "boss@northfield.edu.in" });
    const { agent: student } = await signUp(app, { name: "Rohan", email: "rohan@northfield.edu.in" });
    const { agent: outsider } = await signUp(app, { name: "Rhea", email: "rhea@riverside.edu.in" });

    await addItem(student, "Spam listing");
    await addItem(outsider, "Riverside item");

    const page = await admin.get("/admin");
    expect(page.statusCode).toBe(200);
    expect(page.text).toContain("Spam listing");
    expect(page.text).not.toContain("Riverside item");

    // Admin removes the student's listing, but can't touch the other college.
    expect((await post(admin, `/locker/${itemId(app, "Spam listing")}/delete`)).statusCode).toBe(302);
    expect(app.locals.db.prepare("SELECT COUNT(*) AS n FROM items WHERE name = 'Spam listing'").get().n).toBe(0);
    expect((await post(admin, `/locker/${itemId(app, "Riverside item")}/delete`)).statusCode).toBe(404);
  });
});
