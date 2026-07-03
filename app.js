const Core = window.WindVocabCore;
const STORAGE_KEY = "wind-vocab-flashcards-state";

const defaultState = {
  decks: [],
  cards: [],
  sessions: [],
  settings: {
    theme: "light",
    accent: "#0f766e",
  },
  activeDeckId: "all",
  activeTag: "all",
};

let state = loadState();
let review = {
  queue: [],
  index: 0,
  flipped: false,
  session: null,
};
let pendingImage = "";
let pendingAudio = "";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  tabs: $$(".tab"),
  views: $$(".view"),
  themeToggle: $("#themeToggle"),
  deckFilter: $("#deckFilter"),
  tagFilter: $("#tagFilter"),
  startReview: $("#startReview"),
  flashcard: $("#flashcard"),
  cardStatus: $("#cardStatus"),
  mediaSlot: $("#mediaSlot"),
  cardText: $("#cardText"),
  cardAudio: $("#cardAudio"),
  flipCard: $("#flipCard"),
  confidenceGrid: $("#confidenceGrid"),
  excelInput: $("#excelInput"),
  bundleInput: $("#bundleInput"),
  exportJson: $("#exportJson"),
  exportTsv: $("#exportTsv"),
  cardForm: $("#cardForm"),
  deckName: $("#deckName"),
  cardTags: $("#cardTags"),
  cardFront: $("#cardFront"),
  cardBack: $("#cardBack"),
  imageInput: $("#imageInput"),
  audioInput: $("#audioInput"),
  cardNotes: $("#cardNotes"),
  searchCards: $("#searchCards"),
  libraryDeckFilter: $("#libraryDeckFilter"),
  deleteVisibleCards: $("#deleteVisibleCards"),
  cardList: $("#cardList"),
  statTotal: $("#statTotal"),
  statDue: $("#statDue"),
  statMastered: $("#statMastered"),
  statAccuracy: $("#statAccuracy"),
  weekChart: $("#weekChart"),
  sessionList: $("#sessionList"),
  themeSelect: $("#themeSelect"),
  accentColor: $("#accentColor"),
  resetDemo: $("#resetDemo"),
  clearData: $("#clearData"),
  toast: $("#toast"),
};

init();

function init() {
  applyTheme();
  wireEvents();
  if (state.cards.length === 0) {
    seedDemoData(false);
  }
  renderAll();
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...defaultState, ...JSON.parse(saved) } : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function wireEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  els.themeToggle.addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    saveState();
    applyTheme();
    renderSettings();
  });

  els.deckFilter.addEventListener("change", () => {
    state.activeDeckId = els.deckFilter.value;
    saveState();
    renderReviewIdle();
  });

  els.tagFilter.addEventListener("change", () => {
    state.activeTag = els.tagFilter.value;
    saveState();
    renderReviewIdle();
  });

  els.startReview.addEventListener("click", startReviewSession);
  els.flipCard.addEventListener("click", flipCard);
  els.flashcard.addEventListener("click", flipCard);
  els.confidenceGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-score]");
    if (button) rateCurrentCard(Number(button.dataset.score));
  });

  els.excelInput.addEventListener("change", handleExcelImport);
  els.bundleInput.addEventListener("change", handleBundleImport);
  els.exportJson.addEventListener("click", () => downloadText("wind-vocab-deck.json", Core.exportDeckBundle(state), "application/json"));
  els.exportTsv.addEventListener("click", () => downloadText("wind-vocab-anki.tsv", Core.cardsToAnkiTsv(filteredCards()), "text/tab-separated-values"));

  els.imageInput.addEventListener("change", async () => {
    pendingImage = await readFileAsDataUrl(els.imageInput.files[0]);
    showToast("图片已载入");
  });

  els.audioInput.addEventListener("change", async () => {
    pendingAudio = await readFileAsDataUrl(els.audioInput.files[0]);
    showToast("音频已载入");
  });

  els.cardForm.addEventListener("submit", handleCardSubmit);
  els.searchCards.addEventListener("input", renderLibrary);
  els.libraryDeckFilter.addEventListener("change", renderLibrary);
  els.deleteVisibleCards.addEventListener("click", deleteVisibleCards);

  els.themeSelect.addEventListener("change", () => {
    state.settings.theme = els.themeSelect.value;
    saveState();
    applyTheme();
  });

  els.accentColor.addEventListener("input", () => {
    state.settings.accent = els.accentColor.value;
    saveState();
    applyTheme();
  });

  els.resetDemo.addEventListener("click", () => {
    seedDemoData(true);
    renderAll();
    showToast("示例词汇已载入");
  });

  els.clearData.addEventListener("click", () => {
    if (!confirm("确认清空本地数据？")) return;
    state = structuredClone(defaultState);
    review = { queue: [], index: 0, flipped: false, session: null };
    saveState();
    applyTheme();
    renderAll();
    showToast("本地数据已清空");
  });

  document.addEventListener("keydown", handleShortcuts);
}

