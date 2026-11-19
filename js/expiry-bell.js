/* ==========================================================================
   SmartMart — Expiry notification bell (NEW FILE)
   File: js/expiry-bell.js
   Mounts into <div class="exp-bell" id="expBell"></div>. Needs expiry-core.js first.
   ========================================================================== */
(function () {
  'use strict';
  const mount = document.getElementById('expBell');
  const X = window.SmartMartExpiry;
  if (!mount || !X) return;

  const TYPE = {
    warning: { label: 'Warning', icon: '!' },
    urgent: { label: 'Urgent', icon: '⚑' },
    discount: { label: 'Discount', icon: '%' },
    expired: { label: 'Expired', icon: '✕' }
  };
  const PANEL_COUNT = 6;

  mount.innerHTML =
    '<button type="button" class="exp-bell-btn" id="expBellBtn" aria-haspopup="true" aria-expanded="false" aria-label="Expiry notifications">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/></svg>' +
      '<span class="exp-bell-badge" id="expBellBadge" hidden>0</span>' +
    '</button>' +
    '<div class="exp-bell-panel" id="expBellPanel" role="dialog" aria-label="Expiry notifications" hidden></div>';

  const btn = document.getElementById('expBellBtn');
  const badge = document.getElementById('expBellBadge');
  const panel = document.getElementById('expBellPanel');

  function itemHtml(n) {
    const t = TYPE[n.type] || TYPE.warning;
    return '<li class="exp-ntf exp-ntf--' + X.esc(n.type) + (n.read ? '' : ' is-unread') + '" data-id="' + X.esc(n.id) + '">' +
      '<button type="button" class="exp-ntf-main" data-open="' + X.esc(n.id) + '">' +
        '<span class="exp-ntf-icon" aria-hidden="true">' + t.icon + '</span>' +
        '<span class="exp-ntf-body">' +
          '<span class="exp-ntf-title">' + X.esc(n.title) + ' <em>' + t.label + '</em></span>' +
          '<span class="exp-ntf-msg">' + X.esc(n.message) + '</span>' +
          '<span class="exp-ntf-time">' + X.esc(X.formatDateTime(n.createdAt)) + '</span>' +
        '</span>' +
      '</button>' +
      (n.read ? '' : '<button type="button" class="exp-ntf-read" data-read="' + X.esc(n.id) + '" title="Mark as read">Mark read</button>') +
    '</li>';
  }

  function render() {
    const unread = X.unreadCount();
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : unread;
    btn.setAttribute('aria-label', 'Expiry notifications, ' + unread + ' unread');

    const list = X.getNotifications().slice(0, PANEL_COUNT);
    panel.innerHTML =
      '<div class="exp-bell-head"><strong>Notifications</strong><span>' + unread + ' unread</span></div>' +
      (list.length
        ? '<ul class="exp-ntf-list">' + list.map(itemHtml).join('') + '</ul>'
        : '<p class="exp-bell-empty">No expiry alerts yet. You are all caught up.</p>') +
      '<div class="exp-bell-foot">' +
        '<button type="button" class="exp-link-btn" id="expMarkAll"' + (unread ? '' : ' disabled') + '>Mark all as read</button>' +
        '<a class="exp-link-btn" href="expiry.html#notifications">View all notifications</a>' +
      '</div>';
  }

  function openBatch(n) {
    X.markRead(n.id);
    const url = 'expiry.html?batch=' + encodeURIComponent(n.batchId) + '#batches';
    // On the Expiry page the page handles it without reloading (it calls preventDefault).
    const handled = !window.dispatchEvent(new CustomEvent('smartmart:open-batch', { detail: { id: n.batchId }, cancelable: true }));
    if (handled) { close(); return; }
    window.location.href = url;
  }

  function open() { render(); panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  function close() { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

  btn.addEventListener('click', function (e) { e.stopPropagation(); panel.hidden ? open() : close(); });
  panel.addEventListener('click', function (e) {
    e.stopPropagation();
    const read = e.target.closest('[data-read]');
    if (read) { X.markRead(read.dataset.read); return; }
    const opener = e.target.closest('[data-open]');
    if (opener) {
      const n = X.getNotifications().find(x => x.id === opener.dataset.open);
      if (n) openBatch(n);
      return;
    }
    if (e.target.id === 'expMarkAll') X.markAllRead();
  });
  document.addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { close(); btn.focus(); } });
  window.addEventListener('smartmart:expiry-changed', function () { render(); });

  render();
})();