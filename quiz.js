(() => {
  function buildPool(allQs, activeMode, selectedChapters, selectedKPs, shuffleQ, questionCount, state, favorites) {
    let pool = allQs.filter(q => selectedChapters.size === 0 || selectedChapters.has(q.chapterId));

    if (activeMode === 'knowledge' && selectedKPs.size > 0) {
      pool = pool.filter(q => {
        if (selectedKPs.has(q.knowledgePoint)) return true;
        if (q.knowledgePointIds && q.knowledgePointIds.some(kp => selectedKPs.has(kp))) return true;
        return false;
      });
    }
    if (activeMode === 'due') pool = pool.filter(q => Memory.isDue(q, state));
    if (activeMode === 'wrong') pool = pool.filter(q => Memory.isWeak(q, state, State.wrongThreshold(state, UI.$('#wrongThreshold'))));
    if (activeMode === 'favorites') pool = pool.filter(q => favorites.includes(q.id));
    if (activeMode === 'chapter' && selectedChapters.size === 0) return { error: '请至少选择一个章节。' };
    if (activeMode === 'knowledge' && selectedKPs.size === 0) return { error: '请至少选择一个知识点。' };

    if (!pool.length) {
      if (activeMode === 'due') return { error: '当前没有到期复习题。' };
      if (activeMode === 'wrong') return { error: '当前没有错题记录。' };
      if (activeMode === 'favorites') return { error: '还没有收藏任何题目。' };
      return { error: '当前筛选条件下没有题目。' };
    }
    if (shuffleQ) pool = UI.shuffle(pool);
    const requested = Number(questionCount) || pool.length;
    const count = Math.max(1, Math.min(requested, pool.length));
    return { questions: pool.slice(0, count) };
  }

  function startQuiz(allQs, activeMode, selectedChapters, selectedKPs, state, favorites, customQuestions) {
    const built = buildPool(allQs, activeMode, selectedChapters, selectedKPs, UI.$('#shuffleQuestions')?.checked, UI.$('#questionCount')?.value, state, favorites);
    if (built.error) { alert(built.error); return null; }
    const shuffleOpts = UI.$('#shuffleOptions')?.checked;
    const session = {
      id: Date.now(),
      mode: activeMode,
      startedAt: Date.now(),
      index: 0,
      limitMs: Math.max(0, Number(UI.$('#timeLimit')?.value || 0) * 60 * 1000),
      questions: built.questions.map(q => ({
        question: q,
        selected: null,
        options: shuffleOpts ? UI.shuffle(q.options) : q.options.slice()
      }))
    };
    UI.$('#quizEmpty').classList.add('hidden');
    UI.$('#quizResult').classList.add('hidden');
    UI.$('#quizActive').classList.remove('hidden');
    renderQuestion(session, state);
    startTimer(session);
    return session;
  }

  function renderQuestion(session, state) {
    const item = session.questions[session.index];
    const answered = session.questions.filter(q => q.selected).length;
    const pct = (session.index + 1) * 100 / session.questions.length;
    UI.$('#progressText').textContent = `${session.index + 1} / ${session.questions.length} · 已答 ${answered}`;
    UI.$('#progressBar').style.width = `${pct}%`;
    UI.$('#questionCard').innerHTML = `
      <h2 class="question-stem">${UI.escapeHtml(item.question.stem)}</h2>
      ${item.question.note ? `<p class="muted">${UI.escapeHtml(item.question.note)}</p>` : ''}
      <div class="option-list">
        ${item.options.map((o, i) => `
          <button class="option ${item.selected === o.key ? 'selected' : ''}" data-key="${o.key}">
            <span class="option-label">${String.fromCharCode(65 + i)}</span>
            <span>${UI.escapeHtml(o.text)}</span>
          </button>
        `).join('')}
      </div>
      <div class="q-actions" style="margin-top:12px;display:flex;justify-content:flex-end">
        <button class="btn bookmark-btn ${State.isFavorited(state, item.question.id) ? 'favorited' : ''}" data-id="${item.question.id}">
          ${State.isFavorited(state, item.question.id) ? '★ 已收藏' : '☆ 收藏'}
        </button>
      </div>
    `;
    UI.$$('.option', UI.$('#questionCard')).forEach(btn => {
      btn.addEventListener('click', () => { item.selected = btn.dataset.key; renderQuestion(session, state); });
    });
    const bmBtn = UI.$('.bookmark-btn', UI.$('#questionCard'));
    if (bmBtn) {
      bmBtn.addEventListener('click', () => {
        State.toggleFavorite(state, item.question.id);
        window._saveStateFn();
        renderQuestion(session, state);
      });
    }
    UI.$('#prevQuestion').disabled = session.index === 0;
    UI.$('#nextQuestion').disabled = session.index === session.questions.length - 1;
  }

  function moveQuestion(session, delta, state) {
    if (!session) return;
    session.index = Math.max(0, Math.min(session.questions.length - 1, session.index + delta));
    renderQuestion(session, state);
  }

  function startTimer(session) {
    window._clearTimer();
    window._timerHandle = setInterval(() => {
      if (!session) return;
      const elapsed = Date.now() - session.startedAt;
      if (session.limitMs) {
        const left = session.limitMs - elapsed;
        UI.$('#timerText').textContent = `剩余 ${UI.formatTime(left)}`;
        if (left <= 0) window._finishQuizFn(true);
      } else {
        UI.$('#timerText').textContent = `用时 ${UI.formatTime(elapsed)}`;
      }
    }, 300);
  }

  function finishQuiz(session, state, selectedChapters, auto, customQuestions) {
    if (!session) return;
    const unanswered = session.questions.filter(item => !item.selected).length;
    if (!auto && unanswered && !confirm(`还有 ${unanswered} 题未作答，确定交卷吗？`)) return;
    window._clearTimer();
    const results = session.questions.map(item => ({
      id: item.question.id,
      selected: item.selected,
      correct: item.selected === item.question.answerKey
    }));
    results.forEach(r => Memory.updateMemory(r, state));
    const correct = results.filter(r => r.correct).length;
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
    window._saveStateFn();
    renderResult(attempt, state, allQuestions());
    return attempt;
  }

  function allQuestions() {
    return State.allQuestions(window._builtinQuestions || [], window._customQuestions || []);
  }

  function renderResult(attempt, state, allQs) {
    const wrong = attempt.results.filter(r => !r.correct);
    UI.$('#quizActive').classList.add('hidden');
    UI.$('#quizResult').classList.remove('hidden');
    UI.$('#quizResult').innerHTML = `
      <div class="result-head">
        <div class="score">${State.accuracyText(attempt.correct, attempt.total)}</div>
        <div>
          <h2>本轮完成</h2>
          <div class="muted">答对 ${attempt.correct} / ${attempt.total}，用时 ${UI.formatTime(attempt.durationMs)}</div>
          <div class="result-actions">
            <button class="btn primary" id="againBtn">按当前设置再来一轮</button>
            ${wrong.length ? '<button class="btn" id="retryWrongBtn">重练本轮错题</button>' : ''}
            <button class="btn" id="backSetupBtn">回到设置</button>
          </div>
        </div>
      </div>
      <div class="review-list">${attempt.results.map((r, i) => reviewItemHtml(r, i, allQs, state)).join('')}</div>
    `;
    UI.$('#againBtn').addEventListener('click', () => window._startQuiz());
    UI.$('#backSetupBtn').addEventListener('click', () => {
      UI.$('#quizResult').classList.add('hidden');
      UI.$('#quizEmpty').classList.remove('hidden');
    });
    const retryBtn = UI.$('#retryWrongBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => startCustomQuestions(wrong.map(r => r.id), 'wrong'));
  }

  function reviewItemHtml(result, index, allQs, state) {
    const q = State.getQuestion(result.id, allQs);
    if (!q) return '';
    const chLabel = q.chapter.replace(/^第(\d+)章.*/, 'Chapter $1');
    return `
      <article class="review-item ${result.correct ? 'correct' : 'wrong'}">
        <div class="review-title">
          <span class="tag">${index + 1}</span>
          <span class="tag">${result.correct ? '正确' : '错误'}</span>
          <span class="tag">${UI.escapeHtml(chLabel)}</span>
          <span class="tag">${UI.escapeHtml(q.knowledgePoint)}</span>
          ${State.isFavorited(state, result.id) ? '<span class="tag" style="color:#d4a017">★ 收藏</span>' : ''}
        </div>
        <div><b>${UI.escapeHtml(q.stem)}</b></div>
        <div class="answer-line">你的答案：<b>${UI.escapeHtml(result.selected ? optionText(q, result.selected) : '未作答')}</b></div>
        <div class="answer-line">正确答案：<b>${q.answerKey}. ${UI.escapeHtml(q.answerText)}</b></div>
        <details>
          <summary>解析、记忆点与出处</summary>
          <div class="explain">
            <p><b>记忆点：</b>${UI.escapeHtml(q.mnemonic || '')}</p>
            <p><b>易错点：</b>${UI.escapeHtml(q.trap || '')}</p>
            <p><b>出处：</b>${UI.escapeHtml(q.source || '')}</p>
          </div>
        </details>
      </article>`;
  }

  function optionText(question, key) {
    return question.options.find(o => o.key === key)?.text || '未作答';
  }

  function startCustomQuestions(ids, mode) {
    const allQs = allQuestions();
    const selected = ids.map(id => State.getQuestion(id, allQs)).filter(Boolean);
    if (!selected.length) return;
    UI.showView('quiz');
    UI.setMode(mode);
    const session = {
      id: Date.now(),
      mode,
      startedAt: Date.now(),
      index: 0,
      limitMs: 0,
      questions: selected.map(q => ({
        question: q,
        selected: null,
        options: (UI.$('#shuffleOptions')?.checked) ? UI.shuffle(q.options) : q.options.slice()
      }))
    };
    UI.$('#quizResult').classList.add('hidden');
    UI.$('#quizEmpty').classList.add('hidden');
    UI.$('#quizActive').classList.remove('hidden');
    window._setSession(session);
    const state = window._getState();
    renderQuestion(session, state);
    startTimer(session);
  }

  window.Quiz = {
    buildPool, startQuiz, renderQuestion, moveQuestion,
    finishQuiz, renderResult, reviewItemHtml, startCustomQuestions
  };
})();