function switchView(viewId) {
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === viewId));
  els.views.forEach((view) => view.classList.toggle("is-active", view.id === viewId));
  if (viewId === "statsView") renderStats();
  if (viewId === "libraryView") renderLibrary();
}

function applyTheme() {
  document.body.dataset.theme = state.settings.theme || "light";
  document.documentElement.style.setProperty("--accent", state.settings.accent || "#0f766e");
  document.documentElement.style.setProperty("--accent-strong", state.settings.accent || "#115e59");
}

function renderAll() {
  renderFilters();
  renderReviewIdle();
  renderLibrary();
  renderStats();
  renderSettings();
}

function renderFilters() {
  const deckOptions = [
    ["all", "全部牌组"],
    ...state.decks.map((deck) => [deck.id, deck.name]),
  ];
  fillSelect(els.deckFilter, deckOptions, state.activeDeckId);
  fillSelect(els.libraryDeckFilter, deckOptions, els.libraryDeckFilter.value || "all");

  const tags = Array.from(new Set(state.cards.flatMap((card) => card.tags || []))).sort();
  const tagOptions = [["all", "全部标签"], ...tags.map((tag) => [tag, tag])];
  fillSelect(els.tagFilter, tagOptions, state.activeTag);
}

function fillSelect(select, options, value) {
  select.innerHTML = options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}">${escapeHtml(label)}</option>`).join("");
  select.value = options.some(([optionValue]) => optionValue === value) ? value : "all";
}

function filteredCards({ includeFuture = false } = {}) {
  const now = new Date();
  return state.cards.filter((card) => {
    const deckMatches = state.activeDeckId === "all" || card.deckId === state.activeDeckId;
    const tagMatches = state.activeTag === "all" || (card.tags || []).includes(state.activeTag);
    const dueMatches = includeFuture || !card.dueAt || new Date(card.dueAt) <= now;
    return deckMatches && tagMatches && dueMatches;
  });
}

function renderReviewIdle() {
  const due = filteredCards();
  review.queue = [];
  review.index = 0;
  review.flipped = false;
  review.session = null;
  els.cardStatus.textContent = `到期 ${due.length} / 总计 ${filteredCards({ includeFuture: true }).length}`;
  els.cardText.textContent = due.length ? "点击开始复习" : "当前筛选下没有到期卡片";
  els.mediaSlot.innerHTML = "";
  els.cardAudio.hidden = true;
  els.flipCard.textContent = "显示答案";
}

function startReviewSession() {
  const queue = filteredCards().sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));
  if (queue.length === 0) {
    showToast("没有到期卡片");
    renderReviewIdle();
    return;
  }
  review = {
    queue,
    index: 0,
    flipped: false,
    session: {
      id: makeId("session"),
      startedAt: new Date().toISOString(),
      reviewed: 0,
      correct: 0,
      deckId: state.activeDeckId,
      tag: state.activeTag,
    },
  };
  renderCurrentCard();
}

function renderCurrentCard() {
  const card = review.queue[review.index];
  if (!card) {
    finishReviewSession();
    return;
  }
  els.cardStatus.textContent = `${review.index + 1} / ${review.queue.length}`;
  els.cardText.innerHTML = review.flipped ? renderAnswer(card) : escapeHtml(card.front || "无英文词汇");
  els.mediaSlot.innerHTML = card.image ? `<img src="${card.image}" alt="">` : "";
  if (card.audio) {
    els.cardAudio.src = card.audio;
    els.cardAudio.hidden = false;
  } else {
    els.cardAudio.removeAttribute("src");
    els.cardAudio.hidden = true;
  }
  els.flipCard.textContent = review.flipped ? "隐藏答案" : "显示答案";
}

function renderAnswer(card) {
  const notes = card.notes ? `<p class="answer-notes">${escapeHtml(card.notes)}</p>` : "";
  return `
    <div class="answer-block">
      <strong>${escapeHtml(card.back || "无中文释义")}</strong>
      ${notes}
    </div>
  `;
}

function flipCard() {
  if (!review.queue.length) return;
  review.flipped = !review.flipped;
  renderCurrentCard();
}

