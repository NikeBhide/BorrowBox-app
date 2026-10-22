# BorrowBox: Campus Borrowing Marketplace

BorrowBox lets students lend and borrow everyday things (calculators, books,
chargers, tools) with people on their own campus. You sign up with your college
email, the app works out your college and campus, and you only ever see and
borrow from people at the same college.

## What it does

- **College-only access.** Registration requires an email from a supported
  college. The college and campus are detected from the email domain, and every
  page and action is limited to that college.
- **Locker.** List the things you're happy to lend, with a pickup spot on campus.
- **Needed board.** Post what you're looking for. Matching locker items from your
  college appear under your post, and owners see who is looking for their items.
- **Borrow requests.** Request an item, the owner accepts or declines, and
  contact details are shared only after acceptance. The owner marks it returned.
- **Roles.** `student` (default) and `admin`. College admins can see their
  college's members and remove listings or posts, for their own college only.

## Tech stack

Node.js, Express, EJS (server-rendered pages), SQLite (`better-sqlite3`), plain
CSS, Docker, Jest + Supertest for tests.

## Security

- Passwords are hashed with bcrypt, never stored in plain text.
- Login state is a signed, HttpOnly cookie (`SESSION_SECRET` signs it).
- CSRF token on every form; a request without a valid token is rejected.
- Every database query is filtered by the logged-in user's college, and the
  user's college and role are always read from the database, not the cookie.
- Login and sign-up are rate limited. Login gives the same error for a wrong
  email or a wrong password.
- Security headers and a strict Content Security Policy (helmet). User input is
  escaped in every page.
- Secrets come from environment variables and are never committed.

## Running locally

```bash
npm install
npm start
```

Open http://localhost:3000. Locally the app uses a development session key and
creates `data/borrowbox.db` automatically.

Sign up with an email from a supported college (see `data/colleges.json`), for
example `you@northfield.edu.in`.

## Settings (environment variables)

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Long random string that signs login cookies. **Required** when `NODE_ENV=production` (the Docker image sets that), otherwise the app refuses to start. |
| `PORT` | Port to listen on (default 3000). |
| `DB_PATH` | Location of the SQLite file (default `data/borrowbox.db`; `/app/data/borrowbox.db` in Docker). |
| `ADMIN_EMAILS` | Comma-separated emails that become college admins when they sign up. |
| `COOKIE_SECURE` | Set to `true` when the site is served over HTTPS. |
| `TRUST_PROXY` | Number of proxies in front of the app (use `1` on Render or behind a load balancer) so rate limiting sees real client addresses. |

Generate a secret with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Adding or changing colleges

Edit `data/colleges.json` (name, campus, email domain) and restart. A student
can sign up if their email domain equals a college's domain or is a subdomain of
it.

## Running with Docker

```bash
docker build -t borrowbox .
docker run -d --name borrowbox -p 3000:3000 \
  -e SESSION_SECRET=replace-with-a-long-random-string \
  -v borrowbox-data:/app/data \
  borrowbox
```

The `-v` flag keeps the database when the container is replaced. The container
reports health at `/health` (a quick database check).

## Running tests

```bash
npm test
```

## Routes

| Route | Method | Who | Purpose |
|---|---|---|---|
| `/` | GET | everyone | Landing page (logged-in users go to the marketplace) |
| `/register`, `/login` | GET, POST | everyone | Create account, log in |
| `/logout` | POST | logged in | Log out |
| `/colleges/lookup?email=` | GET | everyone | Shows the college and campus for an email |
| `/marketplace` | GET | logged in | Items from your college (search and category filter) |
| `/locker` | GET, POST | logged in | Your lendable items, add an item |
| `/locker/:id/delete` | POST | owner or college admin | Remove an item |
| `/needs` | GET, POST | logged in | Needed board, post a need |
| `/needs/:id/fulfil`, `/needs/:id/delete` | POST | owner (delete: or admin) | Mark found, remove |
| `/items/:id/request` | POST | logged in | Ask to borrow an item |
| `/requests` | GET | logged in | Requests to you and from you |
| `/requests/:id/accept`, `/decline`, `/return` | POST | owner | Handle a request |
| `/requests/:id/cancel` | POST | borrower | Withdraw a pending request |
| `/admin` | GET | college admin | Members, items and posts for your college |
| `/health` | GET | everyone | Health check for Docker, hosting and the pipeline |

## Project structure

```
BorrowBox/
├── data/            # database setup (db.js) and the list of colleges
├── lib/             # matching logic and security helpers
├── routes/          # auth.js (accounts) and market.js (everything else)
├── views/           # EJS pages and shared header/footer
├── public/          # style.css and a little browser script (app.js)
├── tests/           # Jest + Supertest test suite
├── Dockerfile
├── Jenkinsfile
├── server.js        # builds and starts the app
└── package.json
```

## Known limits

- Email ownership is not verified yet: the app checks the email *domain* only.
  A verification code sent by email would be the next step.
- SQLite is a single file, so run one copy of the app per database file. To run
  several copies (for example on Kubernetes), move the data to a shared database
  such as Postgres. The queries are all in `data/db.js` and `routes/`.
- Matching is simple keyword overlap, not AI.
