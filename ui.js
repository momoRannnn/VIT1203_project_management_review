(() => {
  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatDate(ts) {
    if (!ts) return '未安排';
    return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function $ (selector, root = document) { return root.querySelector(selector); }
  function $$ (selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

  function modeName(mode) {
    return { random: '随机刷题', chapter: '按章节', due: '到期复习', wrong: '错题重练', knowledge: '按知识点', favorites: '收藏题目' }[mode] || mode;
  }

  function showView(view) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach(p => p.classList.toggle('active', p.id === `view-${view}`));
  }

  function setMode(mode) {
    $$('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const kpGroup = $('#kpPickerGroup');
    if (kpGroup) kpGroup.classList.toggle('hidden', mode !== 'knowledge');
  }

  function renderChapterPicker(allQs, selectedChapters) {
    const counts = allQs.reduce((map, q) => { map[q.chapterId] = (map[q.chapterId] || 0) + 1; return map; }, {});
    const list = $('#chapterList');
    if (!list) return;
    list.innerHTML = State.sortChapters(State.chapters(allQs)).map(ch => `
      <button class="chapter-chip ${selectedChapters.has(ch.id) ? 'active' : ''}" data-chapter="${ch.id}">
        <span>Ch${ch.no}</span>
        <span>${escapeHtml(ch.title)} · ${counts[ch.id] || 0}题</span>
      </button>
    `).join('');
    $$('.chapter-chip', list).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.chapter;
        if (selectedChapters.has(id)) selectedChapters.delete(id);
        else selectedChapters.add(id);
        renderChapterPicker(allQs, selectedChapters);
      });
    });
  }

  function renderKnowledgePointPicker(allQs, selectedKPs) {
    const list = $('#knowledgePointList');
    if (!list) return;
    const kps = State.sortKnowledgePoints(State.knowledgePoints(allQs));
    if (!kps.length) { list.innerHTML = '<div class="empty">暂无知识点数据</div>'; return; }
    let lastCh = '';
    let html = '';
    kps.forEach(kp => {
      if (kp.chapterId !== lastCh) {
        lastCh = kp.chapterId;
        html += `<div class="kp-chapter-label">Chapter ${kp.chapterNo}</div>`;
      }
      html += `<button class="chapter-chip ${selectedKPs.has(kp.knowledgePoint) ? 'active' : ''}" data-kp="${escapeHtml(kp.knowledgePoint)}">
        <span>${escapeHtml(kp.knowledgePoint)}</span>
        <span>${kp.count}题</span>
      </button>`;
    });
    list.innerHTML = html;
    $$('.chapter-chip', list).forEach(btn => {
      btn.addEventListener('click', () => {
        const kp = btn.dataset.kp;
        if (selectedKPs.has(kp)) selectedKPs.delete(kp);
        else selectedKPs.add(kp);
        renderKnowledgePointPicker(allQs, selectedKPs);
      });
    });
  }

  function renderAllStats(state, allQs) {
    const answered = State.totalAnswered(state);
    const correct = State.totalCorrect(state);
    const topTotal = $('#topTotal');
    if (topTotal) topTotal.textContent = allQs.length;
    const qcInput = $('#questionCount');
    if (qcInput) qcInput.max = allQs.length;
    const topAccuracy = $('#topAccuracy');
    if (topAccuracy) topAccuracy.textContent = State.accuracyText(correct, answered);
    const topAttempts = $('#topAttempts');
    if (topAttempts) topAttempts.textContent = state.attempts.length;
    const topDue = $('#topDue');
    if (topDue) topDue.textContent = Memory.getDueQuestions(allQs, state).length;
  }

  function renderMemoryView(state, allQs) {
    const answered = State.totalAnswered(state);
    const correct = State.totalCorrect(state);
    const due = Memory.getDueQuestions(allQs, state);
    const threshold = State.wrongThreshold(state, $('#wrongThreshold'));
    const weak = Memory.getWeakQuestions(allQs, state, threshold);

    const mAccuracy = $('#mAccuracy');
    if (mAccuracy) mAccuracy.textContent = State.accuracyText(correct, answered);
    const mDone = $('#mDone');
    if (mDone) mDone.textContent = answered;
    const mDue = $('#mDue');
    if (mDue) mDue.textContent = due.length;
    const mWeak = $('#mWeak');
    if (mWeak) mWeak.textContent = weak.length;

    const chapterStats = $('#chapterStats');
    if (chapterStats) {
      chapterStats.innerHTML = State.sortChapters(State.chapters(allQs)).map(ch => {
        const chQs = allQs.filter(q => q.chapterId === ch.id);
        let chAttempts = 0, chRights = 0;
        chQs.forEach(q => {
          const mem = state.memory[q.id];
          if (mem) { chAttempts += mem.attempts || 0; chRights += mem.correct || 0; }
        });
        const pct = chAttempts ? chRights * 100 / chAttempts : 0;
        return `<div class="chapter-row"><b>Ch${ch.no}</b><span>${escapeHtml(ch.title)}</span><span>${State.accuracyText(chRights, chAttempts)}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
      }).join('');
    }

    const memoryQueue = $('#memoryQueue');
    if (memoryQueue) {
      const queue = Object.entries(state.memory)
        .map(([id, mem]) => ({ question: State.getQuestion(id, allQs), memory: mem }))
        .filter(it => it.question && it.memory.attempts > 0)
        .sort((a, b) => (a.memory.nextDue || 0) - (b.memory.nextDue || 0));
      memoryQueue.innerHTML = queue.length ? queue.map(({ question, memory }) => `
        <div class="memory-row">
          <b>${question.id}</b>
          <span>${escapeHtml(question.knowledgePoint)}</span>
          <span>${memory.correct}/${memory.attempts}</span>
          <span class="${memory.lastResult === 'wrong' ? 'status-bad' : 'status-good'}">${memory.streak} 连对</span>
          <span class="${memory.nextDue && memory.nextDue <= Date.now() ? 'status-warn' : ''}">${formatDate(memory.nextDue)}</span>
        </div>
      `).join('') : '<div class="empty">还没有练习记录。</div>';
    }
  }

  function renderRecordsView(state) {
    const attemptList = $('#attemptList');
    if (!attemptList) return;
    attemptList.innerHTML = state.attempts.length ? state.attempts.map(a => `
      <div class="attempt-row"><span>${formatDate(a.at)}</span><span>${modeName(a.mode)}</span><b>${State.accuracyText(a.correct, a.total)}</b><span>${a.correct}/${a.total}</span></div>
    `).join('') : '<div class="empty">还没有练习记录。</div>';
  }

  function renderWrongBook(state, allQs) {
    const wrongQs = State.getWrongQuestions(state, allQs);
    const listEl = $('#wrongBookList');
    if (!listEl) return;
    if (!wrongQs.length) {
      listEl.innerHTML = '<div class="empty">暂无错题记录。</div>';
      return;
    }
    listEl.innerHTML = wrongQs.map((item, i) => {
      const q = item.question;
      const m = item.memory;
      return `<div class="wrongbook-row" data-id="${q.id}">
        <input type="checkbox" class="wrongbook-check" data-id="${q.id}">
        <span class="wrongbook-stem">${escapeHtml(q.stem)}</span>
        <span class="tag">${escapeHtml(q.knowledgePoint)}</span>
        <span class="status-bad">错${m.wrong}次</span>
        <span class="muted small">${formatDate(m.lastAt)}</span>
      </div>`;
    }).join('');

    $$('.wrongbook-row').forEach(row => {
      const id = row.dataset.id;
      row.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        renderWrongBookPreview(State.getQuestion(id, allQs));
      });
    });

    $('#selectAllWrong')?.addEventListener('click', () => {
      const checks = $$('.wrongbook-check');
      const allChecked = checks.every(c => c.checked);
      checks.forEach(c => { c.checked = !allChecked; });
    });

    $('#startWrongBookQuiz')?.addEventListener('click', () => {
      const ids = $$('.wrongbook-check').filter(c => c.checked).map(c => c.dataset.id);
      if (!ids.length) { alert('请至少选择一道错题。'); return; }
      UI.showView('quiz');
      UI.setMode('wrong');
      window._startCustomQuestions(ids, 'wrong');
    });
  }

  function renderWrongBookPreview(question) {
    const panel = $('#wrongBookDetail');
    if (!panel) return;
    panel.innerHTML = question ? `
      <h3>${escapeHtml(question.stem)}</h3>
      <p class="tag">${escapeHtml(question.knowledgePoint)} · ${escapeHtml(question.chapter || '')}</p>
      ${question.options.map(o => `<div class="answer-line">${o.key}. ${escapeHtml(o.text)} ${o.key === question.answerKey ? '<b style="color:var(--good)">✓ 正确答案</b>' : ''}</div>`).join('')}
      <details style="margin-top:8px"><summary>解析与记忆点</summary>
        <div class="explain">
          <p><b>记忆点：</b>${escapeHtml(question.mnemonic || '')}</p>
          <p><b>易错点：</b>${escapeHtml(question.trap || '')}</p>
          <p><b>出处：</b>${escapeHtml(question.source || '')}</p>
        </div>
      </details>
    ` : '<div class="empty">点击错题查看详情</div>';
  }

  function renderSearchResults(results, query, allQs) {
    const container = $('#searchResults');
    if (!container) return;
    if (!results.length && query && query.trim().length > 0) {
      container.classList.remove('hidden');
      container.innerHTML = '<div class="search-result-item muted">无匹配结果</div>';
      return;
    }
    if (!query || !query.trim()) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    container.innerHTML = results.map(q => `
      <div class="search-result-item" data-id="${q.id}">
        <span class="stem">${escapeHtml(q.stem)}</span>
        <span class="meta"><span class="tag">${escapeHtml(q.knowledgePoint)}</span><span class="tag">${escapeHtml(q.chapter || '')}</span></span>
      </div>
    `).join('');
    $$('.search-result-item', container).forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        container.classList.add('hidden');
        $('#globalSearch').value = '';
        window._startCustomQuestions([id], 'random');
      });
    });
  }

  function renderWeakKnowledgePoints(state, allQs) {
    const container = $('#weakKPList');
    if (!container) return;
    const weakKPs = State.computeWeakKnowledgePoints(state, allQs);
    if (!weakKPs.length) { container.innerHTML = '<div class="empty">暂无薄弱知识点。</div>'; return; }
    container.innerHTML = weakKPs.map(kp => `
      <div class="weak-kp-row" data-kp="${escapeHtml(kp.knowledgePoint)}">
        <b>${escapeHtml(kp.knowledgePoint)}</b>
        <span class="status-bad">错${kp.wrong}次</span>
        <span class="muted small">${kp.total}次练习 · 正确率${kp.accuracy}%</span>
        <div class="bar" style="flex:1;min-width:60px"><i style="width:${kp.accuracy}%;background:var(--bad)"></i></div>
      </div>
    `).join('');
    $$('.weak-kp-row', container).forEach(row => {
      row.addEventListener('click', () => {
        const kp = row.dataset.kp;
        UI.showView('quiz');
        UI.setMode('knowledge');
        const selKPs = window._getSelectedKPs ? window._getSelectedKPs() : new Set();
        selKPs.clear();
        selKPs.add(kp);
        if (window._renderKPPicker) window._renderKPPicker();
        window._startQuiz();
      });
    });
  }

  function renderTrendChart(state) {
    const panel = $('#trendPanel');
    if (!panel) return;
    if (typeof Chart === 'undefined') {
      panel.innerHTML = '<h2>做题趋势</h2><div class="empty">图表库加载失败，请检查网络连接。</div>';
      return;
    }
    const attempts = state.attempts.slice().reverse();
    if (attempts.length < 2) {
      panel.innerHTML = '<h2>做题趋势</h2><div style="position:relative;height:320px"><div class="empty">数据不足，需要至少2次练习。</div></div>';
      return;
    }
    panel.innerHTML = '<h2>做题趋势</h2><div style="position:relative;height:320px;max-width:100%"><canvas id="trendChart"></canvas></div>';
    const canvas = $('#trendChart');
    if (!canvas) return;
    const labels = attempts.map(a => new Date(a.at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }));
    const data = attempts.map(a => a.total ? Math.round(a.correct * 100 / a.total) : 0);
    if (window.__trendChart) { window.__trendChart.destroy(); window.__trendChart = null; }
    window.__trendChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '正确率 %',
          data,
          borderColor: '#2f6f8f',
          backgroundColor: 'rgba(47,111,143,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: '#2f6f8f'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function heatmapColor(accuracy, total) {
    if (total === 0) return '#e8edf1';
    if (accuracy >= 80) return '#2f7d57';
    if (accuracy >= 60) return '#8a9e2f';
    if (accuracy >= 40) return '#c49b2a';
    return '#b4483c';
  }

  function renderHeatmap(state, allQs) {
    const grid = $('#heatmapGrid');
    if (!grid) return;
    const data = State.computeHeatmapData(state, allQs);
    if (!data.length) { grid.innerHTML = '<div class="empty">暂无数据。</div>'; return; }
    grid.innerHTML = data.map(ch => `
      <div class="heatmap-row">
        <span class="heatmap-row-label">Ch${ch.chapterNo}</span>
        ${ch.kps.map(kp => `
          <div class="heatmap-cell" style="background:${heatmapColor(kp.accuracy, kp.total)}"
            data-tooltip="${escapeHtml(kp.knowledgePoint)} · ${State.accuracyText(kp.correct, kp.total)} · ${kp.total}次"
            data-kp="${escapeHtml(kp.knowledgePoint)}"
          ></div>
        `).join('')}
      </div>
    `).join('');
    $$('.heatmap-cell', grid).forEach(cell => {
      cell.addEventListener('click', () => {
        const kp = cell.dataset.kp;
        UI.showView('quiz');
        UI.setMode('knowledge');
        const selKPs = window._getSelectedKPs ? window._getSelectedKPs() : new Set();
        selKPs.clear();
        selKPs.add(kp);
        if (window._renderKPPicker) window._renderKPPicker();
        window._startQuiz();
      });
    });
  }

  function renderKnowledgeGraph(allQs) {
    const svg = $('#graphSvg');
    if (!svg) return;
    if (typeof d3 === 'undefined') {
      svg.outerHTML = '<div class="empty">D3 库加载失败，请检查网络连接。</div>';
      return;
    }
    const graph = State.buildKnowledgeGraph(allQs);
    if (!graph.nodes.length) {
      svg.outerHTML = '<div class="empty">暂无知识点数据。</div>';
      return;
    }
    svg.innerHTML = '';
    const W = 1200;
    const H = 800;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.cursor = 'grab';

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(graph.nodes.map(n => n.chapterId));
    const CROSS_MAX_DIST = 300;

    const g = d3.select(svg);
    const content = g.append('g').attr('class', 'graph-content');

    const link = content.append('g').selectAll('line').data(graph.links).join('line')
      .attr('stroke', '#dfe5ea').attr('stroke-width', 1);
    const node = content.append('g').selectAll('circle').data(graph.nodes).join('circle')
      .attr('r', d => Math.max(16, Math.sqrt(d.count) * 7 + 10))
      .attr('fill', d => colorScale(d.chapterId))
      .attr('stroke', '#fff').attr('stroke-width', 2)
      .attr('cursor', 'pointer');
    node.append('title').text(d => `${d.id}\n${d.count} 题\nChapter ${d.chapterNo}`);
    const label = content.append('g').selectAll('text').data(graph.nodes).join('text')
      .text(d => d.id.length > 6 ? d.id.slice(0, 6) + '…' : d.id)
      .attr('font-size', 12).attr('text-anchor', 'middle').attr('dy', 4)
      .attr('fill', '#1f2933').attr('pointer-events', 'none');

    const simulation = d3.forceSimulation(graph.nodes)
      .force('link', d3.forceLink(graph.links).id(d => d.id).distance(d => d.type === 'cross' ? CROSS_MAX_DIST : 100))
      .force('charge', d3.forceManyBody().strength(-50))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide().radius(d => Math.sqrt(d.count) * 7 + 18));

    const MARGIN = 80;
    simulation.on('tick', () => {
      graph.nodes.forEach(d => {
        d.x = Math.max(MARGIN, Math.min(W - MARGIN, d.x));
        d.y = Math.max(MARGIN, Math.min(H - MARGIN, d.y));
      });
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
          .attr('stroke', d => d.type === 'cross' ? '#8ab4d8' : '#dfe5ea')
          .attr('stroke-width', d => d.type === 'cross' ? 2 : 1);
      node.attr('cx', d => d.x).attr('cy', d => d.y);
      label.attr('x', d => d.x).attr('y', d => d.y);
    });

    node.call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      }));

    const zoom = d3.zoom()
      .scaleExtent([0.15, 5])
      .on('zoom', (event) => {
        content.attr('transform', event.transform);
      });
    g.call(zoom);

    node.on('click', (event, d) => {
      const panel = $('#graphDetailPanel');
      const title = $('#graphDetailTitle');
      const questions = $('#graphDetailQuestions');
      if (!panel || !title || !questions) return;
      panel.style.display = 'block';
      title.textContent = `${d.id} (${d.count} 题)`;
      questions.innerHTML = d.questionIds.map(id => {
        const q = State.getQuestion(id, allQs);
        return q ? `<div class="review-item"><span class="tag">${escapeHtml(q.chapter || '')}</span><b>${escapeHtml(q.stem)}</b>
          <button class="btn primary graph-start-btn" style="margin-top:6px" data-id="${q.id}">练习此题</button></div>` : '';
      }).join('');
      $$('.graph-start-btn', questions).forEach(btn => {
        btn.addEventListener('click', () => {
          window._startCustomQuestions([btn.dataset.id], 'random');
        });
      });
    });
  }

  window.UI = {
    $, $$, escapeHtml, shuffle, formatTime, formatDate, modeName,
    showView, setMode,
    renderChapterPicker, renderKnowledgePointPicker,
    renderAllStats, renderMemoryView, renderRecordsView,
    renderWrongBook, renderWrongBookPreview,
    renderSearchResults, renderWeakKnowledgePoints,
    renderTrendChart, renderHeatmap, renderKnowledgeGraph
  };
})();
