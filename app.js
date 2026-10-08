/* Second Mile ESE Compliance Visit — Stage 1
   Shell, school directory, new visit workflow, individual student file review,
   student-file scoring. No external services, no AI calls. */
(function () {
  'use strict';

  const R = window.SM_RULES;
  const RULE = Object.fromEntries(R.items.map(i => [i.id, i]));
  const KEY = 'sm-ese-compliance-visit:v1';

  const COUNTIES = ['Miami-Dade', 'Lee', 'Hillsborough', 'Palm Beach'];
  const COUNTY_DEFAULTS = {
    'Miami-Dade': { district: 'Miami-Dade County Public Schools', system: 'EMS' },
    'Lee': { district: 'The School District of Lee County', system: 'PEER' },
    'Hillsborough': { district: 'Hillsborough County Public Schools', system: 'PEER' },
    'Palm Beach': { district: 'The School District of Palm Beach County', system: 'Not yet verified' }
  };
  const ROLES = [['principal', 'Principal'], ['ap', 'Assistant principal'], ['ese', 'ESE specialist or lead']];
  const VISIT_TYPES = ['Readiness Review', 'Renewal Support', 'Follow-Up', 'District Audit Preparation', 'General Compliance Support'];
  const MODES = [['files', 'Individual student files'], ['schoolwide', 'Schoolwide review'], ['both', 'Both']];
  const EVENTS = [['initial', 'Initial IEP'], ['annual', 'Annual Review'], ['reeval', 'Reevaluation'], ['amendment', 'IEP Amendment'], ['transfer', 'Transfer Review'], ['other', 'Other']];
  const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Post-12 (18–22)'];
  const RATINGS = {
    MC: { label: 'Meets compliance', sym: '✓' },
    NI: { label: 'Needs improvement', sym: '~' },
    AR: { label: 'Action required', sym: '!' },
    NA: { label: 'Not applicable', sym: '–' },
    NR: { label: 'Not reviewed', sym: '?' }
  };
  const FIX = {
    now: 'Correct now in the folder or system',
    meeting: 'Carry to the next interim or annual IEP meeting',
    system: 'System limitation — not held against staff',
    evidence: 'Missing evidence — request documentation'
  };
  const FIX_ACTION = {
    now: 'Correct or upload the documentation in the folder or district system, then notify the Compliance Team for verification.',
    meeting: 'Address this at the next interim or annual IEP meeting and record the change in the conference notes.',
    system: 'Record as a system limitation. No staff correction is required; raise with the district contact if needed.',
    evidence: 'Provide the missing documentation to the Compliance Team for verification.'
  };
  const PRIORITIES = ['High', 'Medium', 'Low'];
  const STATUSES = ['Open', 'In Progress', 'Pending Verification', 'Resolved'];

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = p => p + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const localDate = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const fmtDate = s => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 86400000);
  const pct = n => (n == null ? '—' : n + '%');
  const options = (list, sel) => list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
  const isDemoId = id => /^DEMO-[A-Z0-9-]+$/i.test(id || '');

  /* ---------- storage ---------- */
  const canStore = (() => { try { const k = '__sm_t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } })();
  let store, lastSaved = null, saveTimer = null;

  function defaults() {
    return {
      schema: 1,
      settings: {
        demoMode: true, reviewerName: '',
        ratingValues: { MC: 100, NI: 50, AR: 0 },
        weights: { files: 60, schoolwide: 40 },
        excludeSystemFindings: true,
        transitionStartAge: 14
      },
      schools: seedSchools(),
      visits: [],
      draftVisit: null
    };
  }
  function seedSchools() { return []; }

  /* Merge the Second Mile roster once per roster version. Only fills blanks,
     so edits you make in the app are never overwritten. */
  function applyRoster() {
    const RO = window.SM_ROSTER;
    if (!RO || store.rosterVersion === RO.version) return 0;
    let added = 0;
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    RO.schools.forEach(r => {
      let s = store.schools.find(x => norm(x.name) === norm(r.name));
      if (!s) { s = newSchool({ name: r.name, county: r.county }); store.schools.push(s); added++; }
      if (!s.county) s.county = r.county;
      if (!s.district) s.district = (COUNTY_DEFAULTS[s.county] || {}).district || '';
      if (!s.system) s.system = (COUNTY_DEFAULTS[s.county] || {}).system || '';
      if (!s.phone) s.phone = r.phone;
      if (!s.url) s.url = r.url;
      const fill = (role, name, title) => { const c = contact(s, role); if (c && !c.name && name) { c.name = name; if (title && !c.title) c.title = title; } };
      fill('principal', r.principal); fill('ap', r.ap);
      const ese = r.ese || [];
      if (ese[0]) fill('ese', ese[0][0], ese[0][1]);
      const extra = ese.slice(1).map(([n, t]) => [t || 'ESE contact', n])
        .concat((r.esol || []).map(([n, t]) => [t || 'ESOL contact', n]))
        .concat(r.other || []);
      extra.forEach(([title, name]) => {
        if (!s.contacts.some(c => norm(c.name) === norm(name))) s.contacts.push({ role: 'other', title, name, email: '' });
      });
      const missing = [];
      if (!ese.length) missing.push('ESE contact');
      if (!(r.esol || []).length && !/ESOL/.test(ese.map(e => e[1]).join(' '))) missing.push('ESOL contact');
      const note = [RO.sourceNote, r.extraNote || '', missing.length ? `${missing.join(' and ')} not publicly listed. Call the main office to confirm the designee before sending student information.` : ''].filter(Boolean).join(' ');
      if (!s.notes) s.notes = note;
      s.verified = true;
    });
    store.rosterVersion = RO.version;
    return added;
  }
  function newSchool(p = {}) {
    const county = p.county || '';
    const d = COUNTY_DEFAULTS[county] || {};
    return {
      id: uid('S'), name: p.name || '', county, district: p.district || d.district || '',
      address: p.address || '', phone: p.phone || '', url: p.url || '',
      system: p.system || d.system || '', checklist: p.checklist || ('Draft rules ' + R.version),
      contacts: ROLES.map(([role]) => ({ role, title: '', name: '', email: '' })),
      verified: false, active: true, notes: ''
    };
  }
  function seedDemoVisit() {
    const s = store.schools.find(x => x.name.startsWith('Kendall')) || store.schools[0];
    if (!s) return;
    const v = newVisit(s.id);
    Object.assign(v, { type: 'Readiness Review', mode: 'files', demo: true });
    Object.assign(v.counts, { files: 3, teachers: 2, classrooms: 1 });
    const f1 = newFile(); Object.assign(f1, { studentId: 'DEMO-1001', grade: '11', age: '16', event: 'annual', annualDate: localDate(new Date(Date.now() - 300 * 864e5)), reevalDate: localDate(new Date(Date.now() + 400 * 864e5)) });
    f1.flags.consult = true;
    const f2 = newFile(); Object.assign(f2, { studentId: 'DEMO-1002', grade: '9', age: '14', event: 'reeval', annualDate: localDate(new Date(Date.now() - 20 * 864e5)) });
    v.files.push(f1, f2);
    ['A1', 'A2', 'A3', 'B1', 'B3', 'C1', 'C2', 'C3'].forEach(id => rate(f1, id, 'MC', true));
    rate(f1, 'B6', 'NI', true);
    rate(f1, 'E2', 'AR', true);
    Object.assign(f1.items.E2.finding, { evidence: 'Consultation logs located for August only; September logs not in the folder.', target: localDate(new Date(Date.now() + 10 * 864e5)) });
    ['A2', 'A3', 'A5'].forEach(id => rate(f2, id, 'MC', true));
    store.visits.push(v);
  }

  function load() {
    let data = null;
    if (canStore) { try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) { data = null; } }
    if (!data || data.schema !== 1) { store = defaults(); applyRoster(); seedDemoVisit(); persist(true); return; }
    const d = defaults();
    store = Object.assign(d, data);
    if (applyRoster() >= 0) persist(true);
    store.settings = Object.assign(d.settings, data.settings || {});
    store.settings.ratingValues = Object.assign({ MC: 100, NI: 50, AR: 0 }, store.settings.ratingValues);
  }
  function persist(silent) {
    const copy = JSON.parse(JSON.stringify(store));
    if (!copy.settings.demoMode) {
      // Production mode: never write student-level data to browser storage.
      copy.visits.forEach(v => { v.files = []; v.filesHeldInMemory = true; });
      if (copy.draftVisit) copy.draftVisit.files = [];
    }
    if (canStore) {
      try { localStorage.setItem(KEY, JSON.stringify(copy)); }
      catch (e) { toast('Could not save. Browser storage is full or blocked.'); return; }
    }
    lastSaved = new Date();
    if (!silent) updateSaveStatus();
  }
  function touch() {
    if (ctx.visit) ctx.visit.updatedAt = new Date().toISOString();
    $('#saveStatus').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(), 400);
  }
  function updateSaveStatus() {
    const el = $('#saveStatus');
    if (!canStore) { el.textContent = 'Not saving: storage unavailable'; return; }
    el.textContent = lastSaved ? 'Saved ' + lastSaved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }

  /* ---------- model ---------- */
  function newVisit(schoolId) {
    return {
      id: uid('V'), schoolId: schoolId || '', date: localDate(), reviewer: store.settings.reviewerName || '',
      type: 'Readiness Review', mode: 'files',
      counts: { files: 0, teachers: 0, classrooms: 0, lessonPlans: 0, consultLogs: 0, serviceLogs: 0 },
      purpose: '', status: 'in-progress', files: [], demo: store.settings.demoMode,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }
  function newFile() {
    return {
      id: uid('F'), studentId: '', grade: '', age: '', event: 'annual',
      annualDate: '', reevalDate: '', iepStart: '', iepEnd: '', serviceNotes: '',
      flags: { consult: false, related: false, altAssess: false, agency: false, rightsTransferred: false },
      items: {}
    };
  }
  const school = id => store.schools.find(s => s.id === id);
  const contact = (s, role) => s && s.contacts.find(c => c.role === role);

  function applies(it, f) {
    const s = it.show || {};
    if (s.events && !s.events.includes(f.event)) return false;
    if (s.notEvents && s.notEvents.includes(f.event)) return false;
    if (s.flag && !f.flags[s.flag]) return false;
    if (s.minAge != null) {
      const min = s.minAge === 'transition' ? Number(store.settings.transitionStartAge) : s.minAge;
      const age = parseInt(f.age, 10);
      if (!(age >= min)) return false;
    }
    return true;
  }
  const applicable = f => R.items.filter(it => applies(it, f));
  const itemState = (f, id) => (f.items[id] = f.items[id] || { rating: '', evidence: [], notes: '', ref: '', history: [], finding: null });
  const isFindingRating = r => r === 'NI' || r === 'AR';

  function rate(f, id, r, quiet) {
    const st = itemState(f, id);
    if (st.rating === r) return;
    st.history.push({ from: st.rating || 'Unrated', to: r, at: new Date().toISOString() });
    st.rating = r;
    if (isFindingRating(r)) ensureFinding(f, id);
    if (!quiet) touch();
  }
  function autoDescription(it, r) {
    return `${it.title}: ${r === 'AR' ? 'required evidence is missing, overdue, or does not meet the review criteria' : 'evidence is present but needs clarification, completion, or correction'}.`;
  }
  function autoEvidence(it, st) {
    const open = it.evidence.filter((_, i) => !st.evidence[i]);
    return open.length ? 'Evidence checks not confirmed at review: ' + open.join('; ') + '.' : '';
  }
  function ensureFinding(f, id) {
    const st = itemState(f, id), it = RULE[id];
    const v = ctx.visit;
    const lead = v && contact(school(v.schoolId), 'ese');
    if (!st.finding) {
      st.finding = {
        id: uid('FN'), description: autoDescription(it, st.rating), autoDesc: true,
        evidence: autoEvidence(it, st), autoEvid: true,
        fix: it.fix || 'now', action: FIX_ACTION[it.fix || 'now'], autoAction: true,
        responsible: (lead && lead.name) || '', target: '',
        priority: st.rating === 'AR' ? (it.critical ? 'High' : 'Medium') : 'Low',
        status: 'Open', createdAt: new Date().toISOString()
      };
    } else {
      if (st.finding.autoDesc) st.finding.description = autoDescription(it, st.rating);
      if (st.finding.autoEvid) st.finding.evidence = autoEvidence(it, st);
      if (st.finding.status === 'Resolved') st.finding.status = 'Open';
    }
    return st.finding;
  }
  function findingIssues(fd) {
    const need = [], fin = [];
    if (!fd.description.trim()) need.push('description');
    if (!fd.evidence.trim()) need.push('evidence observed');
    if (!fd.action.trim()) need.push('corrective action');
    if (!fd.responsible.trim()) fin.push('responsible staff');
    if (!fd.target) fin.push('target date');
    return { need, fin };
  }

  /* ---------- scoring ----------
     Pooled across items so every file and section is weighted by its
     applicable denominator, never by averaging percentages. */
  function fileStats(f) {
    const vals = store.settings.ratingValues;
    const s = { total: 0, addressed: 0, notReviewed: 0, na: 0, scored: 0, points: 0, MC: 0, NI: 0, AR: 0, excludedSystem: 0, critical: [] };
    applicable(f).forEach(it => {
      s.total++;
      const st = f.items[it.id], r = st && st.rating;
      if (!r || r === 'NR') { s.notReviewed++; return; }
      s.addressed++;
      if (r === 'NA') { s.na++; return; }
      s[r]++;
      if (r === 'AR' && it.critical) s.critical.push(it.id);
      if (store.settings.excludeSystemFindings && isFindingRating(r) && st.finding && st.finding.fix === 'system') { s.excludedSystem++; return; }
      s.scored++; s.points += Number(vals[r]) || 0;
    });
    s.score = s.scored ? Math.round(s.points / s.scored) : null;
    s.progress = s.total ? Math.round((s.addressed / s.total) * 100) : 0;
    return s;
  }
  function visitStats(v) {
    const t = { files: v.files.length, planned: Number(v.counts.files) || 0, total: 0, addressed: 0, notReviewed: 0, scored: 0, points: 0, MC: 0, NI: 0, AR: 0, excludedSystem: 0 };
    v.files.forEach(f => { const s = fileStats(f); ['total', 'addressed', 'notReviewed', 'scored', 'points', 'MC', 'NI', 'AR', 'excludedSystem'].forEach(k => (t[k] += s[k])); });
    t.score = t.scored ? Math.round(t.points / t.scored) : null;
    t.itemProgress = t.total ? Math.round((t.addressed / t.total) * 100) : 0;
    return t;
  }
  function visitFindings(v) {
    const out = [];
    v.files.forEach((f, fi) => Object.entries(f.items).forEach(([id, st]) => {
      if (RULE[id] && isFindingRating(st.rating) && st.finding && applies(RULE[id], f)) out.push({ visit: v, file: f, fileNo: fi + 1, item: RULE[id], st, fd: st.finding });
    }));
    return out;
  }
  const allFindings = () => store.visits.flatMap(visitFindings);

  /* ---------- UI state & routing ---------- */
  const ctx = { visit: null, file: null, school: null };
  const ui = { openItems: new Set(), schoolFilter: 'All', showInactive: false, search: '', importRows: null };

  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const p = h.split('/');
    ctx.visit = ctx.file = ctx.school = null;
    let html, nav = p[0] || '';
    try {
      if (!p[0]) html = viewDashboard();
      else if (p[0] === 'visit' && p[1] === 'new') { nav = 'visit/new'; html = viewNewVisit(); }
      else if (p[0] === 'visit' && p[1]) {
        const v = store.visits.find(x => x.id === p[1]);
        if (!v) html = notFound('That visit could not be found.');
        else if (p[2] === 'file' && p[3]) {
          const f = v.files.find(x => x.id === p[3]);
          html = f ? viewFile(v, f) : notFound('That student file could not be found. In production mode, student files are cleared when the app closes.');
          nav = 'files';
        } else { html = viewVisit(v); nav = 'files'; }
      }
      else if (p[0] === 'files') html = viewFilesHub();
      else if (p[0] === 'schools' && p[1] === 'import') { nav = 'schools'; html = viewImport(); }
      else if (p[0] === 'schools') html = viewSchools();
      else if (p[0] === 'school' && p[1]) { nav = 'schools'; const s = school(p[1]); html = s ? viewSchool(s) : notFound('That school could not be found.'); }
      else if (p[0] === 'visits') html = viewVisits();
      else if (p[0] === 'settings') html = viewSettings();
      else if (p[0] === 'schoolwide') html = viewPlanned('Schoolwide compliance review', 2, 'It will cover instruction and lesson plans, service delivery, consultation, accommodations, progress monitoring, and school readiness, with records examined and met counts for each section, plus the combined readiness score.');
      else if (p[0] === 'actions') html = viewPlanned('Corrective action tracker', 2, 'Findings you record during file reviews are already saved with their owner, target date, priority, and status. Stage 2 adds the tracker view, follow-up visit references, and the verification step required before a finding can be marked Resolved.');
      else if (p[0] === 'reports') html = viewPlanned('Compliance reports', 3, 'It will generate the leadership report and the separate student-level findings report from your recorded ratings, with print and PDF output, plus the Review and Send email screen.');
      else html = notFound('That page does not exist.');
    } catch (err) { console.error(err); html = notFound('Something went wrong loading this page: ' + esc(err.message)); }
    $('#view').innerHTML = html;
    document.querySelectorAll('#nav a').forEach(a => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    closeNav(); renderBanner(); updateSaveStatus();
    if (!route.keepScroll) window.scrollTo(0, 0);
    route.keepScroll = false;
  }
  const rerender = () => { route.keepScroll = true; const y = window.scrollY; route(); window.scrollTo(0, y); };
  const notFound = msg => `<div class="page-head"><h1>Not found</h1></div><div class="notice"><p>${msg}</p><a class="btn" href="#/">Go to dashboard</a></div>`;
  function closeNav() { $('#nav').classList.remove('open'); $('.menu-btn').setAttribute('aria-expanded', 'false'); }

  function renderBanner() {
    const b = $('#banner');
    if (!canStore) { b.innerHTML = `<div class="banner warn">This browser is blocking storage, so nothing will be saved after you close the app. Open it from its own web address or installed icon to keep your work.</div>`; return; }
    b.innerHTML = store.settings.demoMode
      ? `<div class="banner">Demo mode: use fictional student IDs that start with DEMO-. Demo data stays on this device only.</div>`
      : `<div class="banner warn">Production mode without a secure backend: student IDs and file reviews stay in memory and are cleared when the app closes. Visit details and school records still save on this device.</div>`;
  }

  /* ---------- views: dashboard ---------- */
  function viewDashboard() {
    const open = store.visits.filter(v => v.status !== 'complete').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const findings = allFindings();
    const outstanding = findings.filter(x => x.fd.status !== 'Resolved');
    const today = localDate();
    const due = outstanding.filter(x => x.fd.target && daysBetween(today, x.fd.target) <= 14).sort((a, b) => a.fd.target.localeCompare(b.fd.target));
    const noDate = outstanding.filter(x => !x.fd.target).length;
    return `
      <div class="page-head">
        <div><h1>Compliance visits</h1><p>Pick up where you left off, or start a new visit.</p></div>
        <a class="btn primary" href="#/visit/new">Start a compliance visit</a>
      </div>
      <div class="figures">
        <div class="figure"><b>${open.length}</b><span>Unfinished visits</span></div>
        <div class="figure"><b>${outstanding.length}</b><span>Outstanding findings</span></div>
        <div class="figure"><b>${due.length}</b><span>Follow-ups due in 14 days</span></div>
        <div class="figure"><b>0</b><span>Completed reports (Stage 3)</span></div>
      </div>
      <section class="panel"><h2>Unfinished visits</h2>
        ${open.length ? `<ul class="list">${open.map(visitRow).join('')}</ul>` : `<p class="empty">No visits in progress. Start one when you arrive at a school.</p>`}
      </section>
      <section class="panel"><h2>Upcoming follow-ups</h2>
        ${due.length ? `<ul class="list">${due.map(x => {
          const s = school(x.visit.schoolId); const late = daysBetween(today, x.fd.target) < 0;
          return `<li><a class="list-row" href="#/visit/${x.visit.id}/file/${x.file.id}">
            <div class="grow"><div class="title">${esc(x.item.title)}</div><div class="meta">${esc(s ? s.name : 'Unknown school')}, file ${x.fileNo}. ${esc(x.fd.status)}. ${esc(x.fd.responsible || 'No owner yet')}</div></div>
            <span class="badge${late ? ' critical' : ''}">${late ? 'Overdue' : 'Due'} ${fmtDate(x.fd.target)}</span></a></li>`;
        }).join('')}</ul>` : `<p class="empty">No findings are due in the next 14 days.</p>`}
        ${noDate ? `<p class="small muted">${noDate} open finding${noDate === 1 ? ' has' : 's have'} no target date yet.</p>` : ''}
      </section>`;
  }
  function visitRow(v) {
    const s = school(v.schoolId); const st = visitStats(v);
    return `<li><a class="list-row" href="#/visit/${v.id}">
      <div class="grow"><div class="title">${esc(s ? s.name : 'No school selected')}</div>
      <div class="meta">${fmtDate(v.date)}. ${esc(v.type)}. ${st.files} of ${st.planned || '?'} files started</div></div>
      <span class="badge">${v.status === 'complete' ? 'Complete' : 'In progress'}</span></a></li>`;
  }

  /* ---------- views: visit form ---------- */
  function visitForm(v) {
    const s = school(v.schoolId);
    const schools = store.schools.filter(x => x.active || x.id === v.schoolId);
    const grouped = COUNTIES.concat(['Other']).map(c => {
      const list = schools.filter(x => (COUNTIES.includes(x.county) ? x.county : 'Other') === c).sort((a, b) => a.name.localeCompare(b.name));
      return list.length ? `<optgroup label="${esc(c)}">${list.map(x => `<option value="${x.id}"${x.id === v.schoolId ? ' selected' : ''}>${esc(x.name)}${x.verified ? '' : ' (unverified)'}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const counts = [['files', 'Student files to review'], ['teachers', 'Teachers reviewed'], ['classrooms', 'Classrooms observed'], ['lessonPlans', 'Lesson plans reviewed'], ['consultLogs', 'Consultation logs reviewed'], ['serviceLogs', 'Service logs reviewed']];
    return `
      <div class="form-grid">
        <label class="field full">School
          <select data-bind="visit.schoolId" data-rerender><option value="">Choose a school</option>${grouped}</select></label>
        <label class="field">County<input type="text" readonly value="${esc(s ? s.county : '')}" aria-readonly="true"></label>
        <label class="field">District<input type="text" readonly value="${esc(s ? s.district : '')}" aria-readonly="true"></label>
        <label class="field">Visit date<input type="date" data-bind="visit.date" value="${esc(v.date)}"></label>
        <label class="field">Reviewer<input type="text" data-bind="visit.reviewer" value="${esc(v.reviewer)}" autocomplete="name"></label>
        <label class="field full">Visit type<select data-bind="visit.type">${options(VISIT_TYPES, v.type)}</select></label>
        <fieldset class="full"><legend>Review mode</legend><div class="seg">
          ${MODES.map(([k, l]) => `<label><input type="radio" name="mode-${v.id}" value="${k}" data-bind="visit.mode" data-rerender${v.mode === k ? ' checked' : ''}>${l}</label>`).join('')}
        </div></fieldset>
        <label class="field full">Visit purpose <span class="hint">Optional. Used in the report summary in Stage 3.</span>
          <textarea data-bind="visit.purpose" rows="2">${esc(v.purpose)}</textarea></label>
        ${counts.map(([k, l]) => `<label class="field">${l}<div class="stepper">
          <button type="button" data-act="step" data-for="counts.${k}" data-d="-1" aria-label="Decrease">−</button>
          <input type="number" inputmode="numeric" min="0" data-num data-bind="counts.${k}" value="${esc(v.counts[k])}">
          <button type="button" data-act="step" data-for="counts.${k}" data-d="1" aria-label="Increase">+</button></div></label>`).join('')}
      </div>`;
  }
  function viewNewVisit() {
    if (!store.draftVisit) { store.draftVisit = newVisit(); persist(true); }
    ctx.visit = store.draftVisit;
    return `
      <div class="page-head"><div><h1>New compliance visit</h1><p>Your entries save as you go. You can change any count later.</p></div></div>
      <section class="panel">${visitForm(ctx.visit)}
        <div class="row" style="margin-top:18px">
          <button class="btn primary" type="button" data-act="create-visit">Start visit</button>
          <button class="btn" type="button" data-act="discard-draft">Clear form</button>
        </div>
      </section>`;
  }

  /* ---------- views: visit hub ---------- */
  function viewVisit(v) {
    ctx.visit = v;
    const s = school(v.schoolId); const st = visitStats(v);
    const fnd = visitFindings(v);
    const ar = fnd.filter(x => x.st.rating === 'AR').sort((a, b) => (b.item.critical ? 1 : 0) - (a.item.critical ? 1 : 0));
    const incomplete = fnd.filter(x => { const i = findingIssues(x.fd); return i.need.length || i.fin.length; }).length;
    const wantsFiles = v.mode !== 'schoolwide';
    return `
      <div class="crumbs"><a href="#/">Dashboard</a></div>
      <div class="page-head">
        <div><h1>${esc(s ? s.name : 'Visit')}</h1>
        <p>${esc(s ? s.county + ' County' : '')}. ${fmtDate(v.date)}. ${esc(v.type)}. Reviewer: ${esc(v.reviewer || 'not set')}</p></div>
        ${wantsFiles ? `<button class="btn primary" type="button" data-act="add-file">Start student file ${v.files.length + 1}</button>` : ''}
      </div>
      ${v.filesHeldInMemory && !v.files.length ? `<div class="notice"><p>Student files for this visit were cleared when the app closed, because production mode does not store student data on this device.</p></div>` : ''}
      ${wantsFiles ? `
      <section class="panel"><h2>Student file review</h2>
        <div class="score-strip">
          <div><b>${pct(st.score)}</b><span>Student file score</span></div>
          <div><b>${st.files}<small class="muted"> / ${st.planned || '?'}</small></b><span>Files started</span></div>
          <div><b>${st.itemProgress}%</b><span>Checklist items addressed</span></div>
          <div><b>${st.notReviewed}</b><span>Items not reviewed</span></div>
        </div>
        <p class="disclaimer">Internal support indicator only. Not an official district compliance rating or funding determination. Not applicable and not reviewed items are excluded from the score${store.settings.excludeSystemFindings && st.excludedSystem ? `; ${st.excludedSystem} system-limitation finding${st.excludedSystem === 1 ? ' is' : 's are'} also excluded` : ''}.</p>
        ${v.files.length ? `<ul class="list">${v.files.map((f, i) => fileRow(v, f, i)).join('')}</ul>` : `<p class="empty">No files yet. Start file 1 to begin.</p>`}
      </section>
      <section class="panel"><h2>Action required findings</h2>
        ${ar.length ? `<ul class="list">${ar.map(x => `<li><a class="list-row" href="#/visit/${v.id}/file/${x.file.id}">
          <div class="grow"><div class="title">${esc(x.item.title)} ${x.item.critical ? '<span class="badge critical">Critical</span>' : ''}</div>
          <div class="meta">File ${x.fileNo}. ${esc(FIX[x.fd.fix])}. ${esc(x.fd.status)}</div></div></a></li>`).join('')}</ul>`
          : `<p class="empty">No action required findings recorded.</p>`}
        ${incomplete ? `<p class="small"><strong>${incomplete} finding${incomplete === 1 ? ' needs' : 's need'} more detail</strong> before the report can be finalized (description, evidence, action, owner, or target date).</p>` : ''}
      </section>` : ''}
      ${v.mode !== 'files' ? `<div class="notice"><p><strong>Schoolwide review is planned for Stage 2.</strong> The counts you entered for teachers, classrooms, and logs are saved with this visit.</p></div>` : ''}
      <details class="sec" id="editVisit"${ui.editOpen ? ' open' : ''}><summary><span class="sec-title">Edit visit details and counts</span></summary>
        <div class="sec-body">${visitForm(v)}</div></details>
      <div class="row" style="margin-top:10px"><button class="btn danger small" type="button" data-act="delete-visit">Delete this visit</button></div>`;
  }
  function fileRow(v, f, i) {
    const s = fileStats(f);
    const ev = (EVENTS.find(e => e[0] === f.event) || [])[1] || '';
    return `<li><a class="list-row" href="#/visit/${v.id}/file/${f.id}">
      <div class="grow"><div class="title">File ${i + 1}: ${esc(f.studentId || 'No student ID yet')}</div>
      <div class="meta">${esc(ev)}${f.grade ? ', grade ' + esc(f.grade) : ''}. ${s.addressed} of ${s.total} items addressed${s.AR ? `, ${s.AR} action required` : ''}${s.NI ? `, ${s.NI} needs improvement` : ''}</div>
      <div class="bar" style="margin-top:6px;max-width:260px"><i style="width:${s.progress}%"></i></div></div>
      <span class="badge">${pct(s.score)}</span></a></li>`;
  }

  /* ---------- views: file review ---------- */
  function viewFile(v, f) {
    ctx.visit = v; ctx.file = f;
    const idx = v.files.indexOf(f);
    const s = school(v.schoolId);
    const idErr = store.settings.demoMode && f.studentId && !isDemoId(f.studentId);
    return `
      <div class="crumbs"><a href="#/visit/${v.id}">${esc(s ? s.name : 'Visit')}</a></div>
      <div class="page-head"><div><h1>Student file ${idx + 1}${v.counts.files ? ` of ${v.counts.files}` : ''}</h1>
        <p>Identify the student by ID only. Do not enter names.</p></div></div>
      <details class="sec" ${f.studentId && !idErr ? '' : 'open'} id="fileDetails"><summary><span class="sec-title">File details</span><span class="sec-count" id="fileIdSummary">${esc(f.studentId || 'Student ID needed')}</span></summary>
        <div class="sec-body"><div class="form-grid">
          <label class="field">Student ID ${store.settings.demoMode ? '<span class="hint">Demo mode: must start with DEMO-</span>' : ''}
            <input type="text" data-bind="file.studentId" value="${esc(f.studentId)}" autocomplete="off" autocapitalize="characters" spellcheck="false">
            <span class="field-error" id="idError">${idErr ? 'Use a fictional ID that starts with DEMO-. Real IDs are not stored in demo mode.' : ''}</span></label>
          <label class="field">IEP event<select data-bind="file.event" data-checklist>${options(EVENTS, f.event)}</select></label>
          <label class="field">Grade<select data-bind="file.grade"><option value="">Choose</option>${options(GRADES, f.grade)}</select></label>
          <label class="field">Age <span class="hint">Drives transition and rights items</span>
            <input type="number" inputmode="numeric" min="3" max="22" data-bind="file.age" data-checklist value="${esc(f.age)}"></label>
          <label class="field">Annual review date<input type="date" data-bind="file.annualDate" data-dates value="${esc(f.annualDate)}"><span id="annualHint">${dateHint(f.annualDate, v.date, 'annual')}</span></label>
          <label class="field">Reevaluation due date<input type="date" data-bind="file.reevalDate" data-dates value="${esc(f.reevalDate)}"><span id="reevalHint">${dateHint(f.reevalDate, v.date, 'reeval')}</span></label>
          <label class="field">IEP effective start<input type="date" data-bind="file.iepStart" value="${esc(f.iepStart)}"></label>
          <label class="field">IEP effective end<input type="date" data-bind="file.iepEnd" value="${esc(f.iepEnd)}"></label>
          <fieldset class="full"><legend>On this IEP</legend>
            ${[['consult', 'Consultation services'], ['related', 'Related services'], ['altAssess', 'Alternate assessment participation'], ['agency', 'Outside agency likely to provide or pay for transition services'], ['rightsTransferred', 'Rights have transferred to the student (adult student)']]
              .map(([k, l]) => `<label class="check"><input type="checkbox" data-bind="flags.${k}" data-checklist${f.flags[k] ? ' checked' : ''}>${l}</label>`).join('')}
          </fieldset>
          <label class="field full">Service and assessment notes <span class="hint">No names or other identifying details</span>
            <textarea data-bind="file.serviceNotes" rows="2">${esc(f.serviceNotes)}</textarea></label>
        </div></div></details>
      <div id="checklist">${checklistHTML(f)}</div>
      <div class="sticky"><div class="sticky-inner">
        <button class="btn" type="button" data-act="prev-file"${idx === 0 ? ' disabled' : ''}>Previous</button>
        <div class="prog" id="fileProg">${progHTML(f)}</div>
        <button class="btn" type="button" data-act="save">Save</button>
        <button class="btn primary" type="button" data-act="next-file">${nextLabel(v, idx)}</button>
      </div></div>`;
  }
  function nextLabel(v, idx) {
    if (idx < v.files.length - 1) return 'Next file';
    if (v.files.length < (Number(v.counts.files) || 0)) return `Start file ${v.files.length + 1}`;
    return 'Finish files';
  }
  function dateHint(d, visitDate, kind) {
    if (!d || !visitDate) return '';
    const days = daysBetween(visitDate, d);
    if (kind === 'annual') {
      // Annual review date = date the current IEP was held; next one due within a year.
      const age = -days;
      if (age < 0) return `<span class="date-hint">Date is after the visit date. Check the entry.</span>`;
      if (age > 365) return `<span class="date-hint">More than one year before the visit date. Check A1.</span>`;
      return `<span class="date-hint ok">Next annual review due within ${365 - age} days</span>`;
    }
    if (days < 0) return `<span class="date-hint">Past due as of the visit date. Check A3.</span>`;
    return `<span class="date-hint ok">Due in ${days} days</span>`;
  }
  function progHTML(f) {
    const s = fileStats(f);
    return `<span>${s.addressed} of ${s.total} addressed. Score ${pct(s.score)}</span><div class="bar"><i style="width:${s.progress}%"></i></div>`;
  }
  function checklistHTML(f) {
    const shown = applicable(f);
    const hidden = R.items.filter(it => !shown.includes(it));
    const ageMissing = !String(f.age).trim();
    let html = '';
    if (f.flags.rightsTransferred) html += `<div class="notice"><p>Rights have transferred to this student. Notices, consent, and participation items apply to the adult student, not the parent, unless a verified exception applies.</p></div>`;
    R.sections.forEach(sec => {
      const items = shown.filter(it => it.section === sec.id);
      if (!items.length) return;
      html += `<details class="sec" data-sec="${sec.id}" ${ui.closedSecs && ui.closedSecs.has(f.id + sec.id) ? '' : 'open'}>
        <summary><span class="sec-letter" aria-hidden="true">${sec.id}</span><span class="sec-title">${esc(sec.title)}</span><span class="sec-count" id="sc-${sec.id}">${secCount(f, items)}</span></summary>
        <div class="sec-body">${items.map(it => itemHTML(f, it)).join('')}</div></details>`;
    });
    if (ageMissing) html += `<p class="small muted">Enter the student's age to show transition and transfer-of-rights items when they apply.</p>`;
    if (hidden.length) html += `<p class="small muted">Not shown for this file based on its details: ${hidden.map(h => esc(h.title)).join(', ')}.</p>`;
    return html;
  }
  function secCount(f, items) {
    let done = 0, ar = 0;
    items.forEach(it => { const r = f.items[it.id] && f.items[it.id].rating; if (r && r !== 'NR') done++; if (r === 'AR') ar++; });
    return `${done}/${items.length} rated${ar ? `, ${ar} action required` : ''}`;
  }
  function itemHTML(f, it) {
    const st = f.items[it.id] || { rating: '', evidence: [], history: [], notes: '', ref: '' };
    const r = st.rating;
    const open = ui.openItems.has(f.id + it.id);
    const btn = (k, minor) => `<button type="button" class="rbtn ${k}${minor ? ' minor' : ''}" data-act="rate" data-id="${it.id}" data-r="${k}" aria-pressed="${r === k}"><span class="sym" aria-hidden="true">${RATINGS[k].sym}</span>${RATINGS[k].label}</button>`;
    return `<article class="item r-${r || 'none'}" id="item-${it.id}">
      <div class="item-head"><div><h4>${esc(it.title)}</h4>${it.critical ? '<span class="badge critical">Critical</span>' : ''}</div>
        <button type="button" class="link" data-act="toggle-item" data-id="${it.id}" aria-expanded="${open}">${open ? 'Hide details' : 'What to verify'}</button></div>
      <div class="rate" role="group" aria-label="Rating">${['MC', 'NI', 'AR'].map(k => btn(k)).join('')}</div>
      <div class="rate-minor">${['NA', 'NR'].map(k => btn(k, true)).join('')}</div>
      ${open ? detailsHTML(f, it, st) : ''}
      ${isFindingRating(r) && st.finding ? findingHTML(it, st) : ''}
    </article>`;
  }
  function detailsHTML(f, it, st) {
    return `<div class="details">
      <dl><dt>Verify</dt><dd>${esc(it.verify)}</dd>
        <dt>Usually found</dt><dd>${esc(it.where)}</dd>
        <dt>Source</dt><dd>${esc(it.source)} <span class="${it.status === 'Verified' ? '' : 'status-pending'}">(${esc(it.status)})</span></dd>
        <dt>District reference</dt><dd>${it.district ? esc(it.district) : '<span class="muted">Not yet verified</span>'}</dd></dl>
      <fieldset><legend>Evidence checklist</legend>
        ${it.evidence.map((e, i) => `<label class="check"><input type="checkbox" data-bind="evidence.${it.id}.${i}"${st.evidence[i] ? ' checked' : ''}>${esc(e)}</label>`).join('')}
        <p class="small muted">Checks record what you looked at. They do not set the rating on their own.</p></fieldset>
      <div class="form-grid">
        <label class="field">Reviewer notes<textarea data-bind="item.${it.id}.notes" rows="2">${esc(st.notes)}</textarea></label>
        <label class="field">Evidence reference <span class="hint">Page, section, or log date</span><input type="text" data-bind="item.${it.id}.ref" value="${esc(st.ref)}"></label>
      </div>
      ${st.history && st.history.length ? `<details><summary class="small">Rating history (${st.history.length})</summary><ol class="history">${st.history.map(h => `<li>${esc(RATINGS[h.from] ? RATINGS[h.from].label : h.from)} to ${esc(RATINGS[h.to].label)}, ${new Date(h.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</li>`).join('')}</ol></details>` : ''}
    </div>`;
  }
  function findingHTML(it, st) {
    const fd = st.finding, iss = findingIssues(fd), b = `finding.${it.id}`;
    return `<div class="finding"><h5>Finding and corrective action</h5>
      <div class="form-grid">
        <label class="field full">Description of finding<textarea data-bind="${b}.description" rows="2">${esc(fd.description)}</textarea></label>
        <label class="field full">Evidence observed <span class="hint">Only what you saw in the documents</span><textarea data-bind="${b}.evidence" rows="2">${esc(fd.evidence)}</textarea></label>
        <label class="field full">Where the fix happens<select data-bind="${b}.fix">${options(Object.entries(FIX), fd.fix)}</select></label>
        <label class="field full">Recommended corrective action<textarea data-bind="${b}.action" rows="2">${esc(fd.action)}</textarea></label>
        <label class="field">Responsible staff<input type="text" data-bind="${b}.responsible" value="${esc(fd.responsible)}"></label>
        <label class="field">Target completion date<input type="date" data-bind="${b}.target" value="${esc(fd.target)}"></label>
        <label class="field">Priority<select data-bind="${b}.priority">${options(PRIORITIES, fd.priority)}</select></label>
        <label class="field">Status<select data-bind="${b}.status">${options(STATUSES.filter(x => x !== 'Resolved'), fd.status)}</select>
          <span class="hint">Resolved requires the verification step added in Stage 2.</span></label>
      </div>
      <p class="issues" id="iss-${it.id}">${issuesHTML(iss)}</p></div>`;
  }
  function issuesHTML(iss) {
    if (!iss.need.length && !iss.fin.length) return '<span class="muted">Ready for the report.</span>';
    return [iss.need.length ? `<span class="need">Required: ${iss.need.join(', ')}.</span>` : '', iss.fin.length ? `<span class="fin">Needed before finalizing: ${iss.fin.join(', ')}.</span>` : ''].join(' ');
  }
  function refreshItem(id) {
    const f = ctx.file, it = RULE[id];
    const el = document.getElementById('item-' + id);
    if (el) el.outerHTML = itemHTML(f, it);
    const items = applicable(f).filter(x => x.section === it.section);
    const sc = document.getElementById('sc-' + it.section); if (sc) sc.innerHTML = secCount(f, items);
    const pg = document.getElementById('fileProg'); if (pg) pg.innerHTML = progHTML(f);
  }

  /* ---------- views: hubs and lists ---------- */
  function viewFilesHub() {
    const open = store.visits.filter(v => v.status !== 'complete' && v.mode !== 'schoolwide').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return `<div class="page-head"><div><h1>Individual student file review</h1><p>File reviews belong to a visit. Continue one below or start a new visit.</p></div>
      <a class="btn primary" href="#/visit/new">Start a compliance visit</a></div>
      <section class="panel">${open.length ? `<ul class="list">${open.map(visitRow).join('')}</ul>` : '<p class="empty">No visits with file reviews in progress.</p>'}</section>`;
  }
  function viewVisits() {
    const all = store.visits.slice().sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="page-head"><div><h1>Previous visits</h1><p>Every visit saved on this device, newest first.</p></div></div>
      <section class="panel">${all.length ? `<ul class="list">${all.map(visitRow).join('')}</ul>` : '<p class="empty">No visits saved yet.</p>'}</section>`;
  }
  function viewPlanned(title, stage, what) {
    return `<div class="page-head"><div><h1>${esc(title)}</h1></div></div>
      <div class="notice"><p><strong>Not built yet. Planned for Stage ${stage}.</strong></p><p>${esc(what)}</p></div>`;
  }

  /* ---------- views: school directory ---------- */
  function viewSchools() {
    const q = ui.search.trim().toLowerCase();
    const list = store.schools.filter(s => (ui.showInactive || s.active) && (ui.schoolFilter === 'All' || s.county === ui.schoolFilter) && (!q || s.name.toLowerCase().includes(q)));
    const groups = COUNTIES.concat(['Other']);
    return `<div class="page-head"><div><h1>School directory</h1><p>Contacts come from the 2026–2027 Second Mile contact list. No emails were listed, so add them as you confirm them.</p></div>
      <div class="row"><button class="btn primary" type="button" data-act="add-school">Add school</button><a class="btn" href="#/schools/import">Import CSV</a></div></div>
      <section class="panel">
        <div class="form-grid" style="margin-bottom:12px">
          <label class="field">Search<input type="search" id="schoolSearch" value="${esc(ui.search)}" placeholder="School name"></label>
          <label class="field">County<select id="schoolFilter">${options(['All'].concat(COUNTIES), ui.schoolFilter)}</select></label>
        </div>
        <label class="check"><input type="checkbox" id="showInactive"${ui.showInactive ? ' checked' : ''}>Show deactivated schools</label>
        ${groups.map(c => {
          const g = list.filter(s => (COUNTIES.includes(s.county) ? s.county : 'Other') === c).sort((a, b) => a.name.localeCompare(b.name));
          if (!g.length) return '';
          return `<h3 style="margin-top:16px">${esc(c)}</h3><ul class="list">${g.map(s => {
            const open = openFindingsForSchool(s.id).length;
            return `<li><a class="list-row" href="#/school/${s.id}"><div class="grow"><div class="title">${esc(s.name || 'Unnamed school')}</div>
              <div class="meta">${esc(s.phone || 'No phone')}. ${esc((contact(s, 'ese') || {}).name || 'ESE contact not listed')}. ${open} open finding${open === 1 ? '' : 's'}</div></div>
              ${s.verified ? '' : '<span class="badge unverified">Unverified</span>'}${s.active ? '' : '<span class="badge inactive">Deactivated</span>'}</a></li>`;
          }).join('')}</ul>`;
        }).join('')}
      </section>`;
  }
  const openFindingsForSchool = id => allFindings().filter(x => x.visit.schoolId === id && x.fd.status !== 'Resolved');

  function viewSchool(s) {
    ctx.school = s;
    const visits = store.visits.filter(v => v.schoolId === s.id).sort((a, b) => b.date.localeCompare(a.date));
    const open = openFindingsForSchool(s.id);
    return `<div class="crumbs"><a href="#/schools">School directory</a></div>
      <div class="page-head"><div><h1>${esc(s.name || 'New school')}</h1>
        <p>${s.verified ? 'Profile verified' : 'Profile unverified'}${s.active ? '' : '. Deactivated'}</p></div></div>
      <section class="panel"><h2>School profile</h2><div class="form-grid">
        <label class="field full">School name<input type="text" data-bind="school.name" value="${esc(s.name)}"></label>
        <label class="field">County<select data-bind="school.county" data-county><option value="">Choose</option>${options(COUNTIES, s.county)}</select></label>
        <label class="field">District<input type="text" data-bind="school.district" value="${esc(s.district)}"></label>
        <label class="field full">Address<input type="text" data-bind="school.address" value="${esc(s.address)}" autocomplete="off"></label>
        <label class="field">Phone<input type="tel" data-bind="school.phone" value="${esc(s.phone)}"></label>
        <label class="field">District documentation system<input type="text" data-bind="school.system" value="${esc(s.system)}"></label>
        <label class="field full">Checklist version<input type="text" data-bind="school.checklist" value="${esc(s.checklist)}"></label>
        <label class="field full">Staff directory web page<input type="text" inputmode="url" data-bind="school.url" value="${esc(s.url || '')}">${s.url ? `<a class="small" href="${esc(s.url)}" target="_blank" rel="noopener">Open staff directory</a>` : ''}</label>
        <label class="field full">Notes<textarea data-bind="school.notes" rows="3">${esc(s.notes || '')}</textarea></label>
        <label class="check full"><input type="checkbox" data-bind="school.verified"${s.verified ? ' checked' : ''}>This school is on the current Second Mile roster</label>
      </div></section>
      <section class="panel"><h2>Contacts</h2>
        ${s.contacts.map((c, i) => {
          const fixed = ROLES.find(r => r[0] === c.role);
          return `<fieldset style="margin-bottom:14px"><legend>${fixed ? fixed[1] : 'Additional contact'}</legend><div class="form-grid">
            ${c.role === 'principal' || c.role === 'ap' ? '' : `<label class="field full">${fixed ? 'Title' : 'Role or title'}<input type="text" data-bind="contact.${i}.title" value="${esc(c.title)}"></label>`}
            <label class="field">Name<input type="text" data-bind="contact.${i}.name" value="${esc(c.name)}" autocomplete="off"></label>
            <label class="field">Email<input type="email" data-bind="contact.${i}.email" value="${esc(c.email)}" autocomplete="off"></label>
          </div>${fixed ? '' : `<button class="link" type="button" data-act="remove-contact" data-i="${i}">Remove this contact</button>`}</fieldset>`;
        }).join('')}
        <button class="btn small" type="button" data-act="add-contact">Add contact</button>
      </section>
      <section class="panel"><h2>Visit history</h2>${visits.length ? `<ul class="list">${visits.map(visitRow).join('')}</ul>` : '<p class="empty">No visits yet.</p>'}</section>
      <section class="panel"><h2>Open corrective actions</h2>${open.length ? `<ul class="list">${open.map(x => `<li><a class="list-row" href="#/visit/${x.visit.id}/file/${x.file.id}"><div class="grow"><div class="title">${esc(x.item.title)}</div><div class="meta">${fmtDate(x.visit.date)} visit, file ${x.fileNo}. ${esc(x.fd.status)}. Target ${fmtDate(x.fd.target)}</div></div></a></li>`).join('')}</ul>` : '<p class="empty">No open corrective actions.</p>'}</section>
      <div class="row"><button class="btn${s.active ? ' danger' : ''}" type="button" data-act="toggle-active">${s.active ? 'Deactivate school' : 'Reactivate school'}</button></div>`;
  }

  /* ---------- CSV import ---------- */
  const CSV_COLS = ['name', 'county', 'district', 'address', 'phone', 'district_system', 'checklist_version', 'principal_name', 'principal_email', 'ap_name', 'ap_email', 'ese_lead_name', 'ese_lead_email'];
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  function prepareImport(text) {
    const rows = parseCSV(text.replace(/^\uFEFF/, ''));
    if (rows.length < 2) return { error: 'Add a header row and at least one school row.' };
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    if (!head.includes('name') || !head.includes('county')) return { error: 'The header row needs at least "name" and "county" columns.' };
    return {
      rows: rows.slice(1).map(r => {
        const o = {}; head.forEach((h, i) => (o[h] = (r[i] || '').trim()));
        const county = COUNTIES.find(c => c.toLowerCase() === o.county.toLowerCase().replace(/\s*county$/, ''));
        let problem = '';
        if (!o.name) problem = 'Missing school name';
        else if (!county) problem = `County "${o.county}" is not one of the supported counties`;
        else if (store.schools.some(s => s.name.toLowerCase() === o.name.toLowerCase() && s.county === county)) problem = 'Already in the directory';
        return { o, county, problem };
      })
    };
  }
  function viewImport() {
    const p = ui.importRows;
    return `<div class="crumbs"><a href="#/schools">School directory</a></div>
      <div class="page-head"><div><h1>Import schools from CSV</h1><p>Imported schools are marked unverified. For Excel files, save as CSV first.</p></div></div>
      <section class="panel"><h2>Columns</h2>
        <p class="small">Required: <strong>name</strong>, <strong>county</strong> (Miami-Dade, Lee, Hillsborough, or Palm Beach). Optional: ${CSV_COLS.slice(2).join(', ')}.</p>
        <label class="field">Template <span class="hint">Copy this header row into your spreadsheet</span><textarea readonly rows="2">${CSV_COLS.join(',')}</textarea></label>
      </section>
      <section class="panel"><h2>Add your file</h2>
        <label class="field">Choose a CSV file<input type="file" id="csvFile" accept=".csv,text/csv"></label>
        <label class="field" style="margin-top:12px">Or paste CSV text<textarea id="csvText" rows="5"></textarea></label>
        <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="preview-import">Preview import</button></div>
      </section>
      ${p ? (p.error ? `<div class="notice"><p>${esc(p.error)}</p></div>` : `
      <section class="panel"><h2>Preview</h2><div class="table-wrap"><table><thead><tr><th>School</th><th>County</th><th>Result</th></tr></thead><tbody>
        ${p.rows.map(r => `<tr><td>${esc(r.o.name)}</td><td>${esc(r.o.county)}</td><td>${r.problem ? `<span class="field-error">Skipped: ${esc(r.problem)}</span>` : 'Will import as unverified'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" data-act="run-import"${p.rows.some(r => !r.problem) ? '' : ' disabled'}>Import ${p.rows.filter(r => !r.problem).length} school(s)</button></div></section>`) : ''}`;
  }

  /* ---------- views: settings ---------- */
  function viewSettings() {
    const st = store.settings;
    return `<div class="page-head"><div><h1>Settings and checklists</h1><p>Checklist editing and full scoring controls arrive in Stage 4.</p></div></div>
      <section class="panel"><h2>Reviewer</h2>
        <label class="field">Default reviewer name<input type="text" data-bind="settings.reviewerName" value="${esc(st.reviewerName)}" autocomplete="name"></label></section>
      <section class="panel"><h2>Data mode</h2>
        <label class="check"><input type="checkbox" id="demoMode"${st.demoMode ? ' checked' : ''}>Demo mode (fictional DEMO- student IDs, saved on this device)</label>
        <p class="small muted">Turning demo mode off stops student-level data from being saved on this device. Real student records need an organization-approved secure backend first.</p></section>
      <section class="panel"><h2>Scoring</h2>
        <div class="form-grid">
          ${['MC', 'NI', 'AR'].map(k => `<label class="field">${RATINGS[k].label} value<input type="number" min="0" max="100" data-num data-bind="ratingValues.${k}" value="${esc(st.ratingValues[k])}"></label>`).join('')}
          <label class="field">Transition items start at age<input type="number" min="12" max="18" data-num data-bind="settings.transitionStartAge" value="${esc(st.transitionStartAge)}"><span class="hint">Pending verification against current Florida rule</span></label>
        </div>
        <label class="check"><input type="checkbox" data-bind="settings.excludeSystemFindings"${st.excludeSystemFindings ? ' checked' : ''}>Leave system-limitation findings out of scores (never held against staff)</label></section>
      <section class="panel"><h2>Checklist rules (version ${esc(R.version)})</h2>
        <p class="small">Every citation is marked Pending Verification until confirmed against the authoritative source. Nothing here is treated as a verified requirement yet.</p>
        <div class="table-wrap"><table><thead><tr><th>Item</th><th>Source</th><th>Status</th></tr></thead><tbody>
          ${R.items.map(it => `<tr><td>${it.id}. ${esc(it.title)}</td><td>${esc(it.source)}</td><td class="status-pending">${esc(it.status)}</td></tr>`).join('')}
        </tbody></table></div></section>
      <section class="panel"><h2>Device data</h2>
        <div class="row"><button class="btn" type="button" data-act="copy-backup">Copy backup to clipboard</button>
        <button class="btn danger" type="button" data-act="reset-all">Erase everything and reload demo data</button></div></section>`;
  }

  /* ---------- events ---------- */
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }

  function onField(t) {
    const parts = t.dataset.bind.split('.');
    const scope = parts[0];
    let obj, key;
    if (scope === 'visit') { obj = ctx.visit; key = parts[1]; }
    else if (scope === 'counts') { obj = ctx.visit.counts; key = parts[1]; }
    else if (scope === 'file') { obj = ctx.file; key = parts[1]; }
    else if (scope === 'flags') { obj = ctx.file.flags; key = parts[1]; }
    else if (scope === 'item') { obj = itemState(ctx.file, parts[1]); key = parts[2]; }
    else if (scope === 'evidence') { obj = itemState(ctx.file, parts[1]).evidence; key = Number(parts[2]); }
    else if (scope === 'finding') { obj = itemState(ctx.file, parts[1]).finding; key = parts[2]; }
    else if (scope === 'school') { obj = ctx.school; key = parts[1]; }
    else if (scope === 'contact') { obj = ctx.school.contacts[Number(parts[1])]; key = parts[2]; }
    else if (scope === 'settings') { obj = store.settings; key = parts[1]; }
    else if (scope === 'ratingValues') { obj = store.settings.ratingValues; key = parts[1]; }
    if (!obj) return;
    let val = t.type === 'checkbox' ? t.checked : t.type === 'radio' ? (t.checked ? t.value : obj[key]) : t.value;
    if ('num' in t.dataset) val = val === '' ? '' : Math.max(0, parseInt(val, 10) || 0);

    if (scope === 'file' && key === 'studentId') {
      val = val.trim();
      const bad = store.settings.demoMode && val && !isDemoId(val);
      $('#idError').textContent = bad ? 'Use a fictional ID that starts with DEMO-. Real IDs are not stored in demo mode.' : '';
      if (bad) { obj.studentId = ''; touch(); return; }
      $('#fileIdSummary').textContent = val || 'Student ID needed';
    }
    if (scope === 'finding') {
      if (key === 'description') obj.autoDesc = false;
      if (key === 'evidence') obj.autoEvid = false;
      if (key === 'action') obj.autoAction = false;
      if (key === 'fix' && obj.autoAction) obj.action = FIX_ACTION[val];
    }
    obj[key] = val;
    touch();

    // targeted refreshes
    if (scope === 'finding') {
      if (key === 'fix') { refreshItem(parts[1]); refreshCounts(); }
      else { const el = document.getElementById('iss-' + parts[1]); if (el) el.innerHTML = issuesHTML(findingIssues(obj)); }
    }
    if (scope === 'evidence') {
      const st = itemState(ctx.file, parts[1]);
      if (st.finding && st.finding.autoEvid) { st.finding.evidence = autoEvidence(RULE[parts[1]], st); const ta = document.querySelector(`[data-bind="finding.${parts[1]}.evidence"]`); if (ta) ta.value = st.finding.evidence; }
    }
    if ('checklist' in t.dataset) { const c = $('#checklist'); if (c) c.innerHTML = checklistHTML(ctx.file); refreshCounts(); }
    if ('dates' in t.dataset) { $('#annualHint').innerHTML = dateHint(ctx.file.annualDate, ctx.visit.date, 'annual'); $('#reevalHint').innerHTML = dateHint(ctx.file.reevalDate, ctx.visit.date, 'reeval'); }
    if ('rerender' in t.dataset) rerender();
    if ('county' in t.dataset) { const d = COUNTY_DEFAULTS[val]; if (d) { ctx.school.district = d.district; if (!ctx.school.system || Object.values(COUNTY_DEFAULTS).some(x => x.system === ctx.school.system)) ctx.school.system = d.system; } rerender(); }
  }
  function refreshCounts() { const pg = document.getElementById('fileProg'); if (pg && ctx.file) pg.innerHTML = progHTML(ctx.file); }

  const actions = {
    'nav-toggle': (el) => { const n = $('#nav'); const o = n.classList.toggle('open'); el.setAttribute('aria-expanded', String(o)); },
    'step': (el) => { const inp = document.querySelector(`[data-bind="${el.dataset.for}"]`); if (!inp) return; inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) + Number(el.dataset.d)); onField(inp); },
    'create-visit': () => {
      const v = store.draftVisit;
      if (!v.schoolId) { toast('Choose a school to start the visit.'); return; }
      if (!v.date) { toast('Add the visit date.'); return; }
      v.demo = store.settings.demoMode; v.updatedAt = new Date().toISOString();
      store.visits.push(v); store.draftVisit = null; persist();
      location.hash = '#/visit/' + v.id;
    },
    'discard-draft': () => { store.draftVisit = null; persist(); rerender(); },
    'add-file': () => { const f = newFile(); ctx.visit.files.push(f); touch(); location.hash = `#/visit/${ctx.visit.id}/file/${f.id}`; },
    'delete-visit': () => {
      if (!confirm('Delete this visit and all of its file reviews? This cannot be undone.')) return;
      store.visits = store.visits.filter(v => v !== ctx.visit); persist(); location.hash = '#/';
    },
    'rate': (el) => {
      const id = el.dataset.id, r = el.dataset.r;
      rate(ctx.file, id, r);
      if (isFindingRating(r)) ui.openItems.add(ctx.file.id + id);
      refreshItem(id);
      const btn = document.querySelector(`#item-${id} [data-r="${r}"]`); if (btn) btn.focus();
    },
    'toggle-item': (el) => { const k = ctx.file.id + el.dataset.id; ui.openItems.has(k) ? ui.openItems.delete(k) : ui.openItems.add(k); refreshItem(el.dataset.id); const b = document.querySelector(`#item-${el.dataset.id} [data-act="toggle-item"]`); if (b) b.focus(); },
    'save': () => { clearTimeout(saveTimer); persist(); toast('Saved'); },
    'prev-file': () => { const v = ctx.visit, i = v.files.indexOf(ctx.file); if (i > 0) location.hash = `#/visit/${v.id}/file/${v.files[i - 1].id}`; },
    'next-file': () => {
      const v = ctx.visit, i = v.files.indexOf(ctx.file);
      clearTimeout(saveTimer); persist();
      if (i < v.files.length - 1) location.hash = `#/visit/${v.id}/file/${v.files[i + 1].id}`;
      else if (v.files.length < (Number(v.counts.files) || 0)) actions['add-file']();
      else location.hash = '#/visit/' + v.id;
    },
    'add-school': () => { const s = newSchool(); store.schools.push(s); persist(); location.hash = '#/school/' + s.id; },
    'add-contact': () => { ctx.school.contacts.push({ role: 'other', title: '', name: '', email: '' }); persist(); rerender(); },
    'remove-contact': (el) => { ctx.school.contacts.splice(Number(el.dataset.i), 1); persist(); rerender(); },
    'toggle-active': () => { ctx.school.active = !ctx.school.active; persist(); toast(ctx.school.active ? 'School reactivated' : 'School deactivated'); rerender(); },
    'preview-import': async () => {
      const file = $('#csvFile').files[0];
      const text = file ? await file.text() : $('#csvText').value;
      ui.importRows = text.trim() ? prepareImport(text) : { error: 'Choose a CSV file or paste CSV text first.' };
      rerender();
    },
    'run-import': () => {
      const rows = (ui.importRows.rows || []).filter(r => !r.problem);
      rows.forEach(({ o, county }) => {
        const s = newSchool({ name: o.name, county, district: o.district, address: o.address, phone: o.phone, system: o.district_system, checklist: o.checklist_version });
        const set = (role, n, e) => { const c = contact(s, role); c.name = n || ''; c.email = e || ''; };
        set('principal', o.principal_name, o.principal_email); set('ap', o.ap_name, o.ap_email); set('ese', o.ese_lead_name, o.ese_lead_email);
        store.schools.push(s);
      });
      ui.importRows = null; persist(); toast(`Imported ${rows.length} school(s) as unverified`); location.hash = '#/schools';
    },
    'copy-backup': async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(store, null, 2)); toast('Backup copied. Paste it somewhere secure.'); }
      catch (e) { toast('Copy was blocked by the browser.'); }
    },
    'reset-all': () => {
      if (!confirm('Erase all schools, visits, and settings on this device and reload the demo data?')) return;
      store = defaults(); applyRoster(); seedDemoVisit(); persist(); location.hash = '#/'; rerender();
    }
  };

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a && actions[a.dataset.act]) { e.preventDefault(); actions[a.dataset.act](a, e); return; }
    if (!e.target.closest('#nav') && !e.target.closest('.menu-btn')) closeNav();
  });
  document.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.bind && t.type !== 'checkbox' && t.type !== 'radio' && t.tagName !== 'SELECT') onField(t); });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.bind && (t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT')) onField(t);
    if (t.id === 'schoolFilter') { ui.schoolFilter = t.value; rerender(); }
    if (t.id === 'showInactive') { ui.showInactive = t.checked; rerender(); }
    if (t.id === 'demoMode') {
      if (t.checked) {
        const real = store.visits.some(v => v.files.some(f => f.studentId && !isDemoId(f.studentId)));
        if (real) { t.checked = false; toast('Remove non-demo student IDs before turning demo mode back on.'); return; }
      } else if (!confirm('Turn off demo mode? Student-level data will no longer be saved on this device, including the demo files.')) { t.checked = true; return; }
      store.settings.demoMode = t.checked; persist(); renderBanner();
    }
  });
  document.addEventListener('input', e => { if (e.target.id === 'schoolSearch') { ui.search = e.target.value; const pos = e.target.selectionStart; rerender(); const s = $('#schoolSearch'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } });
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (d.id === 'editVisit') { ui.editOpen = d.open; return; }
    if (!d.dataset || !d.dataset.sec || !ctx.file) return;
    ui.closedSecs = ui.closedSecs || new Set();
    d.open ? ui.closedSecs.delete(ctx.file.id + d.dataset.sec) : ui.closedSecs.add(ctx.file.id + d.dataset.sec);
  }, true);
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); persist(true); });

  /* ---------- start ---------- */
  load();
  route();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  // Exposed for automated tests only.
  window.__SM = { get store() { return store; }, fileStats, visitStats, applicable, parseCSV, prepareImport };
})();
