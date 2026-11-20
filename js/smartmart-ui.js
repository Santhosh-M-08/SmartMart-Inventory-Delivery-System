/**
 * SmartMart unified navigation and page chrome (presentation only).
 * Applies to inventory.html, delivery.html and stock-intelligence.html.
 * Never edits inventory/order/forecast data, form IDs, tables or dialogs.
 * Dashboard (index.html) remains the design reference and is unchanged.
 */
(() => {
  'use strict';

  const pages = {
    'inventory.html': {
      title: 'Inventory Management',
      subtitle: 'View, search and update products and stock levels.'
    },
    'delivery.html': {
      title: 'Orders & Delivery',
      subtitle: 'Manage customer orders and track delivery progress.'
    },
    'stock-intelligence.html': {
      title: 'AI Stock Intelligence',
      subtitle: 'Machine Learning Demand Forecasting & Inventory Recommendations'
    }
  };

 const navItems = [
  { href: 'index.html', label: 'Dashboard', icon: '▦' },
  { href: 'inventory.html', label: 'Inventory', icon: '▤' },
  { href: 'delivery.html', label: 'Orders & Delivery', icon: '⇄' },
  { href: 'stock-intelligence.html', label: 'AI Stock Intelligence', icon: '◈' },
  { href: 'expiry.html', label: 'Expiry Management', icon: '◷' }
];

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function getFileName(url) {
    try {
      const pathname = new URL(url, window.location.href).pathname;
      return pathname.split('/').pop().toLowerCase() || 'index.html';
    } catch (_) {
      return '';
    }
  }

  function replaceSidebar(fileName) {
    const original = document.querySelector('.inv-sidebar, .app-layout > .sidebar');
    if (!original) return;

    // Preserve possible new sections introduced by other teammates.
    const extraLinks = Array.from(original.querySelectorAll('nav a'))
      .filter(a => !navItems.some(item => getFileName(a.getAttribute('href') || '') === item.href))
      .map(a => ({
        href: a.getAttribute('href') || '',
        label: a.textContent.trim()
      }))
      .filter(item => item.href && item.label && !/^(javascript|data):/i.test(item.href));

    const sidebar = make('aside', 'sm-sidebar');
    sidebar.id = 'smSidebar';
    sidebar.setAttribute('aria-label', 'Main navigation');

    const brand = make('a', 'sm-brand');
    brand.href = 'index.html';
    brand.append(make('span', 'sm-brand-mark', 'S'));
    brand.append(make('span', 'sm-brand-name', 'SmartMart'));
    sidebar.append(brand);

    sidebar.append(make('p', 'sm-nav-heading', 'WORKSPACE'));
    const nav = make('nav', 'sm-nav');
    nav.setAttribute('aria-label', 'Main navigation');

    navItems.forEach(item => {
      const link = make('a', 'sm-nav-link');
      link.href = item.href;
      if (fileName === item.href) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
      const icon = make('span', 'sm-nav-icon', item.icon);
      icon.setAttribute('aria-hidden', 'true');
      link.append(icon, make('span', '', item.label));
      nav.append(link);
    });

    extraLinks.forEach(item => {
      const link = make('a', 'sm-nav-link');
      link.href = item.href;
      link.append(make('span', 'sm-nav-icon', '◫'), make('span', '', item.label));
      nav.append(link);
    });

    sidebar.append(nav);
    const bottom = make('div', 'sm-sidebar-bottom');
    const note = make('div', 'sm-sidebar-note');
    note.append(make('span', 'sm-note-dot'));
    const info = make('div', 'sm-system-info');
    info.append(make('strong', '', 'SmartMart system'));
    info.append(make('span', '', 'Local demo mode'));
    note.append(info);
    bottom.append(note);

    const logout = make('button', 'sm-logout-button');
    logout.id = 'smLogoutButton';
    logout.type = 'button';
    logout.append(make('span', 'sm-nav-icon', '↪'), document.createTextNode(' Logout'));
    logout.addEventListener('click', () => {
      sessionStorage.removeItem('smartmart_demo_logged_in');
      window.location.href = 'login.html';
    });
    bottom.append(logout);
    sidebar.append(bottom);
    original.replaceWith(sidebar);

    // Mobile sidebar overlay: does not intercept clicks when closed.
    const overlay = make('div', 'sm-sidebar-overlay');
    overlay.id = 'smSidebarOverlay';
    document.body.append(overlay);
    return sidebar;
  }

  function makeTopbar(title) {
    const header = make('header', 'sm-topbar');
    const left = make('div', 'sm-topbar-left');
    const menu = make('button', 'sm-menu-toggle', '☰');
    menu.id = 'smMenuToggle';
    menu.type = 'button';
    menu.setAttribute('aria-label', 'Open navigation');
    menu.setAttribute('aria-controls', 'smSidebar');
    menu.setAttribute('aria-expanded', 'false');
    left.append(menu);

    const headings = make('div', 'sm-topbar-heading');
    headings.append(make('p', 'sm-eyebrow', 'SMARTMART MANAGEMENT'));
    headings.append(make('h1', '', title));
    left.append(headings);
    header.append(left);

    const right = make('div', 'sm-topbar-right');
    const date = make('div', 'sm-date-display');
    date.append(make('span', 'sm-date-icon', '▦'));
    date.append(make('span', '', new Intl.DateTimeFormat('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    }).format(new Date())));
    right.append(date);
    const avatar = make('div', 'sm-user-avatar', 'SM');
    avatar.setAttribute('aria-label', 'Demo user');
    right.append(avatar);
    header.append(right);
    return header;
  }

  function makeIntro(title, subtitle) {
    const section = make('section', 'sm-page-intro');
    const text = make('div', 'sm-intro-text');
    text.append(make('h2', '', title));
    text.append(make('p', '', subtitle));
    section.append(text);
    return section;
  }

  function initializeChrome(fileName, page) {
    const sidebar = replaceSidebar(fileName);
    if (!sidebar) return;

    if (fileName === 'inventory.html') {
      const content = document.querySelector('.inv-content');
      const inventoryMain = document.getElementById('inventoryModule');
      if (content && inventoryMain) {
        content.insertBefore(makeTopbar(page.title), inventoryMain);
        const existingHeading = inventoryMain.querySelector('.inv-head');
        if (existingHeading) {
          existingHeading.classList.add('sm-inventory-intro');
        }
      }
    }

    if (fileName === 'delivery.html') {
      const topbar = document.querySelector('.main-content > .topbar');
      if (topbar) topbar.replaceWith(makeTopbar(page.title));

      // Move the existing button node, never clone it: existing listeners remain attached.
      const intro = document.querySelector('.page-content > .page-heading');
      const button = document.getElementById('openCreateDeliveryBtn');
      if (intro) {
        intro.classList.add('sm-delivery-intro');
        if (button) intro.append(button);
      }
    }

    if (fileName === 'stock-intelligence.html') {
      const content = document.querySelector('.main-content');
      const oldHeader = content && content.querySelector(':scope > header');
      if (oldHeader) oldHeader.replaceWith(makeTopbar(page.title));
      const main = content && content.querySelector(':scope > main');
      if (main) main.prepend(makeIntro(page.title, page.subtitle));
    }

    const overlay = document.getElementById('smSidebarOverlay');
    const toggle = document.getElementById('smMenuToggle');
    if (!toggle || !overlay) return;

    const closeSidebar = () => {
      sidebar.classList.remove('sm-open');
      overlay.classList.remove('sm-visible');
      toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', () => {
      const open = sidebar.classList.toggle('sm-open');
      overlay.classList.toggle('sm-visible', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    overlay.addEventListener('click', closeSidebar);
    sidebar.querySelectorAll('.sm-nav-link').forEach(link => {
      link.addEventListener('click', closeSidebar);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSidebar();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) closeSidebar();
    });
  }

  function start() {
    const fileName = getFileName(window.location.href);
    const page = pages[fileName];
    if (!page) return;
    // Hide the legacy layout until every shared navigation element is in place.
    // Always reveal the page, even if a UI enhancement fails.
    try {
      initializeChrome(fileName, page);
    } catch (error) {
      console.error('SmartMart shared UI initialization failed:', error);
    } finally {
      document.body.classList.add(
        'sm-unified-page',
        `sm-page-${fileName.replace('.html', '')}`
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
