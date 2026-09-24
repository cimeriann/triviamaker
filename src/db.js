const { MongoClient } = require("mongodb");

// The database can be shared with other apps, so every collection this app
// uses starts with "trivia_" to keep its data separate.
const COLLECTION_NAMES = {
  quizzes: "trivia_quizzes",
  sessions: "trivia_sessions",
};

// Filled in by connectToDatabase() before the server starts taking requests.
const collections = {};

async function connectToDatabase(databaseUrl) {
  const client = new MongoClient(databaseUrl);
  await client.connect();

  // Uses the database named in the connection string (the part after ".net/").
  const db = client.db();
  collections.quizzes = db.collection(COLLECTION_NAMES.quizzes);
  collections.sessions = db.collection(COLLECTION_NAMES.sessions);

  // Creating the indexes also creates the collections the first time the app runs.
  await collections.quizzes.createIndexes([
    { key: { id: 1 }, unique: true },
    { key: { slug: 1 }, unique: true },
    { key: { status: 1, visibility: 1, updatedAt: -1 } },
  ]);
  await collections.sessions.createIndexes([
    { key: { id: 1 }, unique: true },
    { key: { quizId: 1, score: -1, completedAt: 1 } },
  ]);

  return db;
}

module.exports = { COLLECTION_NAMES, collections, connectToDatabase };
