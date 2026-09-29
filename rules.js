/* Manual UI only: no game state, storage, random numbers, or decision calls. */
(() => {
  'use strict';
  const overlay = document.getElementById('helpOverlay');
  const helpButton = document.getElementById('helpBtn');
  const closeButton = document.getElementById('closeHelpBtn');
  if (!overlay || !helpButton || !closeButton) return;

  const dialog = overlay.querySelector('.rules-manual');
  const scroller = overlay.querySelector('.rules-scroll');
  let returnFocus = null;
  let savedOverflow = '';
  let background = [];
  let opened = false;

  function enhanceOpen() {
    if (opened) return;
    opened = true;
    returnFocus = document.activeElement;
    savedOverflow = document.body.style.overflow;
    background = ['gameShell', 'startOverlay', 'dayOverlay'].map(id => {
      const element = document.getElementById(id);
      return { element, inert: element ? element.inert : false };
    });
    background.forEach(({ element }) => { if (element) element.inert = true; });
    document.body.style.overflow = 'hidden';
    overlay.classList.add('active');
    if (scroller) scroller.scrollTop = 0;
    closeButton.focus({ preventScroll: true });
  }

  function finishClose() {
    if (!opened) return;
    opened = false;
    overlay.classList.remove('active');
    background.forEach(({ element, inert }) => { if (element) element.inert = inert; });
    background = [];
    document.body.style.overflow = savedOverflow;
    if (returnFocus && returnFocus.isConnected && returnFocus.getClientRects().length) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  // Existing game.js keeps ownership of the original help/close buttons.
  helpButton.addEventListener('click', enhanceOpen);
  closeButton.addEventListener('click', finishClose);
  overlay.addEventListener('click', event => { if (event.target === overlay) finishClose(); });
  document.querySelectorAll('[data-open-rules]').forEach(button => {
    button.addEventListener('click', () => helpButton.click());
  });
  overlay.querySelectorAll('[data-close-rules]').forEach(button => {
    button.addEventListener('click', () => closeButton.click());
  });
  overlay.querySelectorAll('[data-rules-jump]').forEach(button => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.rulesJump);
      if (!target || !overlay.contains(target)) return;
      if (target.tagName === 'DETAILS') target.open = true;
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      const heading = target.querySelector('summary, h3');
      if (heading) {
        if (heading.tagName !== 'SUMMARY') heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
  });

  // Modal keyboard handling cannot leak numeric shortcuts into the game.
  window.addEventListener('keydown', event => {
    if (!overlay.classList.contains('active')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeButton.click();
      return;
    }
    if (/^[1-4]$/.test(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = Array.from(dialog.querySelectorAll('button, a[href], summary, [tabindex="0"]'))
      .filter(element => !element.disabled && element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !focusable.includes(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !focusable.includes(active))) {
      event.preventDefault();
      first.focus();
    }
  }, true);
})();
