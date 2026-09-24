const path = require("path");
// Load settings such as DATABASE_URL from the .env file in the project folder.
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const { COLLECTION_NAMES, collections, connectToDatabase } = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const TRUST_PROXY = (process.env.TRUST_PROXY || "false").toLowerCase() === "true";

app.set("trust proxy", TRUST_PROXY);
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
const SPA_INDEX_HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

function requestLog(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const elapsed = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${elapsed}ms`);
  });
  next();
}
app.use(requestLog);

// Leaves out MongoDB's internal _id field; the app uses its own `id` field.
const WITHOUT_MONGO_ID = { projection: { _id: 0 } };

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function createSlug(input) {
  const base = String(input || "quiz")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "quiz";

  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

function normalizeQuestion(question, index) {
  return {
    id: question.id || `q_${index + 1}_${crypto.randomBytes(2).toString("hex")}`,
    prompt: String(question.prompt || "").trim(),
    options: (Array.isArray(question.options) ? question.options : []).map((opt) => String(opt || "").trim()),
    correctIndex: Number(question.correctIndex),
  };
}

function validateQuestion(question) {
  if (!question.prompt) return "Question prompt is required.";
  if (question.prompt.length > 200) return "Question prompt is too long (max 200 chars).";
  if (!Array.isArray(question.options) || question.options.length < 2) return "Each question needs at least 2 options.";

  const nonEmpty = question.options.filter(Boolean);
  if (nonEmpty.length < 2) return "Each question needs at least 2 non-empty options.";

  const lowered = nonEmpty.map((v) => v.toLowerCase());
  if (new Set(lowered).size !== lowered.length) return "Question options must be unique.";

  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex >= question.options.length) {
    return "A valid correct answer must be selected.";
  }

  if (!question.options[question.correctIndex]) {
    return "Correct answer option cannot be empty.";
  }

  return null;
}

function validateQuizInput(payload, mode = "draft") {
  const errors = [];
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  const visibility = ["private", "unlisted", "public"].includes(payload.visibility) ? payload.visibility : "unlisted";
  const questions = (Array.isArray(payload.questions) ? payload.questions : []).map(normalizeQuestion);

  if (!title) errors.push("Title is required.");
  if (title.length > 100) errors.push("Title is too long (max 100 chars).");
  if (description.length > 500) errors.push("Description is too long (max 500 chars).");

  if (mode === "publish") {
    if (questions.length < 1) errors.push("At least one question is required to publish.");

    questions.forEach((question, idx) => {
      const err = validateQuestion(question);
      if (err) errors.push(`Question ${idx + 1}: ${err}`);
    });
  }

  return {
    errors,
    value: {
      title,
      description,
      visibility,
      questions,
      creatorName: String(payload.creatorName || "Guest").trim().slice(0, 60) || "Guest",
    },
  };
}

function publicQuizView(quiz) {
  return {
    id: quiz.id,
    slug: quiz.slug,
    title: quiz.title,
    description: quiz.description,
    visibility: quiz.visibility,
    questionCount: quiz.questions.length,
    questions: quiz.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      options: q.options,
    })),
  };
}

function requireEditToken(quiz, token) {
  return Boolean(token) && token === quiz.creatorEditToken;
}

const rateBuckets = new Map();
function rateLimit({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    rateBuckets.set(key, bucket);

    if (bucket.count > max) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    next();
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/quizzes/public", async (_req, res) => {
  const published = await collections.quizzes
    .find({ status: "published", visibility: "public" })
    .sort({ updatedAt: -1 })
    .toArray();
  const quizzes = published.map((quiz) => ({
    slug: quiz.slug,
    title: quiz.title,
    description: quiz.description,
    questionCount: quiz.questions.length,
    updatedAt: quiz.updatedAt,
  }));

  res.json({ quizzes });
});

app.post("/api/quizzes", async (req, res) => {
  const shouldPublish = req.body.publish === true;
  const { errors, value } = validateQuizInput(req.body, shouldPublish ? "publish" : "draft");

  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const now = new Date();
  const quiz = {
    id: newId("quiz"),
    slug: createSlug(value.title),
    title: value.title,
    description: value.description,
    visibility: value.visibility,
    questions: value.questions,
    creatorId: newId("user"),
    creatorName: value.creatorName,
    creatorEditToken: crypto.randomBytes(16).toString("hex"),
    status: shouldPublish ? "published" : "draft",
    createdAt: now,
    updatedAt: now,
  };

  await collections.quizzes.insertOne(quiz);

  return res.status(201).json({
    quiz: {
      id: quiz.id,
      slug: quiz.slug,
      status: quiz.status,
      editToken: quiz.creatorEditToken,
    },
  });
});

app.get("/api/quizzes/:quizId/manage", async (req, res) => {
  const { quizId } = req.params;
  const editToken = String(req.query.editToken || "");
  const quiz = await collections.quizzes.findOne({ id: quizId }, WITHOUT_MONGO_ID);

  if (!quiz) {
    return res.status(404).json({ error: "Quiz not found." });
  }

  if (!requireEditToken(quiz, editToken)) {
    return res.status(403).json({ error: "Invalid edit token." });
  }

  return res.json({ quiz });
});

app.put("/api/quizzes/:quizId", async (req, res) => {
  const { quizId } = req.params;
  const editToken = String(req.query.editToken || "");
  const quiz = await collections.quizzes.findOne({ id: quizId });

  if (!quiz) {
    return res.status(404).json({ error: "Quiz not found." });
  }

  if (!requireEditToken(quiz, editToken)) {
    return res.status(403).json({ error: "Invalid edit token." });
  }

  const mode = req.body.publish === true ? "publish" : "draft";
  const { errors, value } = validateQuizInput(req.body, mode);
  if (errors.length) {
    return res.status(400).json({ errors });
  }

  quiz.title = value.title;
  quiz.description = value.description;
  quiz.visibility = value.visibility;
  quiz.questions = value.questions;
  quiz.creatorName = value.creatorName;
  quiz.status = req.body.publish === true ? "published" : "draft";
  quiz.updatedAt = new Date();

  await collections.quizzes.replaceOne({ id: quiz.id }, quiz);

  return res.json({
    quiz: {
      id: quiz.id,
      slug: quiz.slug,
      status: quiz.status,
      editToken: quiz.creatorEditToken,
    },
  });
});

app.get("/api/play/:slug", rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "quiz-view" }), async (req, res) => {
  const { slug } = req.params;
  const quiz = await collections.quizzes.findOne({ slug });

  if (!quiz || quiz.status !== "published") {
    return res.status(404).json({ error: "Quiz not found." });
  }

  if (quiz.visibility === "private") {
    return res.status(403).json({ error: "This quiz is private." });
  }

  return res.json({ quiz: publicQuizView(quiz) });
});

app.post("/api/play/:slug/start", rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "quiz-start" }), async (req, res) => {
  const { slug } = req.params;
  const displayName = String(req.body.displayName || "").trim();

  if (!displayName) {
    return res.status(400).json({ error: "Display name is required." });
  }

  if (displayName.length > 40) {
    return res.status(400).json({ error: "Display name must be 40 characters or less." });
  }

  const quiz = await collections.quizzes.findOne({ slug });

  if (!quiz || quiz.status !== "published") {
    return res.status(404).json({ error: "Quiz not found." });
  }

  if (quiz.visibility === "private") {
    return res.status(403).json({ error: "This quiz is private." });
  }

  const session = {
    id: newId("session"),
    quizId: quiz.id,
    quizSlug: quiz.slug,
    displayName,
    startedAt: new Date(),
    completedAt: null,
    currentQuestion: 0,
    answers: [],
    score: 0,
  };

  await collections.sessions.insertOne(session);

  return res.status(201).json({
    sessionId: session.id,
    quiz: publicQuizView(quiz),
  });
});

app.post("/api/play/session/:sessionId/answer", rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "quiz-answer" }), async (req, res) => {
  const { sessionId } = req.params;
  const selectedIndex = Number(req.body.selectedIndex);

  const session = await collections.sessions.findOne({ id: sessionId });
  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }

  if (session.completedAt) {
    return res.status(400).json({ error: "Session already completed." });
  }

  const quiz = await collections.quizzes.findOne({ id: session.quizId });
  if (!quiz) {
    return res.status(404).json({ error: "Quiz not found." });
  }

  const question = quiz.questions[session.currentQuestion];
  if (!question) {
    return res.status(400).json({ error: "No remaining questions." });
  }

  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= question.options.length) {
    return res.status(400).json({ error: "Invalid answer option." });
  }

  const answeredQuestion = session.currentQuestion;
  const isCorrect = question.correctIndex === selectedIndex;
  session.answers.push({
    questionId: question.id,
    selectedIndex,
    correctIndex: question.correctIndex,
    isCorrect,
  });

  if (isCorrect) session.score += 1;
  session.currentQuestion += 1;

  const finished = session.currentQuestion >= quiz.questions.length;
  if (finished) {
    session.completedAt = new Date();
  }

  // Only save if this question is still unanswered, so two quick clicks
  // can't record two answers for the same question.
  const saved = await collections.sessions.replaceOne({ id: session.id, currentQuestion: answeredQuestion }, session);
  if (saved.matchedCount === 0) {
    return res.status(409).json({ error: "That question was already answered." });
  }

  return res.json({
    correct: isCorrect,
    finished,
    score: session.score,
    answered: session.answers.length,
    total: quiz.questions.length,
  });
});

app.get("/api/play/session/:sessionId/result", async (req, res) => {
  const { sessionId } = req.params;
  const session = await collections.sessions.findOne({ id: sessionId });

  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }

  const quiz = await collections.quizzes.findOne({ id: session.quizId });
  if (!quiz) {
    return res.status(404).json({ error: "Quiz not found." });
  }

  const details = quiz.questions.map((q, idx) => {
    const ans = session.answers[idx];
    return {
      prompt: q.prompt,
      options: q.options,
      correctIndex: q.correctIndex,
      selectedIndex: ans ? ans.selectedIndex : null,
      isCorrect: ans ? ans.isCorrect : false,
    };
  });

  return res.json({
    result: {
      sessionId: session.id,
      displayName: session.displayName,
      score: session.score,
      total: quiz.questions.length,
      completed: Boolean(session.completedAt),
      completedAt: session.completedAt,
      details,
    },
  });
});

app.get("/api/quizzes/:slug/leaderboard", async (req, res) => {
  const { slug } = req.params;
  const quiz = await collections.quizzes.findOne({ slug });

  if (!quiz || quiz.status !== "published") {
    return res.status(404).json({ error: "Quiz not found." });
  }

  const topSessions = await collections.sessions
    .find({ quizId: quiz.id, completedAt: { $ne: null } })
    .sort({ score: -1, completedAt: 1 })
    .limit(10)
    .toArray();
  const leaderboard = topSessions.map((s, idx) => ({
    rank: idx + 1,
    displayName: s.displayName,
    score: s.score,
    total: quiz.questions.length,
    completedAt: s.completedAt,
  }));

  return res.json({ leaderboard });
});

app.use(rateLimit({ windowMs: 60_000, max: 240, keyPrefix: "spa-fallback" }), (_req, res) => {
  res.type("html").send(SPA_INDEX_HTML);
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and put your MongoDB connection string in it.");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  const db = await connectToDatabase(DATABASE_URL);
  console.log(`Connected to MongoDB database "${db.databaseName}" (collections: ${Object.values(COLLECTION_NAMES).join(", ")})`);

  app.listen(PORT, () => {
    console.log(`TriviaMaker running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Could not connect to MongoDB:", error.message);
  console.error("Check DATABASE_URL in your .env file, and that your IP address is allowed under Network Access in MongoDB Atlas.");
  process.exit(1);
});
