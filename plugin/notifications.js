const stateToEntry = require('./format');

// SignalK notification severity ranking. Anything unknown (incl. normal) is 0.
const LEVELS = {
  normal: 0,
  alert: 1,
  warn: 2,
  alarm: 3,
  emergency: 4,
};

function levelRank(state) {
  return LEVELS[state] || 0;
}

function categoryForPath(underlying) {
  if (/^(propulsion|electrical)\./.test(underlying)) {
    return 'engine';
  }
  if (/^communication\./.test(underlying)) {
    return 'radio';
  }
  return 'navigation';
}

function isExcluded(underlying, excludePaths) {
  return excludePaths.some((prefix) => underlying === prefix
    || underlying.startsWith(`${prefix}.`));
}

function humanDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${minutes} min`;
}

function formatRaise(value, underlying) {
  const state = (value && value.state) || 'alarm';
  const label = state.charAt(0).toUpperCase() + state.slice(1);
  if (value && value.message) {
    return `${label}: ${value.message} (${underlying})`;
  }
  return `${label} notification: ${underlying}`;
}

function formatClear(episode, underlying) {
  const subject = episode.message || underlying;
  let text = `Cleared after ${humanDuration(episode.clearedSince - episode.startTime)}: ${subject}`;
  if (LEVELS[episode.peakState] > LEVELS[episode.openState]) {
    text += ` — peaked ${episode.peakState}`;
  }
  if (episode.transitions > 1) {
    text += `, ${episode.transitions} transitions`;
  }
  return text;
}

function buildConfig(options = {}) {
  return {
    enabled: options.logNotifications !== false,
    minLevel: options.notificationMinLevel || 'warn',
    debounceMs: (Number(options.notificationDebounceMinutes) || 5) * 60000,
    excludePaths: Array.isArray(options.notificationExcludePaths)
      ? options.notificationExcludePaths : [],
    logClears: options.logNotificationClears !== false,
  };
}

module.exports = {
  LEVELS,
  levelRank,
  categoryForPath,
  isExcluded,
  humanDuration,
  formatRaise,
  formatClear,
  buildConfig,
  stateToEntry,
};
