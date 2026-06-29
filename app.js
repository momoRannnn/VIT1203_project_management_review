(() => {
  const questions = window.PM_QUESTIONS || [];
  const chapters = Array.from(new Map(questions.map(q => [
    q.chapterId,
    {
      id: q.chapterId,
      no: q.chapterNo,
      title: q.chapter.replace(/^第\d+章\s*/, '')
    }
  ]).sort((a, b) => a[1].no - b[1].no)).values());

  const STORE_KEY = 'pm_quiz_tool_v2';
  const DAY = 24 * 60 * 60 * 1000;
  const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  let activeMode = 'random';
  let selectedChapters = new Set();
  let session = null;
  let timerHandle = null;
  const state = loadState();

  function blankState() {
    return { attempts: [], memory: {} };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
      return parsed && typeof parsed === 'object' ? { ...blankState(), ...parsed } : blankState();
    } catch {
      return blankState();
    }
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    renderAllStats();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatDate(ts) {
    if (!ts) return '未安排';
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getQuestion(id) {
    return questions.find(q => q.id === id);
  }

  function getMemory(id) {
    if (!state.memory[id]) {
      state.memory[id] = {
        attempts: 0,
        correct: 0,
        wrong: 0,
        streak: 0,
        lastAt: 0,
        nextDue: 0,
        lastResult: null
      };
    }
    return state.memory[id];
  }

  function totalAnswered() {
    return Object.values(state.memory).reduce((sum, item) => sum + (item.attempts || 0), 0);
  }

  function totalCorrect() {
    return Object.values(state.memory).reduce((sum, item) => sum + (item.correct || 0), 0);
  }

  function accuracyText(correct, total) {
    return total ? `${Math.round(correct * 100 / total)}%` : '--';
  }

  function isDue(question) {
    const memory = state.memory[question.id];
    return Boolean(memory && memory.attempts > 0 && memory.nextDue && memory.nextDue <= Date.now());
  }

  function isWeak(question) {
    const memory = state.memory[question.id];
    return Boolean(memory && (memory.lastResult === 'wrong' || memory.wrong > memory.correct));
  }

  function selectedChapterFilter(question) {
    return selectedChapters.size === 0 || selectedChapters.has(question.chapterId);
  }

  function optionText(question, key) {
    return question.options.find(option => option.key === key)?.text || '未作答';
  }

  function modeName(mode) {
    return {
      random: '随机刷题',
      chapter: '按章节',
      due: '到期复习',
      wrong: '错题重练'
    }[mode] || mode;
  }

  function init() {
    renderChapterPicker();
    bindEvents();
    renderAllStats();
  }

  function bindEvents() {
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => showView(tab.dataset.view));
    });
    $$('.mode-btn').forEach(button => {
      button.addEventListener('click', () => setMode(button.dataset.mode));
    });
    $('#clearChapters').addEventListener('click', () => {
      selectedChapters.clear();
      renderChapterPicker();
    });
    $('#startQuiz').addEventListener('click', () => startQuiz());
    $('#prevQuestion').addEventListener('click', () => moveQuestion(-1));
    $('#nextQuestion').addEventListener('click', () => moveQuestion(1));
    $('#finishQuiz').addEventListener('click', () => finishQuiz(false));
    $('#abortQuiz').addEventListener('click', abortQuiz);
    $('#startDueFromMemory').addEventListener('click', () => {
      showView('quiz');
      setMode('due');
      startQuiz();
    });
    $('#startWrongFromMemory').addEventListener('click', () => {
      showView('quiz');
      setMode('wrong');
      startQuiz();
    });
    $('#exportData').addEventListener('click', exportData);
    $('#resetData').addEventListener('click', resetData);
  }

  function showView(view) {
    $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
    $$('.view').forEach(panel => panel.classList.toggle('active', panel.id === `view-${view}`));
    if (view === 'memory') renderMemoryView();
    if (view === 'records') renderRecordsView();
  }

  function setMode(mode) {
    activeMode = mode;
    $$('.mode-btn').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  }

  function renderChapterPicker() {
    const counts = questions.reduce((map, question) => {
      map[question.chapterId] = (map[question.chapterId] || 0) + 1;
      return map;
    }, {});

    $('#chapterList').innerHTML = chapters.map(chapter => `
      <button class="chapter-chip ${selectedChapters.has(chapter.id) ? 'active' : ''}" data-chapter="${chapter.id}">
        <span>Ch${chapter.no}</span>
        <span>${escapeHtml(chapter.title)} · ${counts[chapter.id] || 0}题</span>
      </button>
    `).join('');

    $$('.chapter-chip').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.chapter;
        if (selectedChapters.has(id)) selectedChapters.delete(id);
        else selectedChapters.add(id);
        renderChapterPicker();
      });
    });
  }

  function buildPool() {
    let pool = questions.filter(selectedChapterFilter);
    if (activeMode === 'due') pool = pool.filter(isDue);
    if (activeMode === 'wrong') pool = pool.filter(isWeak);
    if (activeMode === 'chapter' && selectedChapters.size === 0) {
      return { error: '请至少选择一个章节。' };
    }
    if (!pool.length) {
      if (activeMode === 'due') return { error: '当前没有到期复习题。' };
      if (activeMode === 'wrong') return { error: '当前没有错题记录。' };
      return { error: '当前筛选条件下没有题目。' };
    }
    if ($('#shuffleQuestions').checked) pool = shuffle(pool);
    const requested = Number($('#questionCount').value) || pool.length;
    const count = Math.max(1, Math.min(requested, pool.length));
    return { questions: pool.slice(0, count) };
  }

  function startQuiz(overrideMode) {
    if (overrideMode) setMode(overrideMode);
    const built = buildPool();
    if (built.error) {
      alert(built.error);
      return;
    }
    const shuffleOptions = $('#shuffleOptions').checked;
    session = {
      id: Date.now(),
      mode: activeMode,
      startedAt: Date.now(),
      index: 0,
      limitMs: Math.max(0, Number($('#timeLimit').value) || 0) * 60 * 1000,
      questions: built.questions.map(question => ({
        question,
        selected: null,
        options: shuffleOptions ? shuffle(question.options) : question.options.slice()
      }))
    };

    $('#quizEmpty').classList.add('hidden');
    $('#quizResult').classList.add('hidden');
    $('#quizActive').classList.remove('hidden');
    renderQuestion();
    startTimer();
  }

  function startTimer() {
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      if (!session) return;
      const elapsed = Date.now() - session.startedAt;
      if (session.limitMs) {
        const left = session.limitMs - elapsed;
        $('#timerText').textContent = `剩余 ${formatTime(left)}`;
        if (left <= 0) finishQuiz(true);
      } else {
        $('#timerText').textContent = `用时 ${formatTime(elapsed)}`;
      }
    }, 300);
  }

  function renderQuestion() {
    const item = session.questions[session.index];
    const answered = session.questions.filter(question => question.selected).length;
    $('#progressText').textContent = `${session.index + 1} / ${session.questions.length} · 已答 ${answered}`;
    $('#progressBar').style.width = `${(session.index + 1) * 100 / session.questions.length}%`;
    $('#questionCard').innerHTML = `
      <h2 class="question-stem">${escapeHtml(item.question.stem)}</h2>
      ${item.question.note ? `<p class="muted">${escapeHtml(item.question.note)}</p>` : ''}
      <div class="option-list">
        ${item.options.map((option, index) => `
          <button class="option ${item.selected === option.key ? 'selected' : ''}" data-key="${option.key}">
            <span class="option-label">${String.fromCharCode(65 + index)}</span>
            <span>${escapeHtml(option.text)}</span>
          </button>
        `).join('')}
      </div>
    `;
    $$('.option', $('#questionCard')).forEach(button => {
      button.addEventListener('click', () => {
        item.selected = button.dataset.key;
        renderQuestion();
      });
    });
    $('#prevQuestion').disabled = session.index === 0;
    $('#nextQuestion').disabled = session.index === session.questions.length - 1;
  }

  function moveQuestion(delta) {
    if (!session) return;
    session.index = Math.max(0, Math.min(session.questions.length - 1, session.index + delta));
    renderQuestion();
  }

  function abortQuiz() {
    if (!session || confirm('结束本轮？本轮未提交，不会记录成绩。')) {
      clearInterval(timerHandle);
      session = null;
      $('#quizActive').classList.add('hidden');
      $('#quizResult').classList.add('hidden');
      $('#quizEmpty').classList.remove('hidden');
    }
  }

  function finishQuiz(auto) {
    if (!session) return;
    const unanswered = session.questions.filter(item => !item.selected).length;
    if (!auto && unanswered && !confirm(`还有 ${unanswered} 题未作答，确定交卷吗？`)) return;
    clearInterval(timerHandle);
    const results = session.questions.map(item => ({
      id: item.question.id,
      selected: item.selected,
      correct: item.selected === item.question.answerKey
    }));
    results.forEach(updateMemory);
    const correct = results.filter(result => result.correct).length;
    const attempt = {
      id: `A${session.id}`,
      at: Date.now(),
      mode: session.mode,
      total: results.length,
      correct,
      durationMs: Date.now() - session.startedAt,
      chapterIds: Array.from(selectedChapters),
      results
    };
    state.attempts.unshift(attempt);
    state.attempts = state.attempts.slice(0, 100);
    saveState();
    renderResult(attempt);
    session = null;
    $('#quizActive').classList.add('hidden');
    $('#quizResult').classList.remove('hidden');
  }

  function updateMemory(result) {
    const memory = getMemory(result.id);
    memory.attempts += 1;
    memory.lastAt = Date.now();
    if (result.correct) {
      memory.correct += 1;
      memory.streak += 1;
      memory.lastResult = 'correct';
      const days = REVIEW_INTERVALS[Math.min(memory.streak - 1, REVIEW_INTERVALS.length - 1)];
      memory.nextDue = Date.now() + days * DAY;
    } else {
      memory.wrong += 1;
      memory.streak = 0;
      memory.lastResult = 'wrong';
      memory.nextDue = Date.now() + 10 * 60 * 1000;
    }
  }

  function renderResult(attempt) {
    const wrong = attempt.results.filter(result => !result.correct);
    $('#quizResult').innerHTML = `
      <div class="result-head">
        <div class="score">${accuracyText(attempt.correct, attempt.total)}</div>
        <div>
          <h2>本轮完成</h2>
          <div class="muted">答对 ${attempt.correct} / ${attempt.total}，用时 ${formatTime(attempt.durationMs)}</div>
          <div class="result-actions">
            <button class="btn primary" id="againBtn">按当前设置再来一轮</button>
            ${wrong.length ? '<button class="btn" id="retryWrongBtn">重练本轮错题</button>' : ''}
            <button class="btn" id="backSetupBtn">回到设置</button>
          </div>
        </div>
      </div>
      <div class="review-list">${attempt.results.map((result, index) => reviewItemHtml(result, index)).join('')}</div>
    `;
    $('#againBtn').addEventListener('click', () => startQuiz());
    $('#backSetupBtn').addEventListener('click', () => {
      $('#quizResult').classList.add('hidden');
      $('#quizEmpty').classList.remove('hidden');
    });
    $('#retryWrongBtn')?.addEventListener('click', () => startCustomQuestions(wrong.map(result => result.id), 'wrong'));
  }

  function reviewItemHtml(result, index) {
    const question = getQuestion(result.id);
    const chapterLabel = question.chapter.replace(/^第(\d+)章.*/, 'Chapter $1');
    return `
      <article class="review-item ${result.correct ? 'correct' : 'wrong'}">
        <div class="review-title">
          <span class="tag">${index + 1}</span>
          <span class="tag">${result.correct ? '正确' : '错误'}</span>
          <span class="tag">${escapeHtml(chapterLabel)}</span>
          <span class="tag">${escapeHtml(question.knowledgePoint)}</span>
        </div>
        <div><b>${escapeHtml(question.stem)}</b></div>
        <div class="answer-line">你的答案：<b>${escapeHtml(result.selected ? optionText(question, result.selected) : '未作答')}</b></div>
        <div class="answer-line">正确答案：<b>${question.answerKey}. ${escapeHtml(question.answerText)}</b></div>
        <details>
          <summary>解析、记忆点与出处</summary>
          <div class="explain">
            <p><b>记忆点：</b>${escapeHtml(question.mnemonic || '')}</p>
            <p><b>易错点：</b>${escapeHtml(question.trap || '')}</p>
            <p><b>出处：</b>${escapeHtml(question.source || '')}</p>
          </div>
        </details>
      </article>
    `;
  }

  function startCustomQuestions(ids, mode) {
    setMode(mode);
    const selected = ids.map(getQuestion).filter(Boolean);
    if (!selected.length) return;
    session = {
      id: Date.now(),
      mode,
      startedAt: Date.now(),
      index: 0,
      limitMs: 0,
      questions: selected.map(question => ({
        question,
        selected: null,
        options: $('#shuffleOptions').checked ? shuffle(question.options) : question.options.slice()
      }))
    };
    $('#quizResult').classList.add('hidden');
    $('#quizEmpty').classList.add('hidden');
    $('#quizActive').classList.remove('hidden');
    renderQuestion();
    startTimer();
  }

  function renderAllStats() {
    const answered = totalAnswered();
    const correct = totalCorrect();
    $('#topTotal').textContent = questions.length;
    $('#topAccuracy').textContent = accuracyText(correct, answered);
    $('#topAttempts').textContent = state.attempts.length;
    $('#topDue').textContent = questions.filter(isDue).length;
    renderMemoryView();
    renderRecordsView();
  }

  function renderMemoryView() {
    const answered = totalAnswered();
    const correct = totalCorrect();
    const due = questions.filter(isDue);
    const weak = questions.filter(isWeak);
    $('#mAccuracy').textContent = accuracyText(correct, answered);
    $('#mDone').textContent = answered;
    $('#mDue').textContent = due.length;
    $('#mWeak').textContent = weak.length;

    $('#chapterStats').innerHTML = chapters.map(chapter => {
      const chapterQuestions = questions.filter(question => question.chapterId === chapter.id);
      let attempts = 0;
      let rights = 0;
      chapterQuestions.forEach(question => {
        const memory = state.memory[question.id];
        if (memory) {
          attempts += memory.attempts || 0;
          rights += memory.correct || 0;
        }
      });
      const pct = attempts ? rights * 100 / attempts : 0;
      return `
        <div class="chapter-row">
          <b>Ch${chapter.no}</b>
          <span>${escapeHtml(chapter.title)}</span>
          <span>${accuracyText(rights, attempts)}</span>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>
      `;
    }).join('');

    const queue = Object.entries(state.memory)
      .map(([id, memory]) => ({ question: getQuestion(id), memory }))
      .filter(item => item.question && item.memory.attempts > 0)
      .sort((a, b) => (a.memory.nextDue || 0) - (b.memory.nextDue || 0));
    $('#memoryQueue').innerHTML = queue.length ? queue.map(({ question, memory }) => `
      <div class="memory-row">
        <b>${question.id}</b>
        <span>${escapeHtml(question.knowledgePoint)}</span>
        <span>${memory.correct}/${memory.attempts}</span>
        <span class="${memory.lastResult === 'wrong' ? 'status-bad' : 'status-good'}">${memory.streak} 连对</span>
        <span class="${memory.nextDue && memory.nextDue <= Date.now() ? 'status-warn' : ''}">${formatDate(memory.nextDue)}</span>
      </div>
    `).join('') : '<div class="empty">还没有练习记录。</div>';
  }

  function renderRecordsView() {
    $('#attemptList').innerHTML = state.attempts.length ? state.attempts.map(attempt => `
      <div class="attempt-row">
        <span>${formatDate(attempt.at)}</span>
        <span>${modeName(attempt.mode)}</span>
        <b>${accuracyText(attempt.correct, attempt.total)}</b>
        <span>${attempt.correct}/${attempt.total}</span>
      </div>
    `).join('') : '<div class="empty">还没有练习记录。</div>';
  }

  function exportData() {
    const box = $('#exportBox');
    box.classList.remove('hidden');
    box.value = JSON.stringify(state, null, 2);
    box.select();
  }

  function resetData() {
    if (!confirm('确定清空所有正确率和记忆曲线记录吗？')) return;
    state.attempts = [];
    state.memory = {};
    saveState();
    $('#exportBox').classList.add('hidden');
  }

  init();
})();
