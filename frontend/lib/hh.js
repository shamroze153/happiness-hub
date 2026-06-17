/**
 * ====================================================================================
 *  HAPPINESS HUB — SHARED CLIENT  (lib/hh.js)
 * ====================================================================================
 *  Loaded by every page via <script src="lib/hh.js"></script> (or "../lib/hh.js"
 *  from /admin/). Exposes a single global `HH` object.
 *
 *  IMPORTANT — API transport rules (see build brief §2.2):
 *    - Every action EXCEPT uploadFile is a plain GET request
 *      (?action=xxx&key=value...) to avoid CORS preflight entirely.
 *    - uploadFile is the ONE exception: it's a POST with
 *      Content-Type: text/plain;charset=utf-8 (a "simple request", so still
 *      no preflight) carrying a JSON string body.
 * ====================================================================================
 */

(function (global) {
  'use strict';

  // ----------------------------------------------------------------------------
  // CONFIG
  // ----------------------------------------------------------------------------
  // If you ever rotate the Apps Script deployment URL, update ONLY this constant.
  const API = 'https://script.google.com/macros/s/AKfycbwsbF1M-EGPz-goxVS0-Z0PcVKNrZNgV6FDb8XeWycvkebiVYX9ztWq5Uh-eEQkZWgw/exec8';

  const PAYMENT_METHODS = [
    { value: 'Zelle', label: 'Zelle', icon: '🏦', placeholder: 'Email or phone number used for Zelle' },
    { value: 'CashApp', label: 'Cash App', icon: '💵', placeholder: '$Cashtag' },
    { value: 'Venmo', label: 'Venmo', icon: '📲', placeholder: '@username' },
    { value: 'PayPal', label: 'PayPal', icon: '🅿️', placeholder: 'PayPal email address' }
  ];

  // 4-step buyer-facing tracker. "Need More Info" / "PayPal Issue" / "Rejected"
  // are rendered as an error branch off whichever step the order stalled on.
  const TRACKER_STEPS = ['Submitted', 'Ordered', 'Delivered', 'Cashback Sent'];

  const ERROR_STATUSES = ['Rejected', 'Need More Info', 'PayPal Issue'];

  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB — keep in sync with backend MAX_UPLOAD_BYTES

  // ----------------------------------------------------------------------------
  // CORE TRANSPORT
  // ----------------------------------------------------------------------------

  /**
   * Builds `${API}?action=...&k=v...` and returns the parsed JSON response.
   * Network/parse failures are caught and returned in the same
   * {success:false, error:"..."} shape the backend uses, so callers never
   * need a separate try/catch for transport errors.
   */
  async function get(action, params) {
    params = params || {};
    const qs = new URLSearchParams();
    qs.set('action', action);
    Object.keys(params).forEach(function (k) {
      const v = params[k];
      if (v !== undefined && v !== null) qs.set(k, v);
    });

    const url = API + '?' + qs.toString();

    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        return { success: false, error: 'Server returned an error (HTTP ' + res.status + '). Please try again.' };
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        return { success: false, error: 'Unexpected response from the server. Please try again in a moment.' };
      }
    } catch (networkErr) {
      return { success: false, error: 'Network error — check your connection and try again.' };
    }
  }

  /** Alias of get() — kept separate at call sites purely for readability. */
  const post = get;

  /**
   * POST text/plain (a "simple request" — no CORS preflight) with a JSON
   * string body. Used ONLY by uploadFile.
   */
  async function callPost(action, params) {
    params = params || {};
    const body = Object.assign({ action: action }, params);

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        return { success: false, error: 'Server returned an error (HTTP ' + res.status + '). Please try again.' };
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        return { success: false, error: 'Unexpected response from the server. Please try again in a moment.' };
      }
    } catch (networkErr) {
      return { success: false, error: 'Network error — check your connection and try again.' };
    }
  }

  // ----------------------------------------------------------------------------
  // FILE UPLOADS
  // ----------------------------------------------------------------------------

  /**
   * Converts a File to base64 and uploads it via uploadFile. Resolves to
   * {success:true, url, file_id} or {success:false, error}.
   * Enforces the 5MB limit client-side (in addition to the server-side check)
   * so the user gets instant feedback instead of waiting on an upload.
   */
  function uploadFile(file) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve({ success: false, error: 'No file selected.' });
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        resolve({ success: false, error: 'That file is ' + (file.size / (1024 * 1024)).toFixed(1) + 'MB — please choose one under 5MB.' });
        return;
      }

      const reader = new FileReader();
      reader.onerror = function () {
        resolve({ success: false, error: 'Could not read that file. Please try a different one.' });
      };
      reader.onload = async function () {
        try {
          const dataUrl = String(reader.result || '');
          const commaIdx = dataUrl.indexOf(',');
          const base64data = commaIdx !== -1 ? dataUrl.substring(commaIdx + 1) : dataUrl;

          const result = await callPost('uploadFile', {
            filename: file.name || 'upload',
            base64data: base64data,
            mimetype: file.type || 'application/octet-stream'
          });
          resolve(result);
        } catch (err) {
          resolve({ success: false, error: 'Upload failed. Please try again.' });
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // ----------------------------------------------------------------------------
  // SESSION MANAGEMENT
  // ----------------------------------------------------------------------------
  // Role-scoped localStorage keys: hh_admin / hh_agent / hh_seller / hh_buyer_wa.

  function sessionKey(role) {
    return 'hh_' + role;
  }

  function getSession(role) {
    try {
      const raw = localStorage.getItem(sessionKey(role));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(role, data) {
    try {
      localStorage.setItem(sessionKey(role), JSON.stringify(data));
    } catch (e) {
      // localStorage may be unavailable (privacy mode) — fail silently,
      // requireAuth() below will simply redirect again next time.
    }
  }

  function clearSession(role) {
    try {
      localStorage.removeItem(sessionKey(role));
    } catch (e) { /* ignore */ }
  }

  /**
   * Returns {actor_id, actor_type} for API calls from a logged-in session,
   * or null if there's no session for that role.
   */
  function getAuthBody(role) {
    const session = getSession(role);
    if (!session) return null;
    const idField = role === 'agent' ? 'agent_id' : role === 'seller' ? 'seller_id' : 'actor_id';
    const actorId = (session.actor && session.actor[idField]) || session.actor_id || (session.actor && session.actor.agent_id) || (session.actor && session.actor.seller_id);
    return { actor_id: actorId, actor_type: role };
  }

  /**
   * Ensures a session exists for `role`; if not, redirects to `loginUrl` and
   * returns null. Call this at the top of any gated page.
   */
  function requireAuth(role, loginUrl) {
    const session = getSession(role);
    if (!session) {
      global.location.href = loginUrl;
      return null;
    }
    return session;
  }

  // ----------------------------------------------------------------------------
  // REFERRAL CAPTURE
  // ----------------------------------------------------------------------------

  /** Reads ?ref=AGENT_ID from the URL and persists it for the session. Call on page load. */
  function captureRef() {
    try {
      const params = new URLSearchParams(global.location.search);
      const ref = params.get('ref');
      if (ref && ref.trim()) {
        sessionStorage.setItem('hh_ref', ref.trim());
      }
    } catch (e) { /* ignore */ }
  }

  /** Returns the captured referral agent_id, or "direct" if none was captured. */
  function getRef() {
    try {
      const ref = sessionStorage.getItem('hh_ref');
      return ref && ref.trim() ? ref.trim() : 'direct';
    } catch (e) {
      return 'direct';
    }
  }

  // ----------------------------------------------------------------------------
  // FORMATTING HELPERS
  // ----------------------------------------------------------------------------

  let cachedCurrencySymbol = '$';

  /** Call once after getSettings() so fmt$() uses the configured symbol. */
  function setCurrencySymbol(symbol) {
    if (symbol) cachedCurrencySymbol = symbol;
  }

  /** Formats a number as currency, e.g. fmt$(12.5) -> "$12.50". Tolerates strings/blank/NaN. */
  function fmt$(n) {
    const num = parseFloat(n);
    if (isNaN(num)) return cachedCurrencySymbol + '0.00';
    return cachedCurrencySymbol + num.toFixed(2);
  }

  /** Human-relative time, e.g. "3 hours ago", "just now", "5 days ago". */
  function timeAgo(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '';

    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 0) return 'just now';
    if (seconds < 60) return 'just now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');

    const days = Math.floor(hours / 24);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');

    const months = Math.floor(days / 30);
    if (months < 12) return months + (months === 1 ? ' month ago' : ' months ago');

    const years = Math.floor(months / 12);
    return years + (years === 1 ? ' year ago' : ' years ago');
  }

  /** Formats an ISO date as a short readable date, e.g. "Jun 15, 2026". */
  function fmtDate(dateInput) {
    if (!dateInput) return '—';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /**
   * Maps an order status to a badge descriptor: {label, className, icon}.
   * className matches a `.badge--xxx` class defined in main.css.
   */
  function statusBadge(status) {
    const s = String(status || '').trim();
    const map = {
      'Pending': { label: 'Pending', className: 'badge--warn', icon: '⏳' },
      'Ordered': { label: 'Ordered', className: 'badge--info', icon: '📦' },
      'Delivered': { label: 'Delivered', className: 'badge--info', icon: '🚚' },
      'Cashback Sent': { label: 'Cashback Sent', className: 'badge--ok', icon: '💸' },
      'Rejected': { label: 'Rejected', className: 'badge--red', icon: '✕' },
      'Need More Info': { label: 'Need More Info', className: 'badge--warn', icon: '❓' },
      'PayPal Issue': { label: 'PayPal Issue', className: 'badge--red', icon: '⚠️' }
    };
    return map[s] || { label: s || 'Unknown', className: 'badge--info', icon: '•' };
  }

  /** Maps a product status to a badge descriptor. */
  function productStatusBadge(status) {
    const s = String(status || '').trim();
    const map = {
      'Active': { label: 'Active', className: 'badge--ok', icon: '●' },
      'Disabled': { label: 'Disabled', className: 'badge--warn', icon: '●' },
      'Deleted': { label: 'Deleted', className: 'badge--red', icon: '●' }
    };
    return map[s] || { label: s || 'Unknown', className: 'badge--info', icon: '●' };
  }

  /** Maps a stock_status to a badge descriptor. */
  function stockBadge(status) {
    const s = String(status || '').trim();
    const map = {
      'Available': { label: 'In Stock', className: 'badge--ok', icon: '✓' },
      'Limited': { label: 'Limited Stock', className: 'badge--warn', icon: '!' },
      'Out': { label: 'Out of Stock', className: 'badge--red', icon: '✕' }
    };
    return map[s] || { label: s || 'Unknown', className: 'badge--info', icon: '•' };
  }

  /**
   * Computes the buyer-facing 4-step tracker state for an order's status.
   * Returns { steps: [{label, state}], errorStep, errorLabel } where state
   * is 'done' | 'active' | 'upcoming', and errorStep/errorLabel describe a
   * branch-state banner (Rejected / Need More Info / PayPal Issue) if applicable.
   */
  function trackerState(status) {
    const s = String(status || '').trim();

    if (ERROR_STATUSES.indexOf(s) !== -1) {
      // Figure out how far the order got before it branched into an error state.
      // Rejected can happen at any point; Need More Info / PayPal Issue imply
      // the order was at least Submitted (and usually Ordered).
      const reachedIndex = s === 'Rejected' ? 0 : 1;
      const steps = TRACKER_STEPS.map(function (label, i) {
        return { label: label, state: i <= reachedIndex ? 'done' : 'upcoming' };
      });
      return { steps: steps, errorStep: reachedIndex, errorLabel: s };
    }

    const idx = TRACKER_STEPS.indexOf(s);
    const activeIndex = idx === -1 ? 0 : idx;

    const steps = TRACKER_STEPS.map(function (label, i) {
      let state;
      if (i < activeIndex) state = 'done';
      else if (i === activeIndex) state = (activeIndex === TRACKER_STEPS.length - 1) ? 'done' : 'active';
      else state = 'upcoming';
      return { label: label, state: state };
    });

    return { steps: steps, errorStep: -1, errorLabel: null };
  }

  /** Escapes HTML special characters — use on every piece of user data injected into HTML. */
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ----------------------------------------------------------------------------
  // TOASTS
  // ----------------------------------------------------------------------------

  function ensureToastContainer() {
    let container = document.getElementById('hh-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'hh-toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Shows a toast notification. type: 'success' | 'error' | 'info'.
   * Auto-dismisses after ~4 seconds; slides in from the right.
   */
  function toast(message, type) {
    type = type || 'info';
    const container = ensureToastContainer();

    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.innerHTML = '<span class="toast__icon">' + (icons[type] || icons.info) + '</span>' +
      '<span class="toast__msg"></span>';
    el.querySelector('.toast__msg').textContent = message;

    container.appendChild(el);
    // Force a reflow so the enter transition reliably fires.
    requestAnimationFrame(function () {
      el.classList.add('toast--visible');
    });

    const dismiss = function () {
      el.classList.remove('toast--visible');
      el.classList.add('toast--leaving');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    };

    el.addEventListener('click', dismiss);
    setTimeout(dismiss, 4000);
  }

  // ----------------------------------------------------------------------------
  // PARTICLE BACKGROUND
  // ----------------------------------------------------------------------------

  /**
   * Animates 30-60 slow-drifting low-opacity dots on <canvas id="particles">,
   * bouncing gently off the viewport edges. Inserts the canvas if missing.
   * Respects prefers-reduced-motion by drawing a single static frame.
   */
  function initParticles() {
    let canvas = document.getElementById('particles');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'particles';
      document.body.insertBefore(canvas, document.body.firstChild);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const COUNT = 45;
    let particles = [];
    let width, height;

    function resize() {
      width = canvas.width = global.innerWidth;
      height = canvas.height = global.innerHeight;
    }

    function spawn() {
      particles = [];
      for (let i = 0; i < COUNT; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: 1 + Math.random() * 2,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          o: 0.12 + Math.random() * 0.28
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      particles.forEach(function (p) {
        if (!reducedMotion) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
          p.x = Math.max(0, Math.min(width, p.x));
          p.y = Math.max(0, Math.min(height, p.y));
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 157, 77, ' + p.o + ')';
        ctx.fill();
      });
      if (!reducedMotion) requestAnimationFrame(draw);
    }

    resize();
    spawn();
    draw();

    let resizeTimer;
    global.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resize();
        spawn();
        if (reducedMotion) draw();
      }, 200);
    });
  }

  // ----------------------------------------------------------------------------
  // ORDER CARD (shared by track.html, my-orders.html, agent-dashboard.html)
  // ----------------------------------------------------------------------------

  /**
   * Renders a buyer-facing order card: status badge, 4-step progress tracker
   * (with error-branch banner for Rejected / Need More Info / PayPal Issue),
   * refund method + amount, and links to any uploaded screenshots.
   *
   * options.bannerHtml: optional HTML string injected at the top of the card
   * (used by my-orders.html for the "Action needed: Mark as Delivered" banner).
   */
  function renderOrderCard(order, options) {
    options = options || {};
    const badge = statusBadge(order.status);
    const tracker = trackerState(order.status);

    let trackerHtml = '<div class="progress-wrap">';
    tracker.steps.forEach(function (step, i) {
      let stateClass = 'progress-step--' + step.state;
      if (tracker.errorStep === i) stateClass = 'progress-step--error';
      trackerHtml += '<div class="progress-step ' + stateClass + '">' +
        '<div class="progress-line"></div>' +
        '<div class="progress-dot"></div>' +
        '<div class="progress-label">' + esc(step.label) + '</div>' +
        '</div>';
    });
    trackerHtml += '</div>';

    if (tracker.errorStep !== -1) {
      const note = order.seller_notes && String(order.seller_notes).trim()
        ? esc(order.seller_notes)
        : 'Please check My Orders for details, or reach out to support.';
      trackerHtml += '<div class="err-box"><span class="err-box__icon">⚠️</span><span><strong>' +
        esc(tracker.errorLabel) + ':</strong> ' + note + '</span></div>';
    }

    let links = '';
    if (order.screenshot_url) links += '<a href="' + esc(order.screenshot_url) + '" target="_blank" rel="noopener">📄 Order Screenshot</a>';
    if (order.price_screenshot_url) links += '<a href="' + esc(order.price_screenshot_url) + '" target="_blank" rel="noopener">💲 Price Screenshot</a>';
    if (order.keyword_screenshot_url) links += '<a href="' + esc(order.keyword_screenshot_url) + '" target="_blank" rel="noopener">🔍 Keyword Screenshot</a>';
    if (order.delivery_screenshot_url) links += '<a href="' + esc(order.delivery_screenshot_url) + '" target="_blank" rel="noopener">📦 Delivery Photo</a>';
    if (order.delivery_image_url) links += '<a href="' + esc(order.delivery_image_url) + '" target="_blank" rel="noopener">🖼️ Delivery Image</a>';
    if (order.cashback_proof_url) links += '<a href="' + esc(order.cashback_proof_url) + '" target="_blank" rel="noopener">💸 Refund Proof</a>';

    let html = '<div class="card card--hover slide-up">';
    if (options.bannerHtml) html += options.bannerHtml;

    const subBits = ['#' + esc(order.order_id)];
    if (order.order_number) subBits.push('Order# ' + esc(order.order_number));
    subBits.push(esc(timeAgo(order.submitted_at)));

    html += '<div class="flex justify-between items-center flex-wrap gap-8 mb-8">' +
      '<div>' +
      '<div style="font-weight:700; font-size:15px;">' + esc(order.product_title || 'Order') + '</div>' +
      '<div class="text-muted" style="font-size:12px;">' + subBits.join(' · ') + '</div>' +
      '</div>' +
      '<span class="badge ' + badge.className + '">' + badge.icon + ' ' + esc(badge.label) + '</span>' +
      '</div>';

    html += trackerHtml;

    const refundText = order.payment_method
      ? fmt$(order.cashback_amount) + ' via ' + esc(order.payment_method)
      : fmt$(order.cashback_amount) + ' cashback';

    html += '<div class="flex justify-between items-center flex-wrap gap-8 mt-16">' +
      '<div class="refund-method">💰 ' + refundText + '</div>';
    if (String(order.status).trim() === 'Cashback Sent') {
      html += '<span class="badge badge--ok">💸 Cashback Sent!</span>';
    }
    html += '</div>';

    if (order.keyword) {
      html += '<div class="form-hint mt-8">Keyword: ' + esc(order.keyword) + '</div>';
    }
    if (links) html += '<div class="link-list">' + links + '</div>';
    if (order.notes && String(order.notes).trim()) {
      html += '<div class="form-hint mt-8">Note: ' + esc(order.notes) + '</div>';
    }

    html += '</div>';
    return html;
  }

  // ----------------------------------------------------------------------------
  // STAGGERED ENTRANCE ANIMATIONS
  // ----------------------------------------------------------------------------

  /**
   * Applies the .slide-up entrance animation to every direct child of
   * `container` with an incremental animation-delay, for the "list entrances"
   * motion requirement. Call after rendering a list/grid.
   */
  function staggerChildren(container, baseDelayMs, stepMs) {
    if (!container) return;
    baseDelayMs = baseDelayMs === undefined ? 0 : baseDelayMs;
    stepMs = stepMs === undefined ? 60 : stepMs;
    Array.prototype.forEach.call(container.children, function (child, i) {
      child.classList.add('slide-up');
      child.style.animationDelay = (baseDelayMs + i * stepMs) + 'ms';
    });
  }

  // ----------------------------------------------------------------------------
  // PAGE MOUNT
  // ----------------------------------------------------------------------------

  /** Call once per page (on DOMContentLoaded) to wire up shared chrome. */
  function mount() {
    initParticles();
    captureRef();
    ensureToastContainer();
  }

  // ----------------------------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------------------------

  global.HH = {
    API: API,
    PAYMENT_METHODS: PAYMENT_METHODS,
    ORDER_STATUSES: ['Pending', 'Ordered', 'Delivered', 'Cashback Sent', 'Rejected', 'Need More Info', 'PayPal Issue'],
    TRACKER_STEPS: TRACKER_STEPS,
    ERROR_STATUSES: ERROR_STATUSES,

    get: get,
    post: post,
    callPost: callPost,
    uploadFile: uploadFile,

    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    getAuthBody: getAuthBody,
    requireAuth: requireAuth,

    captureRef: captureRef,
    getRef: getRef,

    fmt$: fmt$,
    setCurrencySymbol: setCurrencySymbol,
    timeAgo: timeAgo,
    fmtDate: fmtDate,
    statusBadge: statusBadge,
    productStatusBadge: productStatusBadge,
    stockBadge: stockBadge,
    trackerState: trackerState,
    renderOrderCard: renderOrderCard,
    esc: esc,

    toast: toast,
    initParticles: initParticles,
    staggerChildren: staggerChildren,
    mount: mount
  };
})(window);
