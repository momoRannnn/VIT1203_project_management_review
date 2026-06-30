(() => {
  const STORE_KEY = 'pm_quiz_tool_v2';
  const DAY = 24 * 60 * 60 * 1000;

  function blankState() {
    return { attempts: [], memory: {}, wrongThreshold: 2, customQuestions: [], favorites: [], lastKnowledgePoint: null };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
      return parsed && typeof parsed === 'object' ? { ...blankState(), ...parsed } : blankState();
    } catch {
      return blankState();
    }
  }

  function saveState(state, customQuestions, notifyFn) {
    state.customQuestions = customQuestions;
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (notifyFn) notifyFn();
  }

  function allQuestions(builtin, custom) {
    return [...builtin, ...custom];
  }

  function chapters(allQs) {
    return Array.from(new Map(allQs.map(q => [
      q.chapterId,
      { id: q.chapterId, no: q.chapterNo, title: (q.chapter || '').replace(/^第\d+章\s*/, '') }
    ])).values());
  }

  function sortChapters(list) {
    return Array.from(list).sort((a, b) => a.no - b.no);
  }

  function getQuestion(id, allQs) {
    return allQs.find(q => q.id === id);
  }

  function getMemory(state, id) {
    if (!state.memory[id]) {
      state.memory[id] = { attempts: 0, correct: 0, wrong: 0, streak: 0, lastAt: 0, nextDue: 0, lastResult: null };
    }
    return state.memory[id];
  }

  function totalAnswered(state) {
    return Object.values(state.memory).reduce((sum, item) => sum + (item.attempts || 0), 0);
  }

  function totalCorrect(state) {
    return Object.values(state.memory).reduce((sum, item) => sum + (item.correct || 0), 0);
  }

  function accuracyText(correct, total) {
    return total ? Math.round(correct * 100 / total) + '%' : '--';
  }

  function wrongThreshold(state, el) {
    const value = Number(el && el.value);
    return (value >= 1 && value <= 10) ? value : 2;
  }

  function isFavorited(state, id) {
    return state.favorites.includes(id);
  }

  function toggleFavorite(state, id) {
    const idx = state.favorites.indexOf(id);
    if (idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.push(id);
  }

  function knowledgePoints(allQs) {
    const map = new Map();
    allQs.forEach(function(q) {
      const key = q.knowledgePoint;
      if (!key) return;
      if (!map.has(key)) map.set(key, { knowledgePoint: key, chapterId: q.chapterId, chapterNo: q.chapterNo, count: 0, questionIds: [] });
      const entry = map.get(key);
      entry.count++;
      entry.questionIds.push(q.id);
    });
    return Array.from(map.values());
  }

  function sortKnowledgePoints(list) {
    return Array.from(list).sort(function(a, b) { return a.chapterNo - b.chapterNo || a.knowledgePoint.localeCompare(b.knowledgePoint, 'zh-CN'); });
  }

  function getWrongQuestions(state, allQs) {
    return Object.entries(state.memory)
      .filter(function(entry) { return (entry[1].wrong || 0) > 0; })
      .map(function(entry) { return { question: getQuestion(entry[0], allQs), memory: entry[1] }; })
      .filter(function(item) { return item.question; })
      .sort(function(a, b) { return b.memory.wrong - a.memory.wrong || (b.memory.lastAt || 0) - (a.memory.lastAt || 0); });
  }

  function computeWeakKnowledgePoints(state, allQs) {
    const kpMap = {};
    allQs.forEach(function(q) {
      const kp = q.knowledgePoint;
      if (!kp) return;
      if (!kpMap[kp]) kpMap[kp] = { knowledgePoint: kp, chapterId: q.chapterId, chapterNo: q.chapterNo, wrong: 0, total: 0, questionIds: new Set() };
      kpMap[kp].questionIds.add(q.id);
    });
    Object.entries(state.memory).forEach(function(entry) {
      const id = entry[0], mem = entry[1];
      const q = getQuestion(id, allQs);
      if (!q || !q.knowledgePoint || !mem || !mem.wrong) return;
      if (kpMap[q.knowledgePoint]) {
        kpMap[q.knowledgePoint].wrong += mem.wrong;
        kpMap[q.knowledgePoint].total += mem.attempts || mem.wrong;
      }
    });
    return Object.values(kpMap)
      .filter(function(kp) { return kp.wrong > 0; })
      .map(function(kp) { kp.questionIds = Array.from(kp.questionIds); kp.accuracy = kp.total ? Math.round((kp.total - kp.wrong) * 100 / kp.total) : 0; return kp; })
      .sort(function(a, b) { return b.wrong - a.wrong; });
  }

  function computeHeatmapData(state, allQs) {
    const byChapter = {};
    allQs.forEach(function(q) {
      const ch = q.chapterId;
      const kp = q.knowledgePoint;
      if (!kp) return;
      if (!byChapter[ch]) byChapter[ch] = { chapterId: ch, chapterNo: q.chapterNo, kps: new Map() };
      if (!byChapter[ch].kps.has(kp)) byChapter[ch].kps.set(kp, { knowledgePoint: kp, total: 0, correct: 0, accuracy: 0, questionIds: [] });
      byChapter[ch].kps.get(kp).questionIds.push(q.id);
    });
    Object.entries(state.memory).forEach(function(entry) {
      const id = entry[0], mem = entry[1];
      const q = getQuestion(id, allQs);
      if (!q || !q.knowledgePoint) return;
      const chData = byChapter[q.chapterId];
      if (!chData) return;
      const kpData = chData.kps.get(q.knowledgePoint);
      if (!kpData) return;
      kpData.total += mem.attempts || 0;
      kpData.correct += mem.correct || 0;
    });
    return sortChapters(Object.values(byChapter)).map(function(ch) {
      return {
        chapterId: ch.chapterId,
        chapterNo: ch.chapterNo,
        kps: Array.from(ch.kps.values()).map(function(kp) {
          kp.accuracy = kp.total ? Math.round(kp.correct * 100 / kp.total) : 0;
          return kp;
        })
      };
    });
  }

  function buildKnowledgeGraph(allQs) {
    const nodeMap = new Map();
    const chKPs = {};
    allQs.forEach(function(q) {
      const kp = q.knowledgePoint;
      if (!kp) return;
      const key = q.chapterId + '|||' + kp;
      if (!nodeMap.has(key)) nodeMap.set(key, { id: kp, key: key, chapterId: q.chapterId, chapterNo: q.chapterNo, count: 0, questionIds: [] });
      const node = nodeMap.get(key);
      node.count++;
      node.questionIds.push(q.id);
      if (!chKPs[q.chapterId]) chKPs[q.chapterId] = [];
      if (chKPs[q.chapterId].indexOf(node) === -1) chKPs[q.chapterId].push(node);
    });
    const nodes = Array.from(nodeMap.values());
    const links = [];
    Object.values(chKPs).forEach(function(kpList) {
      for (let i = 0; i < kpList.length; i++) {
        for (let j = i + 1; j < kpList.length; j++) {
          links.push({ source: kpList[i].id, target: kpList[j].id, type: 'inner' });
        }
      }
    });
    const chapters = sortChapters(Object.values(chKPs).map(function(kps) {
      return {
        chapterId: kps[0].chapterId,
        chapterNo: kps[0].chapterNo,
        hub: kps.reduce(function(a, b) { return a.count >= b.count ? a : b; })
      };
    }));
    for (let i = 0; i < chapters.length; i++) {
      links.push({ source: chapters[i].hub.id, target: chapters[(i + 1) % chapters.length].hub.id, type: 'cross' });
    }
    return { nodes: nodes, links: links };
  }

  function searchQuestions(query, allQs) {
    if (!query || query.trim().length < 1) return [];
    const q = query.trim().toLowerCase();
    return allQs.filter(function(item) {
      return item.stem.toLowerCase().indexOf(q) !== -1 ||
        (item.knowledgePoint || '').toLowerCase().indexOf(q) !== -1 ||
        (item.chapter || '').toLowerCase().indexOf(q) !== -1 ||
        (item.mnemonic || '').toLowerCase().indexOf(q) !== -1 ||
        (item.trap || '').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 20);
  }

  window.State = {
    STORE_KEY: STORE_KEY,
    DAY: DAY,
    blankState: blankState,
    loadState: loadState,
    saveState: saveState,
    allQuestions: allQuestions,
    chapters: chapters,
    sortChapters: sortChapters,
    getQuestion: getQuestion,
    getMemory: getMemory,
    totalAnswered: totalAnswered,
    totalCorrect: totalCorrect,
    accuracyText: accuracyText,
    wrongThreshold: wrongThreshold,
    isFavorited: isFavorited,
    toggleFavorite: toggleFavorite,
    knowledgePoints: knowledgePoints,
    sortKnowledgePoints: sortKnowledgePoints,
    getWrongQuestions: getWrongQuestions,
    computeWeakKnowledgePoints: computeWeakKnowledgePoints,
    computeHeatmapData: computeHeatmapData,
    buildKnowledgeGraph: buildKnowledgeGraph,
    searchQuestions: searchQuestions
  };
})();
