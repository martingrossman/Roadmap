// Minimal in-browser stand-in for the Apps Script services Code.gs uses,
// so the real Code.gs and Index.html can be exercised locally. Test-only.
(function () {
  'use strict';
  const sheets = [];
  const asCell = v => (v === undefined || v === null ? '' : v);

  function Sheet(name) {
    this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0;
  }
  Sheet.prototype = {
    getName() { return this.name; },
    getLastRow() { let n = 0; this.data.forEach((r, i) => { if (r && r.some(v => v !== '' && v !== false)) n = i + 1; }); return n; },
    getLastColumn() { let n = 0; this.data.forEach(r => (r || []).forEach((v, j) => { if (v !== '' && v !== false) n = Math.max(n, j + 1); })); return n; },
    getMaxRows() { return this.maxRows; },
    getMaxColumns() { return this.maxCols; },
    insertColumnsAfter(_, n) { this.maxCols += n; },
    insertRowsAfter(_, n) { this.maxRows += n; },
    setFrozenRows(n) { this.frozen = n; },
    setColumnWidth() {},
    clearContents() { this.data = []; return this; },
    getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return new Range(this, 2, 1, this.maxRows - 1, 1);
      return new Range(this, r, c, nr || 1, nc || 1);
    }
  };

  function Range(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  Range.prototype = {
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sheet.data[this.r - 1 + i] || [];
        out.push(Array.from({ length: this.nc }, (_, j) => asCell(row[this.c - 1 + j])));
      }
      return out;
    },
    setValues(values) {
      values.forEach((row, i) => {
        const at = this.r - 1 + i;
        this.sheet.data[at] = this.sheet.data[at] || [];
        row.forEach((v, j) => { this.sheet.data[at][this.c - 1 + j] = v; });
      });
      return this;
    },
    setValue(v) { return this.setValues([[v]]); },
    clearContent() {
      for (let i = 0; i < this.nr; i++) {
        const row = this.sheet.data[this.r - 1 + i];
        if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = '';
      }
      return this;
    },
    setNumberFormat() { return this; }, setDataValidation() { return this; }, insertCheckboxes() { return this; },
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }
  };

  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    getSheets: () => sheets.slice(),
    insertSheet(name, at) { const s = new Sheet(name); sheets.splice(at === undefined ? sheets.length : at, 0, s); return s; },
    deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1); },
    getSpreadsheetTimeZone: () => 'Europe/Prague',
    getId: () => 'fake-sheet'
  };
  ss.insertSheet('Sheet1');

  function builder() { const b = {}; ['requireValueInList', 'requireValueInRange', 'requireFormulaSatisfied', 'setAllowInvalid', 'setHelpText'].forEach(k => { b[k] = () => b; }); b.build = () => ({}); return b; }

  window.SpreadsheetApp = { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {}, newDataValidation: builder, getUi: () => ({}) };
  const lock = () => ({ tryLock: () => true, releaseLock() {} });
  window.LockService = { getDocumentLock: lock, getScriptLock: lock };
  window.ScriptApp = { getScriptId: () => 'test-script-id' };
  window.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) };
  window.Session = { getActiveUser: () => ({ getEmail: () => window.__mockUser || 'tester@example.com' }) };
  window.Utilities = {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF-8' },
    // Not MD5, but a stable digest of the text is all the tests need.
    computeDigest(_, text) { let h1 = 0x811c9dc5, h2 = 0; for (let i = 0; i < text.length; i++) { h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619); h2 = (h2 * 31 + text.charCodeAt(i)) | 0; } return [h1 >>> 24, (h1 >>> 16) & 255, (h1 >>> 8) & 255, h1 & 255, h2 >>> 24, (h2 >>> 16) & 255, (h2 >>> 8) & 255, h2 & 255].map(b => (b > 127 ? b - 256 : b)); },
    formatDate(d, tz, fmt) { return fmt === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : d.toISOString(); }
  };
  function load(name) { const x = new XMLHttpRequest(); x.open('GET', '../dist/' + name + '.html', false); x.send(); return x.responseText; }
  function output(html) { const o = { getContent: () => html, setTitle: () => o, addMetaTag: () => o, setWidth: () => o, setHeight: () => o }; return o; }
  window.HtmlService = { createHtmlOutputFromFile: n => output(load(n)), createHtmlOutput: output };

  // google.script.run: async, JSON round trip like the real thing, failures go to the failure handler.
  function runner(ok, fail) {
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return f => runner(f, fail);
        if (prop === 'withFailureHandler') return f => runner(ok, f);
        return (...args) => setTimeout(() => {
          try {
            if (window.__mockFail) throw new Error(window.__mockFail);
            const res = window[prop].apply(null, JSON.parse(JSON.stringify(args)));
            ok && ok(res === undefined ? null : JSON.parse(JSON.stringify(res)));
          } catch (e) { fail && fail(e); }
        }, 30);
      }
    });
  }
  window.google = { script: { run: runner() } };
  window.__sheets = sheets;
  window.__ss = ss;
})();
