(() => {
  const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];
  const DAY = State.DAY;

  function computeNextDue(streak, wasCorrect) {
    if (wasCorrect) {
      const days = REVIEW_INTERVALS[Math.min(streak - 1, REVIEW_INTERVALS.length - 1)];
      return Date.now() + days * DAY;
    }
    return Date.now() + 10 * 60 * 1000;
  }

  function updateMemory(result, state) {
    const memory = State.getMemory(state, result.id);
    memory.attempts += 1;
    memory.lastAt = Date.now();
    if (result.correct) {
      memory.correct += 1;
      memory.streak += 1;
      memory.lastResult = 'correct';
      memory.nextDue = computeNextDue(memory.streak, true);
    } else {
      memory.wrong += 1;
      memory.streak = 0;
      memory.lastResult = 'wrong';
      memory.nextDue = computeNextDue(0, false);
    }
  }

  function isDue(question, state) {
    const memory = state.memory[question.id];
    return Boolean(memory && memory.attempts > 0 && memory.nextDue && memory.nextDue <= Date.now());
  }

  function isWeak(question, state, threshold) {
    const memory = state.memory[question.id];
    if (!memory || memory.attempts === 0) return false;
    if (memory.lastResult === 'wrong') return true;
    if (memory.wrong > memory.correct) return true;
    if (memory.wrong > 0 && memory.streak < threshold) return true;
    return false;
  }

  function getDueQuestions(allQs, state) {
    return allQs.filter(q => isDue(q, state));
  }

  function getWeakQuestions(allQs, state, threshold) {
    return allQs.filter(q => isWeak(q, state, threshold));
  }

  window.Memory = {
    REVIEW_INTERVALS,
    computeNextDue,
    updateMemory,
    isDue,
    isWeak,
    getDueQuestions,
    getWeakQuestions
  };
})();
