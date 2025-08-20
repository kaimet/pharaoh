/**
 * toast_manager.js — simplified zone-singletons
 *
 * Zones: title (top-left), best (top-right), other (below).
 * Each zone holds a single active toast. New toasts update the existing one.
 */

(function () {
  if (window.__songToastsInstalled) return;
  window.__songToastsInstalled = true;

  // --- CSS ---
  const css = `
  .song-toast-container { position: fixed; left: 16px; z-index: 9999; pointer-events: none; }
  .song-toast-container.title { top: 8px; }
  .song-toast-container.best  { top: 8px; right: 16px; left: auto; text-align: right; }
  .song-toast-container.other { top: 60px; right: 16px; left: auto; text-align: right; }

  .song-toast {
    display: inline-block;
    margin-top: 8px;
    background: rgba(30,30,30,0.92);
    color: #fff;
    padding: 8px 12px;
    border-radius: 8px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    box-shadow: 0 6px 18px rgba(0,0,0,0.35);
    transform-origin: left top;
    pointer-events: auto;
    user-select: none;
    max-width: 88vw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .song-toast.title { font-size: 20px; }
  .song-toast.best  { font-size: 20px; }
  .song-toast.other { font-size: 20px; }

  @keyframes song-toast-in { from { transform: translateY(-6px) scale(.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
  @keyframes song-toast-out { to { transform: translateY(-6px) scale(.98); opacity: 0; } }`;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);

  // --- containers ---
  const containers = {
    single: createContainer('song-toast-container'), // legacy single container
    title: createContainer('song-toast-container title'),
    best: createContainer('song-toast-container best'),
    other: createContainer('song-toast-container other')
  };

  function createContainer(className) {
    const c = document.createElement('div');
    c.className = className;
    document.body.appendChild(c);
    return c;
  }

  // --- per-zone state: only one active toast per zone ---
  const zoneState = {
    single: null,
    title: null,
    best: null,
    other: null
  };

  const ENTRY_MS = 220;
  const EXIT_MS = 180;

  function setEntranceAnimation(el) {
    el.style.animation = `song-toast-in ${ENTRY_MS}ms ease`;
    // ensure exit not lingering
    el.style.opacity = '';
  }

  function startExitAnimation(el) {
    el.style.animation = `song-toast-out ${EXIT_MS}ms ease forwards`;
  }

  // Create or update the zone's single toast
  function showZoneToast(zone, message, opts = {}) {
    const container = containers[zone] || containers.other;
    const duration = typeof opts.duration === 'number' ? opts.duration : 1200;
    const tag = typeof opts.tag === 'string' ? opts.tag : null;

    let state = zoneState[zone];

    // If there's already an element for this zone, update text and reset timers.
    if (state && state.el && container.contains(state.el)) {
      // Update text
      state.el.textContent = message;
      if (tag) state.el.setAttribute('data-toast-tag', tag);
      // Reset animations/timers
      if (state.hideTimeout) { clearTimeout(state.hideTimeout); state.hideTimeout = null; }
      if (state.removeTimeout) { clearTimeout(state.removeTimeout); state.removeTimeout = null; }
      setEntranceAnimation(state.el);
    } else {
      // Create new element
      const el = document.createElement('div');
      el.className = 'song-toast';
      if (zone) el.classList.add(zone);
      if (tag) el.setAttribute('data-toast-tag', tag);
      el.textContent = message;
      container.appendChild(el);
      setEntranceAnimation(el);
      state = { el, hideTimeout: null, removeTimeout: null };
      zoneState[zone] = state;
    }

    // Schedule hide -> exit -> removal
    state.hideTimeout = setTimeout(() => {
      startExitAnimation(state.el);
      // schedule removal after exit animation completes
      state.removeTimeout = setTimeout(() => {
        try { if (state.el && container.contains(state.el)) container.removeChild(state.el); } catch (e) {}
        zoneState[zone] = null;
      }, EXIT_MS);
    }, duration);
  }

  // Legacy single container behaves the same (single active toast)
  function showSingleToast(message, opts = {}) {
    showZoneToast('single', message, opts);
  }

  // Tag -> zone mapping (keeps backward compatibility)
  const tagToZone = {
    selection: 'title',
    bestScore: 'best',
    // others default to 'other'
  };

  /**
   * Public API:
   *  showSongToast(message, opts)
   * opts: { duration, tag, zone } - zone overrides tag mapping
   *
   * Behavior:
   *  - If zone is title/best/other -> single-per-zone toast which updates existing instantly.
   *  - If zone === 'single' -> legacy single container (same single-instance semantics).
   */
  window.showSongToast = function (message, opts = {}) {
    const explicitZone = (typeof opts.zone === 'string') ? opts.zone : null;
    const tag = typeof opts.tag === 'string' ? opts.tag : null;
    const zone = explicitZone || (tagToZone[tag] || 'other');

    // Always show instantly by updating or creating the zone's singleton
    if (zone === 'single') {
      showSingleToast(message, opts);
    } else {
      showZoneToast(zone, message, opts);
    }
  };

  // Clear all toasts immediately
  window.clearSongToasts = function () {
    Object.keys(zoneState).forEach(zone => {
      const state = zoneState[zone];
      const container = containers[zone];
      if (state) {
        if (state.hideTimeout) { clearTimeout(state.hideTimeout); state.hideTimeout = null; }
        if (state.removeTimeout) { clearTimeout(state.removeTimeout); state.removeTimeout = null; }
        if (state.el && container && container.contains(state.el)) container.removeChild(state.el);
        zoneState[zone] = null;
      }
      // also remove any lingering children just in case
      if (container) {
        const rem = container.querySelectorAll('.song-toast');
        rem.forEach(el => el.remove());
      }
    });
  };
})();
