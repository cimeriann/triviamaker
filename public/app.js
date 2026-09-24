const $ = (id) => document.getElementById(id);

const state = {
  activeQuiz: null,
  sessionId: null,
  questionIndex: 0,
  playSlug: null,
  myQuizzes: JSON.parse(localStorage.getItem("tm_my_quizzes") || "[]"),
};

function saveMyQuizzes() {
  localStorage.setItem("tm_my_quizzes", JSON.stringify(state.myQuizzes.slice(0, 20)));
}

function notify(message, type = "success") {
  const alerts = $("alerts");
  alerts.innerHTML = `<div class="alert ${type === "error" ? "error" : "success"}">${message}</div>`;
  setTimeout(() => {
    alerts.innerHTML = "";
  }, 5000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || (data.errors && data.errors.join(" ")) || "Request failed";
    throw new Error(msg);
  }
  return data;
}

function buildQuestionEditor(question = {}) {
  const wrap = document.createElement("div");
  wrap.className = "question";
  wrap.innerHTML = `
    <label>Question
      <input class="q-prompt" maxlength="200" value="${question.prompt || ""}" placeholder="Question text" />
    </label>
    <label>Option 1
      <input class="q-opt" value="${question.options?.[0] || ""}" placeholder="Option 1" />
    </label>
    <label>Option 2
      <input class="q-opt" value="${question.options?.[1] || ""}" placeholder="Option 2" />
    </label>
    <label>Option 3
      <input class="q-opt" value="${question.options?.[2] || ""}" placeholder="Option 3" />
    </label>
    <label>Option 4
      <input class="q-opt" value="${question.options?.[3] || ""}" placeholder="Option 4" />
    </label>
    <label>Correct option
      <select class="q-correct">
        <option value="0">Option 1</option>
        <option value="1">Option 2</option>
        <option value="2">Option 3</option>
        <option value="3">Option 4</option>
      </select>
    </label>
    <button type="button" class="remove-q">Remove question</button>
  `;

  wrap.querySelector(".q-correct").value = String(question.correctIndex || 0);
  wrap.querySelector(".remove-q").addEventListener("click", () => wrap.remove());
  return wrap;
}

function collectQuizFromForm() {
  const questionNodes = [...$("questions").querySelectorAll(".question")];
  const questions = questionNodes.map((node) => {
    const options = [...node.querySelectorAll(".q-opt")].map((i) => i.value.trim());
    return {
      prompt: node.querySelector(".q-prompt").value.trim(),
      options,
      correctIndex: Number(node.querySelector(".q-correct").value),
    };
  });

  return {
    creatorName: $("creator-name").value.trim(),
    title: $("quiz-title").value.trim(),
    description: $("quiz-description").value.trim(),
    visibility: $("quiz-visibility").value,
    questions,
  };
}

function renderMyQuizzes() {
  const container = $("my-quizzes");
  if (!state.myQuizzes.length) {
    container.innerHTML = `<p class="muted">No saved quizzes yet.</p>`;
    return;
  }

  container.innerHTML = "";
  state.myQuizzes.forEach((quizRef, index) => {
    const item = document.createElement("div");
    item.className = "question";
    item.innerHTML = `
      <strong>${quizRef.title}</strong>
      <div class="muted">${quizRef.slug} • ${quizRef.status}</div>
      <div class="row">
        <button data-action="load">Load</button>
        <button data-action="copy">Copy link</button>
        <button data-action="forget">Forget</button>
      </div>
    `;

    item.querySelector('[data-action="load"]').addEventListener("click", () => loadQuizForEdit(quizRef));
    item.querySelector('[data-action="copy"]').addEventListener("click", async () => {
      await navigator.clipboard.writeText(`${location.origin}/?play=${quizRef.slug}`);
      notify("Share link copied.");
    });
    item.querySelector('[data-action="forget"]').addEventListener("click", () => {
      state.myQuizzes.splice(index, 1);
      saveMyQuizzes();
      renderMyQuizzes();
    });

    container.appendChild(item);
  });
}