function rateCurrentCard(score) {
  const card = review.queue[review.index];
  if (!card) {
    showToast("先开始复习");
    return;
  }
  if (!review.flipped) {
    review.flipped = true;
    renderCurrentCard();
    return;
  }

  const updated = Core.scheduleReview(card, score, new Date());
  state.cards = state.cards.map((item) => (item.id === card.id ? updated : item));
  review.session.reviewed += 1;
  review.session.correct += score >= 3 ? 1 : 0;
  review.index += 1;
  review.flipped = false;
  saveState();
  renderCurrentCard();
  renderFilters();
  renderStats();
}

function finishReviewSession() {
  if (review.session && review.session.reviewed > 0) {
    state.sessions.unshift({
      ...review.session,
      endedAt: new Date().toISOString(),
    });
    state.sessions = state.sessions.slice(0, 100);
    saveState();
    showToast(`本次复习 ${review.session.reviewed} 张`);
  }
  renderReviewIdle();
}

async function handleExcelImport(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!window.XLSX) {
    showToast("Excel 解析库未加载");
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheets = {};
    workbook.SheetNames.forEach((name) => {
      sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" });
    });
    const imported = Core.normalizeImportedWorkbook(sheets, file.name.replace(/\.[^.]+$/, ""));
    mergeImported(imported);
    showToast(`已导入 ${imported.cards.length} 张卡片`);
  } catch (error) {
    showToast(error.message || "导入失败");
  }
}

async function handleBundleImport(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const imported = Core.importDeckBundle(await file.text());
    mergeImported(imported);
    showToast("牌组已导入");
  } catch (error) {
    showToast(error.message || "导入失败");
  }
}

function mergeImported(imported) {
  state.decks = [...state.decks, ...(imported.decks || [])];
  state.cards = [...state.cards, ...(imported.cards || [])];
  state.sessions = [...(imported.sessions || []), ...state.sessions];
  if (imported.settings?.accent && state.cards.length === imported.cards.length) {
    state.settings = { ...state.settings, ...imported.settings };
  }
  if (imported.decks?.[0]) state.activeDeckId = imported.decks[0].id;
  saveState();
  applyTheme();
  renderAll();
}

async function handleCardSubmit(event) {
  event.preventDefault();
  const deck = getOrCreateDeck(els.deckName.value || "风电词汇");
  const tags = els.cardTags.value
    .split(/[,，、]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const card = Core.createCard({
    deckId: deck.id,
    front: els.cardFront.value,
    back: els.cardBack.value,
    tags,
    image: pendingImage,
    audio: pendingAudio,
    notes: els.cardNotes.value,
  });
  state.cards.unshift(card);
  state.activeDeckId = deck.id;
  pendingImage = "";
  pendingAudio = "";
  els.cardForm.reset();
  saveState();
  renderAll();
  showToast("卡片已保存");
}

function getOrCreateDeck(name) {
  const cleanName = name.trim() || "风电词汇";
  let deck = state.decks.find((item) => item.name === cleanName);
  if (!deck) {
    deck = {
      id: makeId("deck"),
      name: cleanName,
      description: "",
      createdAt: new Date().toISOString(),
    };
    state.decks.unshift(deck);
  }
  return deck;
}

function renderLibrary() {
  const cards = getLibraryVisibleCards();

  els.cardList.innerHTML =
    cards
      .map((card) => {
        const deck = state.decks.find((item) => item.id === card.deckId);
        const dueText = card.dueAt ? new Date(card.dueAt).toLocaleDateString("zh-CN") : "今天";
        return `
          <article class="word-row">
            <header>
              <div>
                <strong>${escapeHtml(card.front)}</strong>
                <p>${escapeHtml(card.back)}</p>
              </div>
              <div class="tiny-actions">
                <button type="button" data-edit="${card.id}" aria-label="编辑卡片">改</button>
                <button type="button" data-delete="${card.id}" aria-label="删除卡片">删</button>
              </div>
            </header>
            ${card.notes ? `<p>${escapeHtml(card.notes)}</p>` : ""}
            <p>${escapeHtml(deck?.name || "未命名牌组")} · 下次 ${escapeHtml(dueText)} · 间隔 ${card.interval || 0} 天</p>
            <div class="tag-line">${(card.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
          </article>
        `;
      })
      .join("") || `<div class="word-row"><p>没有匹配卡片</p></div>`;

  els.deleteVisibleCards.disabled = cards.length === 0;
  els.deleteVisibleCards.textContent = cards.length ? `删除当前结果 (${cards.length})` : "删除当前结果";

  els.cardList.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteCard(button.dataset.delete));
  });
  els.cardList.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => loadCardIntoForm(button.dataset.edit));
  });
}

