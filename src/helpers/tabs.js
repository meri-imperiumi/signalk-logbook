const tabs = ['timeline', 'book', 'map'];
const TAB_PARAM = 'logbook-tab';

// The logbook UI renders inside the Signal K admin app (module federation),
// sharing its window: the admin routes on the URL hash and the logbook
// webapp lives at '#/e/_meri_imperiumi_signalk_logbook'. The tab must live
// in the hash's query string so the admin route is left untouched; a bare
// '#book' would navigate the admin app to a nonexistent route and blank
// the whole webapp. When the hash is not used for routing, it holds the
// tab name directly.

function tabParam(route) {
  const qIdx = route.indexOf('?');
  if (qIdx === -1) {
    return null;
  }
  return new URLSearchParams(route.slice(qIdx + 1)).get(TAB_PARAM);
}

// Resolve the active tab from a URL hash, falling back to 'timeline'
function tabFromHash(hash) {
  const value = hash.replace(/^#/, '');
  const wanted = value.startsWith('/') ? tabParam(value) : value;
  if (tabs.includes(wanted)) {
    return wanted;
  }
  return 'timeline';
}

// Hash for `tab` that preserves any host route in `currentHash`
function hashForTab(tab, currentHash) {
  const value = currentHash.replace(/^#/, '');
  if (value.startsWith('/')) {
    const qIdx = value.indexOf('?');
    const route = qIdx === -1 ? value : value.slice(0, qIdx);
    const params = new URLSearchParams(qIdx === -1 ? '' : value.slice(qIdx + 1));
    params.set(TAB_PARAM, tab);
    return `#${route}?${params.toString()}`;
  }
  return `#${tab}`;
}

module.exports = {
  tabs,
  tabFromHash,
  hashForTab,
};