async function loadQuizForEdit(quizRef) {
  try {
    const data = await api(`/api/quizzes/${quizRef.id}/manage?editToken=${encodeURIComponent(quizRef.editToken)}`);
    const { quiz } = data;
    $("quiz-id").value = quiz.id;
    $("edit-token").value = quiz.creatorEditToken;
    $("creator-name").value = quiz.creatorName;
    $("quiz-title").value = quiz.title;
    $("quiz-description").value = quiz.description;
    $("quiz-visibility").value = quiz.visibility;
    const questions = $("questions");
    questions.innerHTML = "";
    quiz.questions.forEach((q) => questions.appendChild(buildQuestionEditor(q)));
    if (!quiz.questions.length) questions.appendChild(buildQuestionEditor());
    notify("Loaded quiz for editing.");
  } catch (err) {
    notify(err.message, "error");
  }
}

function upsertMyQuiz(ref) {
  const existing = state.myQuizzes.find((q) => q.id === ref.id);
  if (existing) Object.assign(existing, ref);
  else state.myQuizzes.unshift(ref);
  saveMyQuizzes();
  renderMyQuizzes();
}

async function submitQuiz(action) {
  const payload = collectQuizFromForm();
  payload.publish = action === "publish";

  const quizId = $("quiz-id").value;
  const editToken = $("edit-token").value;

  try {
    const response = quizId
      ? await api(`/api/quizzes/${quizId}?editToken=${encodeURIComponent(editToken)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
      : await api("/api/quizzes", {
          method: "POST",
          body: JSON.stringify(payload),
        });

    const quiz = response.quiz;
    $("quiz-id").value = quiz.id;
    $("edit-token").value = quiz.editToken;

    const shareLink = `${location.origin}/?play=${quiz.slug}`;
    const shareBox = $("share-box");
    shareBox.classList.remove("hidden");
    shareBox.innerHTML = `
      <div class="question">
        <strong>${quiz.status === "published" ? "Published" : "Draft saved"}</strong>
        <div class="muted">Code: ${quiz.slug}</div>
        <input value="${shareLink}" readonly />
        <div class="row">
          <button id="copy-link-btn">Copy link</button>
          <button id="open-link-btn">Open</button>
        </div>
      </div>
    `;

    $("copy-link-btn").addEventListener("click", async () => {
      await navigator.clipboard.writeText(shareLink);
      notify("Share link copied.");
    });

    $("open-link-btn").addEventListener("click", () => {
      window.open(shareLink, "_blank");
    });

    upsertMyQuiz({
      id: quiz.id,
      slug: quiz.slug,
      editToken: quiz.editToken,
      status: quiz.status,
      title: payload.title,
    });

    notify(quiz.status === "published" ? "Quiz published." : "Draft saved.");
  } catch (err) {
    notify(err.message, "error");
  }
}

async function loadPublicQuizzes() {
  const target = $("public-quizzes");
  try {
    const { quizzes } = await api("/api/quizzes/public");
    if (!quizzes.length) {
      target.innerHTML = `<p class="muted">No public quizzes yet.</p>`;
      return;
    }

    target.innerHTML = "";
    quizzes.forEach((quiz) => {
      const item = document.createElement("div");
      item.className = "question";
      item.innerHTML = `
        <strong>${quiz.title}</strong>
        <div class="muted">${quiz.questionCount} questions • ${quiz.slug}</div>
        <button>Play this quiz</button>
      `;
      item.querySelector("button").addEventListener("click", () => {
        $("play-slug").value = quiz.slug;
        location.hash = "#play";
      });
      target.appendChild(item);
    });
  } catch (err) {
    target.innerHTML = `<p class="muted">Failed to load public quizzes.</p>`;
  }
}

function showGameView() {
  $("play-card").classList.remove("hidden");
  $("result-card").classList.add("hidden");
}

function renderCurrentQuestion() {
  const question = state.activeQuiz.questions[state.questionIndex];
  if (!question) return;

  $("play-title").textContent = state.activeQuiz.title;
  $("play-progress").textContent = `Question ${state.questionIndex + 1} of ${state.activeQuiz.questions.length}`;

  const box = $("question-box");
  box.innerHTML = `<div class="question"><h3>${question.prompt}</h3></div>`;

  question.options.forEach((opt, index) => {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.textContent = opt;
    btn.addEventListener("click", async () => {
      try {
        const result = await api(`/api/play/session/${state.sessionId}/answer`, {
          method: "POST",
          body: JSON.stringify({ selectedIndex: index }),
        });

        if (result.finished) {
          await loadResult();
        } else {
          state.questionIndex += 1;
          renderCurrentQuestion();
        }
      } catch (err) {
        notify(err.message, "error");
      }
    });

    box.appendChild(btn);
  });
}

async function loadResult() {
  const { result } = await api(`/api/play/session/${state.sessionId}/result`);
  $("play-card").classList.add("hidden");
  $("result-card").classList.remove("hidden");
  $("score-text").textContent = `${result.displayName}, you scored ${result.score}/${result.total}`;

  const review = $("answer-review");
  review.innerHTML = "";
  result.details.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `question ${entry.isCorrect ? "correct" : "incorrect"}`;
    item.innerHTML = `
      <strong>${entry.prompt}</strong>
      <div class="muted">Your answer: ${entry.selectedIndex != null ? entry.options[entry.selectedIndex] : "(none)"}</div>
      <div class="muted">Correct answer: ${entry.options[entry.correctIndex]}</div>
    `;
    review.appendChild(item);
  });

  await loadLeaderboard(state.playSlug);
}

async function loadLeaderboard(slug) {
  const holder = $("leaderboard");
  try {
    const { leaderboard } = await api(`/api/quizzes/${encodeURIComponent(slug)}/leaderboard`);
    if (!leaderboard.length) {
      holder.innerHTML = `<p class="muted">No completed games yet.</p>`;
      return;
    }

    holder.innerHTML = "";
    leaderboard.forEach((entry) => {
      const line = document.createElement("div");
      line.className = "question";
      line.textContent = `#${entry.rank} ${entry.displayName} — ${entry.score}/${entry.total}`;
      holder.appendChild(line);
    });
  } catch {
    holder.innerHTML = `<p class="muted">Could not load leaderboard.</p>`;
  }
}

