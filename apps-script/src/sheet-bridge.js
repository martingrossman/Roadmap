/* Roadmap ↔ Google Sheets bridge.
 * Runs before the planner script. Active only when doGet() injected ROADMAP_SHEET_BOOT,
 * so the same Index.html still works as a plain file (it then saves to this browser).
 * The planner calls RoadmapSheet.persist() instead of localStorage, and asks this bridge
 * for the PDF engine, which lives in separate Apps Script files and loads on demand.
 */
(function () {
  'use strict';
  const BOOT = window.ROADMAP_SHEET_BOOT;
  if (!BOOT) return;

  // Hand the Sheet's plan to the planner through its normal embedded-plan slot.
  if (BOOT.plan) {
    const slot = document.getElementById('embedded-plan');
    if (slot) slot.textContent = JSON.stringify(BOOT.plan);
  }

  const SAVE_DELAY = 1200, CHECK_EVERY = 60000, CHECK_MIN_GAP = 15000;
  let revision = BOOT.revision;
  let active = false, readOnly = '', dirty = false, inflight = false, timer = 0;
  let conflict = null, retryDelay = 5000, lastCheck = 0, savedBy = BOOT.savedBy || '', savedAt = BOOT.savedAt || '';
  let pdfCode = null, pdfPromise = null;

  function call(fn) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise((resolve, reject) => {
      const run = window.google && google.script && google.script.run;
      if (!run) return reject(new Error('Google Apps Script is not available on this page.'));
      run.withSuccessHandler(resolve)
        .withFailureHandler(e => reject(e instanceof Error ? e : new Error(String(e && e.message || e))))[fn].apply(null, args);
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function indicator(kind, text, title) {
    const el = document.getElementById('saveIndicator');
    if (!el) return;
    const mark = kind === 'warn' && typeof icon === 'function' ? icon('warning')
      : '<span class="saved-dot"' + (kind === 'busy' ? ' style="opacity:.35"' : '') + '></span>';
    el.innerHTML = mark + escapeHtml(text);
    el.title = title || '';
    el.style.cursor = conflict ? 'pointer' : '';
  }

  function savedTitle() {
    return 'Stored in the Google Sheet' + (savedAt ? ' · last saved ' + savedAt + (savedBy ? ' by ' + savedBy : '') : '');
  }

  function banner(message, details) {
    let el = document.getElementById('roadmap-sheet-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'roadmap-sheet-banner';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;max-width:min(720px,calc(100vw - 32px));' +
        'background:#fff4f2;color:#7a1f17;border:1px solid #f0b8ae;border-radius:10px;padding:12px 40px 12px 16px;' +
        'box-shadow:0 8px 28px rgba(0,0,0,.12);font-size:14px;line-height:1.45';
      document.body.appendChild(el);
    }
    const list = (details || []).slice(0, 6).map(d => '<li>' + escapeHtml(d) + '</li>').join('');
    el.innerHTML = '<strong>' + escapeHtml(message) + '</strong>' + (list ? '<ul style="margin:6px 0 0;padding-left:18px">' + list + '</ul>' : '') +
      '<button type="button" aria-label="Dismiss" style="position:absolute;right:8px;top:6px;border:0;background:none;font-size:20px;color:inherit">×</button>';
    el.querySelector('button').onclick = () => el.remove();
  }

  function setReadOnly(reason, details) {
    readOnly = reason;
    clearTimeout(timer);
    banner(reason + ' Changes you make here are not saved.', details);
    indicator('warn', 'Not saving', reason);
  }

  function friendly(err) {
    const msg = err && err.message ? err.message : String(err);
    if (/permission|not have access|authoriz/i.test(msg)) return 'You have view-only access to this Sheet.';
    return msg;
  }

  // Called by the planner's persist() after every change.
  function persist() {
    if (!active) return;
    if (readOnly) return indicator('warn', 'Not saving', readOnly);
    dirty = true;
    if (conflict) return indicator('warn', 'Not saved · Sheet changed', 'Click to resolve');
    indicator('busy', 'Saving…');
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
  }

  async function flush(force) {
    if (inflight || !dirty || readOnly || (conflict && !force)) return;
    inflight = true;
    dirty = false;
    let retry = false;
    try {
      const res = await call('savePlan', JSON.stringify(state.plan), revision, !!force);
      if (res && res.ok) {
        revision = res.revision; conflict = null; retryDelay = 5000;
        savedBy = res.savedBy || savedBy; savedAt = res.savedAt || savedAt;
        if (!dirty) indicator('ok', 'Saved to Sheet', savedTitle());
      } else if (res && res.conflict) {
        dirty = true; conflict = res;
        indicator('warn', 'Not saved · Sheet changed', 'Click to resolve');
        askConflict();
      }
    } catch (err) {
      dirty = true;
      const msg = friendly(err);
      if (/view-only/.test(msg)) setReadOnly(msg);
      else {
        indicator('warn', 'Not saved · retrying', msg);
        toast('Could not save to the Sheet. ' + msg, true);
        retry = true;
      }
    } finally {
      inflight = false;
    }
    if (dirty && !conflict && !readOnly) {
      clearTimeout(timer);
      timer = setTimeout(flush, retry ? retryDelay : SAVE_DELAY);
      if (retry) retryDelay = Math.min(retryDelay * 2, 60000);
    }
  }

  function askConflict() {
    if (!conflict) return;
    const who = conflict.savedBy && conflict.savedBy !== 'someone' ? conflict.savedBy : 'Someone';
    if (!conflict.plan) {
      confirmDialog('The Sheet could not be read',
        'The Sheet changed and its data is not readable right now' + (conflict.error ? ' (' + conflict.error + ')' : '') +
        '. Fix it in the Sheet, or replace it with your version from this planner.', overwrite, 'Replace Sheet data', true);
      return;
    }
    confirmDialog('The plan changed in the Sheet',
      who + ' changed this plan in the Sheet after you opened it. Load the Sheet version to continue? ' +
      'Your latest changes here will be discarded. To keep yours instead, choose Cancel and click "Not saved" at the top of the page.',
      () => applyRemote(conflict.plan, conflict.revision, 'Loaded the latest plan from the Sheet'), 'Load Sheet version');
  }

  function overwrite() {
    conflict = null; dirty = true;
    indicator('busy', 'Saving…');
    flush(true);
  }

  function askOverwrite() {
    if (!conflict) return;
    confirmDialog('Replace the Sheet with your version?',
      'This overwrites the plan in the Sheet with what you see here. Changes other people made since you opened the planner will be lost.',
      overwrite, 'Overwrite Sheet', true);
  }

  function applyRemote(plan, rev, message, problems) {
    let next;
    try { next = validatePlan(plan); } catch (err) {
      setReadOnly('The Sheet has data the planner cannot use (' + err.message + '). Fix it in the Sheet, then reload this page.', problems);
      return;
    }
    const previous = state.plan;
    state.plan = next;
    state.undo = []; state.redo = [];
    if (next.year !== previous.year) state.year = next.year;
    try { if (typeof RoadmapCanvas !== 'undefined' && RoadmapCanvas.reconcileOutcomeFilter) RoadmapCanvas.reconcileOutcomeFilter(previous, next); } catch (e) { /* optional */ }
    cleanFilters();
    revision = rev; conflict = null; dirty = false;
    render();
    indicator('ok', 'Saved to Sheet', savedTitle());
    if (message) toast(message);
  }

  // A dialog or the item side panel is open: don't swap data under a form someone is filling in.
  function formOpen() {
    const overlay = document.getElementById('detailOverlay');
    return !!document.querySelector('dialog[open]') || !!(overlay && !overlay.hidden);
  }

  async function checkRemote() {
    if (!active || readOnly || dirty || inflight || conflict) return;
    if (Date.now() - lastCheck < CHECK_MIN_GAP) return;
    if (formOpen()) return;
    lastCheck = Date.now();
    try {
      const r = await call('getRevision');
      if (!r || r.revision === revision || dirty || inflight) return;
      const full = await call('getPlan');
      if (dirty || inflight || formOpen()) return;
      savedBy = full.savedBy || savedBy; savedAt = full.savedAt || savedAt;
      if (full.plan) applyRemote(full.plan, full.revision, 'Updated with the latest changes from the Sheet', full.problems);
    } catch (e) { /* offline or busy: try again on the next check */ }
  }

  function activate() {
    const el = document.getElementById('saveIndicator');
    if (el) el.addEventListener('click', () => { if (conflict) askOverwrite(); });
    window.addEventListener('beforeunload', e => { if (dirty || inflight) { e.preventDefault(); e.returnValue = ''; } });
    if (BOOT.error) return setReadOnly('Could not read the Sheet: ' + BOOT.error);
    if (globalThis.RoadmapLoadError) {
      return setReadOnly('The Sheet has data the planner cannot use (' + globalThis.RoadmapLoadError + '). Fix it in the Sheet, then reload this page.',
        BOOT.problems);
    }
    active = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRemote(); });
    window.addEventListener('focus', checkRemote);
    setInterval(() => { if (!document.hidden) checkRemote(); }, CHECK_EVERY);
    if (!BOOT.plan) {
      // First run: the Sheet has no tabs yet, so store the plan that ships with the page.
      dirty = true;
      indicator('busy', 'Creating Sheet tabs…');
      flush().then(() => { if (!dirty && !conflict && !readOnly) toast('Your plan is now stored in the Google Sheet'); });
    } else {
      indicator('ok', 'Saved to Sheet', savedTitle());
    }
  }

  function loadPdfEngine() {
    if (globalThis.RoadmapPDF) return Promise.resolve();
    if (!pdfPromise) {
      pdfPromise = call('getPdfEngine').then(code => {
        pdfCode = code;
        const s = document.createElement('script');
        s.id = 'pdf-engine';
        s.textContent = code;
        document.head.appendChild(s);
        if (!globalThis.RoadmapPDF) throw new Error('The PDF exporter could not start.');
      }).catch(err => { pdfPromise = null; throw err; });
    }
    return pdfPromise;
  }

  // "Export → HTML" copies the page; strip the Sheet wiring so the copy works on its own.
  function cleanExport(doc) {
    doc.querySelectorAll('script').forEach(s => { if (s.id !== 'embedded-plan' && s.id !== 'roadmap-app') s.remove(); });
    doc.querySelectorAll('base, #roadmap-sheet-banner').forEach(e => e.remove());
    if (pdfCode) {
      const s = doc.createElement('script');
      s.id = 'pdf-engine';
      s.textContent = pdfCode;
      const app = doc.getElementById('roadmap-app');
      app.parentNode.insertBefore(s, app);
    }
  }

  window.RoadmapSheet = { persist: persist, loadPdfEngine: loadPdfEngine, cleanExport: cleanExport, flush: () => flush() };
  document.addEventListener('DOMContentLoaded', activate);
})();
