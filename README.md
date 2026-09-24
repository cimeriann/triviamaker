# TriviaMaker

Asynchronous friend-sharing trivia game MVP.

## MVP features

- Create trivia quizzes with title, description, visibility, and questions
- Save draft quizzes and publish when ready
- Share published quizzes using link/code (`?play=<slug>`)
- Play in browser with per-question scoring
- Results review with correct answers and replay
- Quiz leaderboard (top 10 completed sessions)
- Public quiz discovery list
- Basic abuse protection using rate limits on public play endpoints
- MongoDB persistence (works with a free MongoDB Atlas cluster)

## Tech stack

- Node.js (20.19 or newer) + Express
- Vanilla HTML/CSS/JS frontend
- MongoDB via the official `mongodb` driver

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file from the example:

   ```bash
   cp .env.example .env
   ```

3. Open `.env` and set `DATABASE_URL` to your MongoDB connection string. In MongoDB Atlas it's under **Connect → Drivers**.
4. In MongoDB Atlas, open **Network Access** and add your current IP address. Otherwise the connection times out.
5. Start the server:

   ```bash
   npm run dev
   ```

   You should see `Connected to MongoDB database "..."`. Then open `http://localhost:3000`.

`.env` is listed in `.gitignore`, so your database password is never committed. Don't put the connection string in any other file that goes to GitHub.

## Scripts

- `npm run dev`: start local server
- `npm start`: start local server

## Environment configuration

Set these in `.env` locally, or in your hosting provider's environment settings:

- `PORT`: server port
- `DATABASE_URL`: MongoDB connection string. The app uses the database named in the URL (the part after `.net/`)
- `TRUST_PROXY`: `true` if deployed behind a reverse proxy

## Data model summary

The app creates its collections (MongoDB's version of tables) the first time it starts. Every name starts with `trivia_`, so the app can share a database with other apps without touching their data:

- **trivia_quizzes**: title/description/questions, visibility, slug, status, creator info, edit token
- **trivia_sessions**: player game sessions, answers, score, completion timestamp

## Moderation and access controls

- Visibility modes: `private`, `unlisted`, `public`
- Private quizzes cannot be played publicly
- Editing requires creator-specific `editToken`

## Deployment and reliability notes

- Set `DATABASE_URL` in your host's environment settings (your `.env` file is not uploaded)
- Hosting providers connect from IP addresses that can change, so allow them under **Network Access** in Atlas. Many hobby projects allow `0.0.0.0/0` (any address); the database username and password still protect the data
- Request and error logs are emitted to stdout/stderr

## Troubleshooting

- **`DATABASE_URL is not set`**: create the `.env` file (step 2 above).
- **Connection times out** (`Server selection timed out`): your IP address isn't allowed under **Network Access** in Atlas.
- **`bad auth : authentication failed`**: the username or password in `DATABASE_URL` is wrong. If the password contains special characters such as `@`, `:` or `/`, they must be URL-encoded.

## Launch iteration plan

1. Share MVP with friends and collect quiz creation/playability feedback.
2. Prioritize next features: timers, images, themed packs.
3. Add real-time lobby/multiplayer mode after async flow is stable.
