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
    debounceMs: (options.notificationDebounceMinutes != null
      ? Number(options.notificationDebounceMinutes) : 5) * 60000,
    excludePaths: Array.isArray(options.notificationExcludePaths)
      ? options.notificationExcludePaths : [],
    logClears: options.logNotificationClears !== false,
  };
}

function appendEntry(log, app, state, text, category, datetimeOverride) {
  const data = stateToEntry(state, text);
  data.category = category;
  if (datetimeOverride != null) {
    data.datetime = new Date(datetimeOverride).toISOString();
  }
  const dateString = new Date(data.datetime).toISOString().substr(0, 10);
  return log.appendEntry(dateString, data)
    .then(() => {
      app.setPluginStatus(`Automatic log entry: ${text}`);
      return null;
    });
}

function processNotification(path, value, state, episodes, log, app, config, now) {
  if (!config.enabled) {
    return Promise.resolve();
  }
  const underlying = path.replace(/^notifications\./, '');
  if (isExcluded(underlying, config.excludePaths)) {
    return Promise.resolve();
  }
  const notifState = value && value.state;
  const rank = levelRank(notifState);
  const episode = episodes.get(path);

  if (rank > 0 && rank >= levelRank(config.minLevel)) {
    if (!episode) {
      episodes.set(path, {
        startTime: now,
        openState: notifState,
        peakState: notifState,
        message: value && value.message,
        transitions: 1,
        clearedSince: null,
      });
      return appendEntry(
        log,
        app,
        state,
        formatRaise(value, underlying),
        categoryForPath(underlying),
      );
    }
    episode.transitions += 1;
    episode.clearedSince = null;
    if (value && value.message) {
      episode.message = value.message;
    }
    if (LEVELS[notifState] > LEVELS[episode.peakState]) {
      episode.peakState = notifState;
    }
    return Promise.resolve();
  }

  // A state below the configured minimum (incl. alert/normal) is intentionally
  // treated as cleared — this also guarantees an episode that de-escalates and
  // sticks below the threshold still closes after the debounce window.
  if (episode && episode.clearedSince === null) {
    episode.clearedSince = now;
  }
  return Promise.resolve();
}

function sweepNotifications(episodes, state, log, app, config, now) {
  const pending = [];
  episodes.forEach((episode, path) => {
    if (episode.clearedSince !== null && now - episode.clearedSince >= config.debounceMs) {
      episodes.delete(path);
      if (config.logClears) {
        const underlying = path.replace(/^notifications\./, '');
        pending.push(appendEntry(
          log,
          app,
          state,
          formatClear(episode, underlying),
          categoryForPath(underlying),
          episode.clearedSince,
        ));
      }
    }
  });
  return Promise.all(pending);
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
  processNotification,
  sweepNotifications,
};