function getLibraryVisibleCards() {
  const deckId = els.libraryDeckFilter.value || "all";
  const keyword = els.searchCards.value.trim().toLowerCase();
  return state.cards.filter((card) => {
    const deckMatches = deckId === "all" || card.deckId === deckId;
    const haystack = [card.front, card.back, card.notes, ...(card.tags || [])].join(" ").toLowerCase();
    return deckMatches && (!keyword || haystack.includes(keyword));
  });
}

function deleteCard(cardId) {
  state = Core.deleteCardsByIds(state, [cardId]);
  saveState();
  renderAll();
  showToast("卡片已删除");
}

function deleteVisibleCards() {
  const cards = getLibraryVisibleCards();
  if (cards.length === 0) return;
  const confirmed = confirm(`确认删除当前词库结果中的 ${cards.length} 张卡片？`);
  if (!confirmed) return;
  state = Core.deleteCardsByIds(
    state,
    cards.map((card) => card.id)
  );
  saveState();
  renderAll();
  showToast(`已删除 ${cards.length} 张卡片`);
}

function loadCardIntoForm(cardId) {
  const card = state.cards.find((item) => item.id === cardId);
  if (!card) return;
  const deck = state.decks.find((item) => item.id === card.deckId);
  els.deckName.value = deck?.name || "";
  els.cardTags.value = (card.tags || []).join(",");
  els.cardFront.value = card.front || "";
  els.cardBack.value = card.back || "";
  els.cardNotes.value = card.notes || "";
  pendingImage = card.image || "";
  pendingAudio = card.audio || "";
  state.cards = state.cards.filter((item) => item.id !== cardId);
  saveState();
  renderAll();
  showToast("卡片已载入编辑区");
}

function renderStats() {
  const stats = Core.buildStats(state.cards, state.sessions, new Date());
  els.statTotal.textContent = stats.totalCards;
  els.statDue.textContent = stats.dueCards;
  els.statMastered.textContent = stats.masteredCards;
  els.statAccuracy.textContent = `${stats.accuracy}%`;

  const max = Math.max(1, ...stats.lastSeven.map((item) => item.reviewed));
  els.weekChart.innerHTML = stats.lastSeven
    .map((item) => {
      const height = Math.max(6, Math.round((item.reviewed / max) * 150));
      return `<div class="bar"><span style="height:${height}px"></span><span>${item.date.slice(5)}</span></div>`;
    })
    .join("");

  els.sessionList.innerHTML =
    state.sessions
      .slice(0, 8)
      .map((session) => {
        const accuracy = session.reviewed ? Math.round((session.correct / session.reviewed) * 100) : 0;
        return `<div class="session-item">${new Date(session.startedAt).toLocaleString("zh-CN")} · ${session.reviewed} 张 · ${accuracy}%</div>`;
      })
      .join("") || `<div class="session-item">暂无复习会话</div>`;
}

function renderSettings() {
  els.themeSelect.value = state.settings.theme || "light";
  els.accentColor.value = state.settings.accent || "#0f766e";
}

function seedDemoData(replace) {
  if (replace) {
    state.decks = [];
    state.cards = [];
    state.sessions = [];
  }
  const deck = getOrCreateDeck("风电行业专业英语");
  const samples = [
    ["yaw system", "偏航系统", ["机组部件"]],
    ["blade pitch", "叶片变桨", ["控制系统"]],
    ["nacelle", "机舱", ["机组部件"]],
    ["gearbox", "齿轮箱", ["传动链"]],
    ["curtailment", "限电", ["电网", "运维"]],
    ["capacity factor", "容量系数", ["发电性能"]],
  ];
  const existing = new Set(state.cards.map((card) => `${card.front}-${card.back}`));
  samples.forEach(([front, back, tags]) => {
    if (!existing.has(`${front}-${back}`)) {
      state.cards.push(Core.createCard({ deckId: deck.id, front, back, tags }));
    }
  });
  state.activeDeckId = deck.id;
  saveState();
}

function handleShortcuts(event) {
  const active = document.activeElement;
  const editing = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
  if (editing) return;

  if (event.code === "Space" || event.key === "Enter") {
    event.preventDefault();
    flipCard();
  }

  if (/^[1-6]$/.test(event.key)) {
    event.preventDefault();
    rateCurrentCard(Number(event.key) - 1);
  }

  if (event.key.toLowerCase() === "r") {
    startReviewSession();
  }

  if (event.key.toLowerCase() === "t") {
    els.themeToggle.click();
  }
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readFileAsDataUrl(file) {
  if (!file) return "";
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
}

function makeId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
