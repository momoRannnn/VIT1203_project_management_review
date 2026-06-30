(() => {
  const builtinQuestions = window.PM_QUESTIONS || [];
  let customQuestions = [];
  let activeMode = 'random';
  let selectedChapters = new Set();
  let selectedKPs = new Set();
  let selectedQuestionSet = 'all';
  let session = null;
  let timerHandle = null;
  const state = State.loadState();

  // Bridge functions for module cross-calls
  window._builtinQuestions = builtinQuestions;
  window._customQuestions = customQuestions;
  window._saveStateFn = () => State.saveState(state, customQuestions, function renderAfterSave() {
    UI.renderAllStats(state, allQs());
    UI.renderMemoryView(state, allQs());
    UI.renderRecordsView(state);
  });
  window._clearTimer = () => { clearInterval(window._timerHandle); window._timerHandle = null; };
  window._timerHandle = timerHandle;
  window._finishQuizFn = (auto) => {
    const result = Quiz.finishQuiz(session, state, selectedChapters, auto, customQuestions);
    if (result) session = null;
  };
  window._setSession = (s) => { session = s; };
  window._getState = () => state;
  window._getSelectedKPs = () => selectedKPs;
  window._renderKPPicker = () => UI.renderKnowledgePointPicker(allQs(), selectedKPs);
  window._startQuiz = () => startQuiz();
  window._startCustomQuestions = (ids, mode) => Quiz.startCustomQuestions(ids, mode);

  function allQs() {
    let qs = State.allQuestions(builtinQuestions, customQuestions);
    if (selectedQuestionSet === 'set1') qs = qs.filter(q => parseInt(q.id.slice(1)) <= 60);
    if (selectedQuestionSet === 'set2') qs = qs.filter(q => parseInt(q.id.slice(1)) > 60);
    return qs;
  }

  function startQuiz(overrideMode) {
    if (overrideMode) UI.setMode(overrideMode);
    if (overrideMode) activeMode = overrideMode;
    const s = Quiz.startQuiz(allQs(), activeMode, selectedChapters, selectedKPs, state, state.favorites, customQuestions);
    if (s) { session = s; timerHandle = window._timerHandle; }
  }

  function init() {
    restoreCustomQuestions();
    restoreSettings();
    UI.renderChapterPicker(allQs(), selectedChapters);
    UI.renderKnowledgePointPicker(allQs(), selectedKPs);
    bindEvents();
    UI.renderAllStats(state, allQs());
    UI.$('#kpPickerGroup')?.classList.add('hidden');
  }

  function restoreCustomQuestions() {
    customQuestions = (state.customQuestions && Array.isArray(state.customQuestions)) ? state.customQuestions : [];
    window._customQuestions = customQuestions;
  }

  function restoreSettings() {
    if (state.wrongThreshold != null) {
      const el = UI.$('#wrongThreshold');
      if (el) el.value = state.wrongThreshold;
    }
  }

  function bindEvents() {
    UI.$$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        UI.showView(view);
        if (view === 'memory') {
          UI.renderMemoryView(state, allQs());
          UI.renderWeakKnowledgePoints(state, allQs());
          UI.renderTrendChart(state);
          UI.renderHeatmap(state, allQs());
        }
        if (view === 'records') UI.renderRecordsView(state);
        if (view === 'wrongbook') UI.renderWrongBook(state, allQs());
        if (view === 'graph') UI.renderKnowledgeGraph(allQs());
      });
    });

    UI.$$('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeMode = btn.dataset.mode;
        UI.setMode(activeMode);
      });
    });

    UI.$('#clearChapters')?.addEventListener('click', () => {
      selectedChapters.clear();
      UI.renderChapterPicker(allQs(), selectedChapters);
    });

    UI.$('#questionSet')?.addEventListener('change', () => {
      selectedQuestionSet = UI.$('#questionSet').value;
      UI.renderChapterPicker(allQs(), selectedChapters);
      UI.renderKnowledgePointPicker(allQs(), selectedKPs);
      UI.renderAllStats(state, allQs());
    });

    UI.$('#startQuiz')?.addEventListener('click', () => startQuiz());
    UI.$('#prevQuestion')?.addEventListener('click', () => Quiz.moveQuestion(session, -1, state));
    UI.$('#nextQuestion')?.addEventListener('click', () => Quiz.moveQuestion(session, 1, state));
    UI.$('#finishQuiz')?.addEventListener('click', () => {
      const result = Quiz.finishQuiz(session, state, selectedChapters, false, customQuestions);
      if (result) session = null;
    });
    UI.$('#abortQuiz')?.addEventListener('click', () => {
      if (!session || confirm('结束本轮？本轮未提交，不会记录成绩。')) {
        window._clearTimer();
        session = null;
        UI.$('#quizActive')?.classList.add('hidden');
        UI.$('#quizResult')?.classList.add('hidden');
        UI.$('#quizEmpty')?.classList.remove('hidden');
      }
    });

    UI.$('#startDueFromMemory')?.addEventListener('click', () => {
      UI.showView('quiz');
      activeMode = 'due';
      UI.setMode('due');
      startQuiz();
    });
    UI.$('#startWrongFromMemory')?.addEventListener('click', () => {
      UI.showView('quiz');
      activeMode = 'wrong';
      UI.setMode('wrong');
      startQuiz();
    });

    // Export / Import / Reset
    UI.$('#exportData')?.addEventListener('click', () => {
      const box = UI.$('#exportBox');
      box.classList.remove('hidden');
      box.value = JSON.stringify(state, null, 2);
      box.select();
    });
    UI.$('#resetData')?.addEventListener('click', () => {
      if (!confirm('确定清空所有正确率和记忆曲线记录吗？')) return;
      state.attempts = [];
      state.memory = {};
      window._saveStateFn();
      const box = UI.$('#exportBox');
      if (box) box.classList.add('hidden');
    });
    UI.$('#importQuestionsBtn')?.addEventListener('click', () => {
      const box = UI.$('#importBox');
      const btn = UI.$('#doImportQuestions');
      if (!box || !btn) return;
      box.classList.toggle('hidden');
      btn.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) box.focus();
    });
    UI.$('#doImportQuestions')?.addEventListener('click', () => {
      const jsonText = UI.$('#importBox')?.value.trim();
      if (!jsonText) return;
      const imported = loadQuestionsFromJSON(jsonText);
      if (!imported) return;
      mergeQuestions(imported);
      const box = UI.$('#importBox');
      const btn = UI.$('#doImportQuestions');
      if (box) { box.value = ''; box.classList.add('hidden'); }
      if (btn) btn.classList.add('hidden');
      alert(`已导入 ${imported.length} 道新题目。`);
      UI.renderChapterPicker(allQs(), selectedChapters);
      UI.renderKnowledgePointPicker(allQs(), selectedKPs);
      UI.renderAllStats(state, allQs());
    });

    UI.$('#wrongThreshold')?.addEventListener('change', () => {
      state.wrongThreshold = State.wrongThreshold(state, UI.$('#wrongThreshold'));
      window._saveStateFn();
    });

    // Search
    let searchTimer;
    UI.$('#globalSearch')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const query = UI.$('#globalSearch').value;
        const results = State.searchQuestions(query, allQs());
        UI.renderSearchResults(results, query, allQs());
      }, 300);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) {
        UI.$('#searchResults')?.classList.add('hidden');
      }
    });
  }

  function loadQuestionsFromJSON(jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error('必须是题目数组');
      return parsed;
    } catch (e) {
      alert('题目数据格式错误：' + e.message);
      return null;
    }
  }

  function mergeQuestions(imported) {
    const existingIds = new Set(allQs().map(q => q.id));
    imported.forEach((q, i) => {
      if (!q.id) q.id = `C${Date.now().toString(36).toUpperCase()}${i}`;
      if (existingIds.has(q.id)) q.id = q.id + '_' + Date.now().toString(36).toUpperCase();
      existingIds.add(q.id);
      if (!q.chapterId) q.chapterId = 'CUSTOM';
      if (!q.chapterNo) q.chapterNo = 99;
      if (!q.chapter) q.chapter = '自定义题目';
      if (!q.knowledgePoint) q.knowledgePoint = '';
      if (!q.mnemonic) q.mnemonic = '';
      if (!q.trap) q.trap = '';
      if (!q.source) q.source = '';
      if (!q.explanationMd) q.explanationMd = '';
    });
    customQuestions.push(...imported);
    window._customQuestions = customQuestions;
    window._saveStateFn();
  }

  init();
})();