async function startGame() {
  const slug = $("play-slug").value.trim();
  const displayName = $("play-name").value.trim();

  if (!slug) return notify("Please enter a quiz code.", "error");
  if (!displayName) return notify("Please enter your display name.", "error");

  try {
    const { sessionId, quiz } = await api(`/api/play/${encodeURIComponent(slug)}/start`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });

    state.sessionId = sessionId;
    state.activeQuiz = quiz;
    state.questionIndex = 0;
    state.playSlug = slug;
    showGameView();
    renderCurrentQuestion();
  } catch (err) {
    notify(err.message, "error");
  }
}

function resetFormIfEmpty() {
  if (!$("questions").children.length) {
    $("questions").appendChild(buildQuestionEditor());
  }
}

function wireEvents() {
  $("add-question-btn").addEventListener("click", () => {
    $("questions").appendChild(buildQuestionEditor());
  });

  $("quiz-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const action = event.submitter?.dataset?.action || "draft";
    submitQuiz(action);
  });

  $("start-game-btn").addEventListener("click", startGame);

  $("replay-btn").addEventListener("click", () => {
    $("result-card").classList.add("hidden");
    startGame();
  });

  $("back-home-btn").addEventListener("click", () => {
    $("result-card").classList.add("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function bootstrapFromUrl() {
  const playSlug = new URLSearchParams(location.search).get("play");
  if (playSlug) {
    $("play-slug").value = playSlug;
    location.hash = "#play";
  }
}

async function init() {
  wireEvents();
  resetFormIfEmpty();
  renderMyQuizzes();
  bootstrapFromUrl();
  await loadPublicQuizzes();
}

init();
