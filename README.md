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
- Local JSON persistence with rolling backups

## Tech stack

- Node.js + Express
- Vanilla HTML/CSS/JS frontend
- JSON file datastore (`data/store.json`)

## Getting started

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Scripts

- `npm run dev`: start local server
- `npm start`: start local server

## Environment configuration

Copy `.env.example` values into your environment (or `.env` if your shell loads it):

- `PORT`: server port
- `DATA_FILE`: path to persistent JSON store
- `BACKUP_DIR`: path for rolling backup snapshots
- `TRUST_PROXY`: `true` if deployed behind a reverse proxy

## Data model summary

- **users**: reserved for creator/player identity expansion
- **quizzes**: title/description/questions, visibility, slug, status, creator info, edit token
- **sessions**: player game sessions, answers, score, completion timestamp

## Moderation and access controls

- Visibility modes: `private`, `unlisted`, `public`
- Private quizzes cannot be played publicly
- Editing requires creator-specific `editToken`

## Deployment and reliability notes

- Set environment variables for data and backup paths
- All writes are atomic (temp file + rename)
- A timestamped backup is created on each write (latest 20 kept)
- Request and error logs are emitted to stdout/stderr

## Launch iteration plan

1. Share MVP with friends and collect quiz creation/playability feedback.
2. Prioritize next features: timers, images, themed packs.
3. Add real-time lobby/multiplayer mode after async flow is stable.
