(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.WindVocabCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function createId(prefix) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function hasChinese(text) {
    return /[\u3400-\u9fff]/.test(text);
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseVocabularyCell(value) {
    const text = cleanText(value);
    if (!text) return null;

    const separatorMatch = text.match(/^(.+?)\s*(?:[:：=－—-]+|=>|--)\s*(.+)$/);
    if (separatorMatch && hasChinese(separatorMatch[2])) {
      return {
        front: cleanText(separatorMatch[1]),
        back: cleanText(separatorMatch[2]),
      };
    }

    const firstChinese = text.search(/[\u3400-\u9fff]/);
    if (firstChinese > 0) {
      return {
        front: cleanText(text.slice(0, firstChinese)),
        back: cleanText(text.slice(firstChinese)),
      };
    }

    return {
      front: text,
      back: "",
    };
  }

  function createCard({ deckId, front, back, tags = [], image = "", audio = "", notes = "" }) {
    return {
      id: createId("card"),
      deckId,
      front: cleanText(front),
      back: cleanText(back),
      image,
      audio,
      notes: cleanText(notes),
      tags: Array.from(new Set(tags.map(cleanText).filter(Boolean))),
      interval: 0,
      ease: 2.5,
      dueAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: {
        reviews: 0,
        correct: 0,
        lapses: 0,
        streak: 0,
      },
    };
  }

  function normalizeImportedWorkbook(workbook, deckName) {
    const deck = {
      id: createId("deck"),
      name: cleanText(deckName) || "导入词汇",
      description: "从 Excel 工作簿导入",
      createdAt: new Date().toISOString(),
    };
    const cards = [];

    Object.entries(workbook || {}).forEach(([sheetName, rows]) => {
      const tableCards = parseTableSheet(rows, deck.id, sheetName);
      if (tableCards.length) {
        cards.push(...tableCards);
        return;
      }

      parseCellSheet(rows, deck.id, sheetName).forEach((card) => cards.push(card));
    });

    return { decks: [deck], cards };
  }

  function parseTableSheet(rows, deckId, sheetName) {
    const headerInfo = findVocabularyHeader(rows);
    if (!headerInfo) return [];

    const { headerIndex, chineseIndex, englishIndex, notesIndex } = headerInfo;
    return rows
      .slice(headerIndex + 1)
      .map((row) => {
        const front = cleanText(row?.[englishIndex]);
        const back = cleanText(row?.[chineseIndex]);
        const notes = notesIndex >= 0 ? cleanText(row?.[notesIndex]) : "";
        if (!front && !back) return null;
        return createCard({
          deckId,
          front,
          back,
          notes,
          tags: [sheetName],
        });
      })
      .filter(Boolean);
  }

  function parseCellSheet(rows, deckId, sheetName) {
    const cards = [];
    (rows || []).forEach((row) => {
      (row || []).forEach((cell) => {
        const parsed = parseVocabularyCell(cell);
        if (!parsed || !parsed.front) return;
        cards.push(
          createCard({
            deckId,
            front: parsed.front,
            back: parsed.back,
            tags: [sheetName],
          })
        );
      });
    });
    return cards;
  }

  function findVocabularyHeader(rows) {
    for (let rowIndex = 0; rowIndex < (rows || []).length; rowIndex += 1) {
      const normalized = (rows[rowIndex] || []).map((cell) => cleanText(cell).toLowerCase());
      const chineseIndex = normalized.findIndex((cell) => ["中文", "汉语", "释义", "翻译"].includes(cell));
      const englishIndex = normalized.findIndex((cell) => ["英文", "英语", "english", "word", "term"].includes(cell));
      const notesIndex = normalized.findIndex((cell) => ["备注", "说明", "note", "notes", "comment"].includes(cell));

      if (chineseIndex >= 0 && englishIndex >= 0) {
        return { headerIndex: rowIndex, chineseIndex, englishIndex, notesIndex };
      }
    }
    return null;
  }

  function clampConfidence(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(5, Math.round(number)));
  }

  function scheduleReview(card, confidence, date = new Date()) {
    const score = clampConfidence(confidence);
    const previousInterval = Math.max(0, Number(card.interval) || 0);
    const previousEase = Math.max(1.3, Number(card.ease) || 2.5);
    let interval = previousInterval;
    let ease = previousEase;

    const hasReviewHistory = (card.stats?.reviews || 0) > 0;

    if (score < 3) {
      interval = 1;
      ease = Math.max(1.3, previousEase - 0.2);
    } else if (!hasReviewHistory || previousInterval === 0) {
      interval = score >= 5 ? 6 : score >= 4 ? 3 : 1;
      ease = previousEase + (score - 3) * 0.08;
    } else {
      ease = Math.max(1.3, previousEase + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02)));
      interval = Math.max(1, Math.round(previousInterval * ease * (score >= 5 ? 1.15 : 1)));
    }

    const stats = {
      reviews: (card.stats?.reviews || 0) + 1,
      correct: (card.stats?.correct || 0) + (score >= 3 ? 1 : 0),
      lapses: (card.stats?.lapses || 0) + (score < 3 ? 1 : 0),
      streak: score >= 3 ? (card.stats?.streak || 0) + 1 : 0,
    };

    return {
      ...card,
      interval,
      ease: Number(ease.toFixed(2)),
      dueAt: new Date(date.getTime() + interval * DAY_MS).toISOString(),
      lastReviewedAt: date.toISOString(),
      updatedAt: date.toISOString(),
      stats,
    };
  }

  function exportDeckBundle(state) {
    return JSON.stringify(
      {
        format: "wind-vocab-flashcards",
        version: 1,
        exportedAt: new Date().toISOString(),
        decks: state.decks || [],
        cards: state.cards || [],
        sessions: state.sessions || [],
        settings: state.settings || {},
      },
      null,
      2
    );
  }

  function importDeckBundle(text) {
    const parsed = typeof text === "string" ? JSON.parse(text) : text;
    if (!parsed || parsed.format !== "wind-vocab-flashcards") {
      throw new Error("导入文件不是 wind-vocab-flashcards 标准格式");
    }
    return {
      decks: Array.isArray(parsed.decks) ? parsed.decks : [],
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      settings: parsed.settings || {},
    };
  }

  function buildStats(cards, sessions, date = new Date()) {
    const totalCards = cards.length;
    const reviewedCards = cards.filter((card) => (card.stats?.reviews || 0) > 0).length;
    const dueCards = cards.filter((card) => !card.dueAt || new Date(card.dueAt) <= date).length;
    const masteredCards = cards.filter((card) => (card.interval || 0) >= 21).length;
    const totalReviews = cards.reduce((sum, card) => sum + (card.stats?.reviews || 0), 0);
    const totalCorrect = cards.reduce((sum, card) => sum + (card.stats?.correct || 0), 0);
    const accuracy = totalReviews ? Math.round((totalCorrect / totalReviews) * 100) : 0;
    const lastSeven = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(date.getTime() - (6 - index) * DAY_MS);
      const key = day.toISOString().slice(0, 10);
      const count = (sessions || []).reduce((sum, session) => {
        return String(session.startedAt || "").slice(0, 10) === key ? sum + (session.reviewed || 0) : sum;
      }, 0);
      return { date: key, reviewed: count };
    });

    return {
      totalCards,
      reviewedCards,
      dueCards,
      masteredCards,
      totalReviews,
      accuracy,
      lastSeven,
    };
  }

  function cardsToAnkiTsv(cards) {
    return cards
      .map((card) => [card.front, card.back, (card.tags || []).join(" ")].map((value) => String(value || "").replace(/\t/g, " ")).join("\t"))
      .join("\n");
  }

  function deleteCardsByIds(state, cardIds) {
    const ids = new Set(cardIds || []);
    const cards = (state.cards || []).filter((card) => !ids.has(card.id));
    const deckIdsInUse = new Set(cards.map((card) => card.deckId));
    const decks = (state.decks || []).filter((deck) => deckIdsInUse.has(deck.id));
    const activeDeckId = decks.some((deck) => deck.id === state.activeDeckId) ? state.activeDeckId : "all";

    return {
      ...state,
      decks,
      cards,
      activeDeckId,
    };
  }

  function detectHorizontalSwipe({ startX, startY, endX, endY, minDistance = 60, dominanceRatio = 1.4 }) {
    const deltaX = Number(endX) - Number(startX);
    const deltaY = Number(endY) - Number(startY);
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
    if (Math.abs(deltaX) < minDistance) return null;
    if (Math.abs(deltaX) < Math.abs(deltaY) * dominanceRatio) return null;
    return deltaX < 0 ? "next" : "previous";
  }

  return {
    createCard,
    parseVocabularyCell,
    normalizeImportedWorkbook,
    scheduleReview,
    exportDeckBundle,
    importDeckBundle,
    buildStats,
    cardsToAnkiTsv,
    deleteCardsByIds,
    detectHorizontalSwipe,
  };
});
