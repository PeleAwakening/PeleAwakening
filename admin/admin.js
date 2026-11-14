/* ============================================
   PELE AWAKENING — Admin dashboard
   Every query runs as the signed-in user; Row Level Security returns data
   only to accounts listed in public.admins.
   ============================================ */
(function () {
  'use strict';

  var cfg = window.PA_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    document.getElementById('setupMsg').hidden = false;
    return;
  }

  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  var TZ = 'Pacific/Honolulu';
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var content = document.getElementById('tabContent');
  var lookups = { classes: [], instructors: [], locations: [], prices: [] };
  var currentTab = 'bookings';

  // ---- Small DOM helpers (text is always set via textContent) ----
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }

  var toastTimer;
  function toast(msg, isError) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'admin-toast' + (isError ? ' is-error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 6000 : 2500);
  }
  function fail(err) { toast((err && err.message) || String(err), true); }

  function fmt(date, opts) {
    return date ? new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ }, opts)).format(new Date(date)) : '';
  }
  function fmtDateTime(d) { return fmt(d, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function fmtTime(d) { return fmt(d, { hour: 'numeric', minute: '2-digit' }); }
  function money(cents) { return cents == null ? '' : '$' + (cents / 100).toFixed(2); }
  function hawaiiToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
  // Hawaii is UTC-10 year-round (no daylight saving).
  function hawaiiIso(date, time) { return date + 'T' + time + ':00-10:00'; }

  // Two-click confirm without browser dialogs.
  function confirmButton(label, cls, onConfirm) {
    var armed = false;
    var btn = h('button', { type: 'button', class: 'admin-btn admin-btn--sm ' + (cls || 'admin-btn--danger'), text: label });
    btn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        btn.textContent = 'Confirm?';
        setTimeout(function () { armed = false; btn.textContent = label; }, 4000);
        return;
      }
      btn.disabled = true;
      Promise.resolve(onConfirm()).finally(function () { btn.disabled = false; });
    });
    return btn;
  }

  // ---- Auth ----
  var loginView = document.getElementById('loginView');
  var appView = document.getElementById('appView');

  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = document.getElementById('loginMsg');
    sb.auth.signInWithOtp({
      email: document.getElementById('loginEmail').value.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + '/admin/' }
    }).then(function () {
      // Same message either way, so the form does not reveal which emails are admins.
      msg.textContent = 'If that email belongs to an admin, a sign-in link is on its way.';
    });
  });
  document.getElementById('signOut').addEventListener('click', function () {
    sb.auth.signOut().then(function () { location.reload(); });
  });

  function showLogin() {
    loginView.hidden = false;
    appView.hidden = true;
    document.getElementById('adminUser').hidden = true;
  }

  function start(session) {
    if (!session) return showLogin();
    sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle().then(function (res) {
      if (!res.data) {
        showLogin();
        document.getElementById('loginMsg').textContent = 'This account does not have admin access.';
        sb.auth.signOut();
        return;
      }
      loginView.hidden = true;
      appView.hidden = false;
      document.getElementById('adminUser').hidden = false;
      document.getElementById('adminEmail').textContent = session.user.email;
      loadLookups().then(function () { showTab(currentTab); });
    });
  }

  var started = false;
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_OUT') return showLogin();
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && !started) {
      started = Boolean(session);
      start(session);
    }
  });

  function loadLookups() {
    return Promise.all([
      sb.from('class_types').select('id, name, slug, active').order('sort_order'),
      sb.from('instructors').select('id, name').order('name'),
      sb.from('locations').select('id, name').order('name'),
      sb.from('price_options').select('id, class_type_id, label, kind, amount_cents, active').order('sort_order')
    ]).then(function (r) {
      lookups.classes = r[0].data || [];
      lookups.instructors = r[1].data || [];
      lookups.locations = r[2].data || [];
      lookups.prices = r[3].data || [];
    });
  }
  function opts(list, labelKey) {
    return function () { return list().map(function (x) { return [x.id, x[labelKey || 'name']]; }); };
  }
  function className(id) {
    var c = lookups.classes.find(function (x) { return x.id === id; });
    return c ? c.name : '';
  }

  // ---- Tabs ----
  document.getElementById('adminTabs').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tab]');
    if (btn) showTab(btn.dataset.tab);
  });
  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#adminTabs [data-tab]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.tab === tab);
    });
    content.innerHTML = '';
    TABS[tab]();
  }

  // ---- Generic editable table ----
  // spec: { table, select, order: [[col, asc]], filter(q), columns: [{ key, label, type, options(), format(row), nullable }],
  //         defaults, canAdd, canDelete, beforeSave(values, row), afterSave() }
  function crud(container, spec) {
    var wrap = h('div', { class: 'admin-table-wrap' });
    container.appendChild(wrap);

    function load() {
      var q = sb.from(spec.table).select(spec.select || '*');
      if (spec.filter) q = spec.filter(q);
      (spec.order || []).forEach(function (o) { q = q.order(o[0], { ascending: o[1] !== false }); });
      return q.then(function (res) {
        if (res.error) return fail(res.error);
        render(res.data || []);
      });
    }

    function field(col, row) {
      var v = row[col.key];
      switch (col.type) {
        case 'readonly': return h('span', { text: col.format ? col.format(row) : (v == null ? '' : String(v)) });
        case 'bool': return h('input', { type: 'checkbox', checked: Boolean(v) });
        case 'select':
          return h('select', null, (col.nullable ? [h('option', { value: '', text: '—' })] : []).concat(
            col.options().map(function (o) { return h('option', { value: o[0], text: o[1], selected: String(o[0]) === String(v) }); })));
        case 'textarea': return h('textarea', { value: v == null ? '' : v });
        case 'money': return h('input', { type: 'number', step: '0.01', min: '0', value: v == null ? '' : (v / 100).toFixed(2) });
        case 'number': return h('input', { type: 'number', step: '1', value: v == null ? '' : v });
        case 'time': return h('input', { type: 'time', value: v ? String(v).slice(0, 5) : '' });
        case 'date': return h('input', { type: 'date', value: v || '' });
        default: return h('input', { type: col.type || 'text', value: v == null ? '' : v });
      }
    }

    function read(col, el) {
      if (col.type === 'bool') return el.checked;
      var raw = el.value.trim();
      if (raw === '') return col.type === 'text' || !col.type ? (col.nullable === false ? '' : null) : null;
      if (col.type === 'money') return Math.round(parseFloat(raw) * 100);
      if (col.type === 'number') return parseInt(raw, 10);
      if (col.type === 'select' && /^\d+$/.test(raw) && col.numeric) return parseInt(raw, 10);
      return raw;
    }

    function rowEl(row, isNew) {
      var inputs = {};
      var tr = h('tr', { class: isNew ? 'is-new' : (row.active === false || row.status === 'cancelled' ? 'is-muted' : null) });
      spec.columns.forEach(function (col) {
        var el = field(col, row);
        if (col.type !== 'readonly') inputs[col.key] = el;
        tr.appendChild(h('td', null, isNew && col.type === 'readonly' ? '' : el));
      });

      function values() {
        var out = {};
        spec.columns.forEach(function (col) { if (inputs[col.key]) out[col.key] = read(col, inputs[col.key]); });
        return spec.beforeSave ? spec.beforeSave(out, row, isNew) : out;
      }

      var actions = h('td', { class: 'actions' });
      if (isNew) {
        actions.appendChild(h('button', { type: 'button', class: 'admin-btn admin-btn--sm', text: 'Add', onclick: function () {
          sb.from(spec.table).insert(values()).then(done('Added'));
        } }));
      } else {
        actions.appendChild(h('button', { type: 'button', class: 'admin-btn admin-btn--sm', text: 'Save', onclick: function () {
          sb.from(spec.table).update(values()).eq('id', row.id).then(done('Saved'));
        } }));
        if (spec.canDelete) {
          actions.appendChild(confirmButton('Delete', null, function () {
            return sb.from(spec.table).delete().eq('id', row.id).then(done('Deleted'));
          }));
        }
      }
      tr.appendChild(actions);
      return tr;
    }

    function done(msg) {
      return function (res) {
        if (res.error) return fail(res.error);
        toast(msg);
        (spec.afterSave ? Promise.resolve(spec.afterSave()) : Promise.resolve()).then(load);
      };
    }

    function render(rows) {
      var thead = h('thead', null, h('tr', null, spec.columns.map(function (c) { return h('th', { text: c.label }); }), h('th')));
      var tbody = h('tbody', null, rows.map(function (r) { return rowEl(r, false); }));
      if (spec.canAdd) tbody.appendChild(rowEl(Object.assign({}, spec.defaults || {}), true));
      wrap.innerHTML = '';
      wrap.appendChild(h('table', { class: 'admin-table' }, thead, tbody));
    }

    load();
    return { reload: load };
  }

  function section(title, hint) {
    content.appendChild(h('h2', { text: title }));
    if (hint) content.appendChild(h('p', { class: 'hint', text: hint }));
    var box = h('div');
    content.appendChild(box);
    return box;
  }

  function paymentPill(b) {
    var p = (b.payments || []).find(function (x) { return x.kind !== 'tip'; });
    if (b.payment_mode === 'free') return h('span', { class: 'pill', text: 'Free' });
    if (b.payment_mode === 'in_person') return h('span', { class: 'pill pill--warn', text: 'Pay at class ' + money(b.total_amount_cents) });
    if (!p) return h('span', { class: 'pill', text: b.payment_mode });
    var cls = p.status === 'paid' ? 'pill--ok' : p.status === 'refunded' ? 'pill--bad' : 'pill--warn';
    return h('span', { class: 'pill ' + cls, text: (p.provider === 'cash' ? 'Cash ' : '') + p.status + ' ' + money(p.amount_cents) });
  }

  function statusPill(status) {
    var cls = { confirmed: 'pill--ok', pending: 'pill--warn', cancelled: 'pill--bad', expired: 'pill--bad' }[status] || '';
    return h('span', { class: 'pill ' + cls, text: status });
  }

  // ============================================
  var TABS = {};

  // ---- Bookings: upcoming sessions with rosters ----
  TABS.bookings = function () {
    var range = h('select', { class: 'form-select' },
      h('option', { value: 'upcoming', text: 'Next 14 days' }),
      h('option', { value: 'today', text: 'Today' }),
      h('option', { value: 'past', text: 'Past 14 days' }));
    var list = h('div');
    content.appendChild(h('div', { class: 'admin-toolbar' }, range,
      h('button', { type: 'button', class: 'admin-btn admin-btn--ghost', text: 'Refresh', onclick: load })));
    content.appendChild(list);
    range.addEventListener('change', load);

    function load() {
      var now = new Date();
      var from = new Date(now.getTime() - 3 * 3600e3), to = new Date(now.getTime() + 14 * 86400e3);
      if (range.value === 'today') { from = new Date(hawaiiIso(hawaiiToday(), '00:00')); to = new Date(from.getTime() + 86400e3); }
      if (range.value === 'past') { from = new Date(now.getTime() - 14 * 86400e3); to = now; }
      list.textContent = 'Loading…';
      sb.from('class_sessions')
        .select('id, starts_at, ends_at, capacity, status, note, class_type_id, class_types(name), ' +
          'bookings(id, party_size, status, payment_mode, source, checked_in_at, attended_count, total_amount_cents, created_at, ' +
          'customers(name, email, phone, preferred_contact), price_options(label), payments(status, provider, kind, amount_cents))')
        .gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString())
        .order('starts_at', { ascending: range.value !== 'past' })
        .then(function (res) {
          if (res.error) return fail(res.error);
          list.innerHTML = '';
          if (!res.data.length) list.appendChild(h('p', { class: 'hint', text: 'No sessions in this range. Generate them from the Schedule tab.' }));
          res.data.forEach(function (s) { list.appendChild(sessionEl(s)); });
        });
    }

    function sessionEl(s) {
      var active = s.bookings.filter(function (b) { return b.status === 'confirmed' || b.status === 'pending'; });
      var booked = active.reduce(function (n, b) { return n + b.party_size; }, 0);
      var details = h('details', { class: 'admin-session' + (s.status === 'cancelled' ? ' is-cancelled' : '') },
        h('summary', null,
          h('span', { class: 'admin-session-when', text: fmtDateTime(s.starts_at) + '–' + fmtTime(s.ends_at) }),
          h('span', { class: 'admin-session-name', text: s.class_types.name + (s.status === 'cancelled' ? ' (cancelled)' : '') }),
          h('span', { class: 'admin-session-count' + (booked >= s.capacity ? ' is-full' : ''), text: booked + ' / ' + s.capacity + ' booked' })));
      var body = h('div', { class: 'admin-session-body' });
      details.appendChild(body);

      var rows = s.bookings.slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).map(function (b) {
        var c = b.customers || {};
        var checkIn = b.checked_in_at
          ? h('button', { type: 'button', class: 'admin-btn admin-btn--sm admin-btn--ghost', text: '✓ ' + (b.attended_count || b.party_size) + ' here', onclick: function () {
              sb.from('bookings').update({ checked_in_at: null, attended_count: null }).eq('id', b.id).then(after);
            } })
          : h('button', { type: 'button', class: 'admin-btn admin-btn--sm', text: 'Check in', disabled: b.status !== 'confirmed', onclick: function () {
              sb.from('bookings').update({ checked_in_at: new Date().toISOString(), attended_count: b.party_size }).eq('id', b.id).then(after);
            } });
        return h('tr', { class: b.status === 'confirmed' || b.status === 'pending' ? null : 'is-muted' },
          h('td', { text: c.name || '' }),
          h('td', null, c.email ? h('a', { href: 'mailto:' + c.email, text: c.email }) : '', c.phone ? h('div', { text: c.phone }) : ''),
          h('td', { text: String(b.party_size) }),
          h('td', { text: (b.price_options && b.price_options.label) || b.source }),
          h('td', null, paymentPill(b)),
          h('td', null, statusPill(b.status)),
          h('td', { class: 'actions' }, checkIn,
            b.status === 'confirmed' || b.status === 'pending'
              ? confirmButton('Cancel', null, function () {
                  return sb.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', b.id).then(after);
                })
              : ''));
      });
      body.appendChild(h('div', { class: 'admin-table-wrap' }, h('table', { class: 'admin-table' },
        h('thead', null, h('tr', null, ['Name', 'Contact', 'People', 'Option', 'Payment', 'Status', ''].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: '7', text: 'No bookings yet.' }))))));

      if (s.status === 'scheduled') body.appendChild(walkInForm(s));
      return details;

      function after(res) {
        if (res.error) return fail(res.error);
        toast('Updated');
        load();
      }
    }

    function walkInForm(s) {
      var name = h('input', { type: 'text', required: true });
      var email = h('input', { type: 'email', placeholder: 'optional' });
      var phone = h('input', { type: 'tel', placeholder: 'optional' });
      var party = h('input', { type: 'number', min: '1', value: '1' });
      var option = h('select', null, h('option', { value: '', text: '—' }), lookups.prices
        .filter(function (p) { return p.class_type_id === s.class_type_id && p.active; })
        .map(function (p) { return h('option', { value: p.id, text: p.label + ' (' + money(p.amount_cents) + ')' }); }));
      var cash = h('input', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' });
      var btn = h('button', { type: 'button', class: 'admin-btn', text: 'Add walk-in' });
      btn.addEventListener('click', function () {
        if (!name.value.trim()) return toast('Name is required', true);
        btn.disabled = true;
        sb.rpc('admin_add_walkin', {
          p_session_id: s.id,
          p_name: name.value,
          p_email: email.value,
          p_phone: phone.value,
          p_party_size: parseInt(party.value, 10) || 1,
          p_price_option_id: option.value || null,
          p_cash_cents: Math.round((parseFloat(cash.value) || 0) * 100)
        }).then(function (res) {
          btn.disabled = false;
          if (res.error) return fail(res.error.message === 'not_enough_spots' ? new Error('Class is full. Raise capacity in the Schedule tab first.') : res.error);
          toast('Walk-in added');
          load();
        });
      });
      return h('div', { class: 'admin-walkin' },
        h('label', null, 'Walk-in name', name), h('label', null, 'Email', email), h('label', null, 'Phone', phone),
        h('label', null, 'People', party), h('label', null, 'Option', option), h('label', null, 'Cash collected $', cash), btn);
    }

    load();
  };

  // ---- Schedule: weekly rules + individual sessions ----
  TABS.schedule = function () {
    var rulesBox = section('Weekly schedule', 'Recurring classes in Hawaii time. Leave capacity blank to use the class default. ' +
      'After changing rules, use “Rebuild” so future sessions without bookings follow the new rules.');
    content.insertBefore(h('div', { class: 'admin-toolbar' },
      h('button', { type: 'button', class: 'admin-btn', text: 'Generate upcoming sessions', onclick: function () { generate(false); } }),
      confirmButton('Rebuild future sessions from rules', 'admin-btn--ghost', function () { return generate(true); })), rulesBox);

    crud(rulesBox, {
      table: 'schedule_rules',
      order: [['weekday'], ['start_time']],
      canAdd: true, canDelete: true,
      defaults: { active: true, valid_from: hawaiiToday(), start_time: '08:00', end_time: '09:30', weekday: 1 },
      columns: [
        { key: 'class_type_id', label: 'Class', type: 'select', options: opts(function () { return lookups.classes; }) },
        { key: 'weekday', label: 'Day', type: 'select', numeric: true, options: function () { return WEEKDAYS.map(function (d, i) { return [i, d]; }); } },
        { key: 'start_time', label: 'Start', type: 'time' },
        { key: 'end_time', label: 'End', type: 'time' },
        { key: 'capacity', label: 'Capacity', type: 'number' },
        { key: 'location_id', label: 'Location', type: 'select', nullable: true, options: opts(function () { return lookups.locations; }) },
        { key: 'instructor_id', label: 'Instructor', type: 'select', nullable: true, options: opts(function () { return lookups.instructors; }) },
        { key: 'valid_from', label: 'From', type: 'date' },
        { key: 'valid_until', label: 'Until', type: 'date' },
        { key: 'active', label: 'Active', type: 'bool' }
      ]
    });

    var sessionsBox = section('Upcoming sessions', 'Edit a single date: change capacity, add a note shown on /schedule, or cancel it. ' +
      'Edited sessions are kept when rebuilding. Add one-off sessions in the last row (date and times in Hawaii time).');
    var sessions = crud(sessionsBox, {
      table: 'class_sessions',
      filter: function (q) { return q.gte('starts_at', new Date(Date.now() - 3 * 3600e3).toISOString()); },
      order: [['starts_at']],
      canAdd: true,
      defaults: { status: 'scheduled', capacity: 20 },
      columns: [
        { key: 'starts_at', label: 'When', type: 'readonly', format: function (r) { return fmtDateTime(r.starts_at) + '–' + fmtTime(r.ends_at); } },
        { key: 'class_type_id', label: 'Class', type: 'select', options: opts(function () { return lookups.classes; }) },
        { key: '_date', label: 'Date (new)', type: 'date' },
        { key: '_start', label: 'Start (new)', type: 'time' },
        { key: '_end', label: 'End (new)', type: 'time' },
        { key: 'capacity', label: 'Capacity', type: 'number' },
        { key: 'location_id', label: 'Location', type: 'select', nullable: true, options: opts(function () { return lookups.locations; }) },
        { key: 'instructor_id', label: 'Instructor', type: 'select', nullable: true, options: opts(function () { return lookups.instructors; }) },
        { key: 'status', label: 'Status', type: 'select', options: function () { return [['scheduled', 'Scheduled'], ['cancelled', 'Cancelled']]; } },
        { key: 'note', label: 'Public note', type: 'text' }
      ],
      beforeSave: function (v, row, isNew) {
        var date = v._date, start = v._start, end = v._end;
        delete v._date; delete v._start; delete v._end;
        if (isNew) {
          if (!date || !start || !end) { toast('Date, start and end are required for a new session', true); throw new Error('incomplete'); }
          v.starts_at = hawaiiIso(date, start);
          v.ends_at = hawaiiIso(date, end);
        }
        v.customized = true;
        return v;
      }
    });

    function generate(rebuild) {
      return sb.rpc('generate_sessions', { p_rebuild: rebuild }).then(function (res) {
        if (res.error) return fail(res.error);
        toast(res.data + ' session(s) created');
        sessions.reload();
      });
    }
  };

  // ---- Classes, prices, instructors, locations, passes ----
  TABS.classes = function () {
    var refresh = function () { return loadLookups(); };

    crud(section('Classes'), {
      table: 'class_types', order: [['sort_order']], canAdd: true, afterSave: refresh,
      defaults: { active: true, default_capacity: 20, sort_order: 10 },
      columns: [
        { key: 'name', label: 'Name', nullable: false },
        { key: 'slug', label: 'Slug (URL id)', nullable: false },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'detail_url', label: 'Page link' },
        { key: 'instructor_id', label: 'Instructor', type: 'select', nullable: true, options: opts(function () { return lookups.instructors; }) },
        { key: 'location_id', label: 'Location', type: 'select', nullable: true, options: opts(function () { return lookups.locations; }) },
        { key: 'default_capacity', label: 'Capacity', type: 'number' },
        { key: 'sort_order', label: 'Order', type: 'number' },
        { key: 'active', label: 'Active', type: 'bool' }
      ]
    });

    crud(section('Prices & booking options', '“Pay online” options appear on the website only after online payments are approved and enabled. ' +
      '“Free” options skip payment entirely (e.g. Free (Age 60+)).'), {
      table: 'price_options', order: [['class_type_id'], ['sort_order']], canAdd: true, canDelete: true, afterSave: refresh,
      defaults: { active: true, kind: 'in_person', amount_cents: 1000, sort_order: 10 },
      columns: [
        { key: 'class_type_id', label: 'Class', type: 'select', options: opts(function () { return lookups.classes; }) },
        { key: 'label', label: 'Label', nullable: false },
        { key: 'kind', label: 'Payment', type: 'select', options: function () { return [['online', 'Pay online (Stripe)'], ['in_person', 'Pay at class'], ['free', 'Free']]; } },
        { key: 'amount_cents', label: 'Price $ /person', type: 'money' },
        { key: 'eligibility_note', label: 'Note shown to customer' },
        { key: 'sort_order', label: 'Order', type: 'number' },
        { key: 'active', label: 'Active', type: 'bool' }
      ],
      beforeSave: function (v) { if (v.kind === 'free') v.amount_cents = 0; return v; }
    });

    crud(section('Instructors'), {
      table: 'instructors', order: [['name']], canAdd: true, afterSave: refresh,
      defaults: { active: true },
      columns: [
        { key: 'name', label: 'Name', nullable: false },
        { key: 'bio', label: 'Bio', type: 'textarea' },
        { key: 'active', label: 'Active', type: 'bool' }
      ]
    });

    crud(section('Locations'), {
      table: 'locations', order: [['name']], canAdd: true, afterSave: refresh,
      defaults: { active: true },
      columns: [
        { key: 'name', label: 'Name', nullable: false },
        { key: 'address', label: 'Address' },
        { key: 'maps_url', label: 'Google Maps link' },
        { key: 'notes', label: 'Notes' },
        { key: 'active', label: 'Active', type: 'bool' }
      ]
    });

    crud(section('Passes & memberships', 'Stored for the upcoming membership feature; not sold online yet.'), {
      table: 'membership_plans', order: [['name']], canAdd: true,
      defaults: { active: false, kind: 'class_pack' },
      columns: [
        { key: 'name', label: 'Name', nullable: false },
        { key: 'class_type_id', label: 'Class', type: 'select', nullable: true, options: opts(function () { return lookups.classes; }) },
        { key: 'kind', label: 'Type', type: 'select', options: function () { return [['class_pack', 'Class pack'], ['monthly', 'Monthly'], ['annual', 'Annual']]; } },
        { key: 'price_cents', label: 'Price $', type: 'money' },
        { key: 'class_count', label: 'Classes', type: 'number' },
        { key: 'duration_days', label: 'Valid days', type: 'number' },
        { key: 'active', label: 'Active', type: 'bool' }
      ]
    });
  };

  // ---- Customers ----
  TABS.customers = function () {
    var search = h('input', { type: 'search', class: 'form-input', placeholder: 'Search name, email or phone' });
    content.appendChild(h('div', { class: 'admin-toolbar' }, search,
      h('button', { type: 'button', class: 'admin-btn', text: 'Export CSV', onclick: exportCsv })));
    var box = h('div');
    content.appendChild(box);
    var table;
    var timer;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(render, 300);
    });

    function render() {
      box.innerHTML = '';
      var term = search.value.trim().replace(/[%,()]/g, '');
      table = crud(box, {
        table: 'customers',
        select: '*, bookings(count)',
        order: [['created_at', false]],
        filter: function (q) {
          q = q.limit(500);
          return term ? q.or('name.ilike.%' + term + '%,email.ilike.%' + term + '%,phone.ilike.%' + term + '%') : q;
        },
        columns: [
          { key: 'name', label: 'Name', nullable: false },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'phone', label: 'Phone' },
          { key: 'preferred_contact', label: 'Contact via', type: 'select', nullable: true, options: function () { return [['email', 'Email'], ['text', 'Text'], ['phone', 'Phone']]; } },
          { key: 'interests', label: 'Interests', type: 'readonly', format: function (r) { return (r.interests || []).join(', '); } },
          { key: 'bookings', label: 'Bookings', type: 'readonly', format: function (r) { return r.bookings && r.bookings[0] ? String(r.bookings[0].count) : '0'; } },
          { key: 'created_at', label: 'Since', type: 'readonly', format: function (r) { return fmt(r.created_at, { month: 'short', day: 'numeric', year: 'numeric' }); } },
          { key: 'notes', label: 'Notes', type: 'textarea' }
        ]
      });
    }
    render();
  };

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    sb.from('customers')
      .select('name, email, phone, preferred_contact, interests, notes, created_at, bookings(status, class_sessions(starts_at)), memberships(status, ends_on)')
      .order('created_at')
      .then(function (res) {
        if (res.error) return fail(res.error);
        var header = ['name', 'email', 'phone', 'preferred_contact', 'interests', 'notes', 'customer_since',
          'confirmed_bookings', 'last_class', 'active_membership_until'];
        var lines = [header.join(',')].concat(res.data.map(function (c) {
          var confirmed = c.bookings.filter(function (b) { return b.status === 'confirmed'; });
          var last = confirmed.map(function (b) { return b.class_sessions && b.class_sessions.starts_at; }).sort().pop();
          var membership = (c.memberships || []).find(function (m) { return m.status === 'active'; });
          return [c.name, c.email, c.phone, c.preferred_contact, (c.interests || []).join('; '), c.notes,
            c.created_at && c.created_at.slice(0, 10), confirmed.length, last ? fmt(last, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '',
            membership ? membership.ends_on || 'open' : ''].map(csvCell).join(',');
        }));
        var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var a = h('a', { href: URL.createObjectURL(blob), download: 'pele-awakening-customers-' + hawaiiToday() + '.csv' });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
  }

  // ---- Payments ----
  TABS.payments = function () {
    var filter = h('select', { class: 'form-select' },
      h('option', { value: 'all', text: 'All payments' }),
      h('option', { value: 'refund', text: 'Refund requested' }),
      h('option', { value: 'paid', text: 'Paid' }),
      h('option', { value: 'pending', text: 'Pending' }));
    content.appendChild(h('div', { class: 'admin-toolbar' }, filter));
    var box = h('div', { class: 'admin-table-wrap' });
    content.appendChild(box);
    filter.addEventListener('change', load);

    function load() {
      var q = sb.from('payments')
        .select('*, bookings(party_size, status, customers(name, email), class_sessions(starts_at, class_types(name)))')
        .order('created_at', { ascending: false }).limit(300);
      if (filter.value === 'refund') q = q.not('refund_requested_at', 'is', null).eq('status', 'paid');
      if (filter.value === 'paid' || filter.value === 'pending') q = q.eq('status', filter.value);
      q.then(function (res) {
        if (res.error) return fail(res.error);
        box.innerHTML = '';
        box.appendChild(h('table', { class: 'admin-table' },
          h('thead', null, h('tr', null, ['Date', 'Customer', 'Class', 'Type', 'Amount', 'Status', ''].map(function (t) { return h('th', { text: t }); }))),
          h('tbody', null, res.data.map(row))));
      });
    }

    function row(p) {
      var b = p.bookings || {};
      var c = b.customers || {};
      var s = b.class_sessions;
      var refundable = p.provider === 'stripe' && p.status === 'paid' && p.amount_cents > p.refunded_amount_cents;
      return h('tr', null,
        h('td', { text: fmtDateTime(p.created_at) }),
        h('td', null, c.name || '—', c.email ? h('div', { class: 'hint', text: c.email }) : ''),
        h('td', { text: s ? s.class_types.name + ', ' + fmtDateTime(s.starts_at) : '' }),
        h('td', { text: p.provider + ' · ' + p.kind }),
        h('td', { text: money(p.amount_cents) + (p.refunded_amount_cents ? ' (refunded ' + money(p.refunded_amount_cents) + ')' : '') }),
        h('td', null, h('span', { class: 'pill ' + (p.status === 'paid' ? 'pill--ok' : p.status === 'pending' ? 'pill--warn' : 'pill--bad'), text: p.status }),
          p.refund_requested_at && p.status === 'paid' ? h('span', { class: 'pill pill--warn', text: 'refund requested' }) : ''),
        h('td', { class: 'actions' }, refundable ? confirmButton('Refund ' + money(p.amount_cents - p.refunded_amount_cents), null, function () { return refund(p); }) : ''));
    }

    function refund(p) {
      return sb.auth.getSession().then(function (r) {
        return fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/admin-refund', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + r.data.session.access_token },
          body: JSON.stringify({ payment_id: p.id })
        });
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Refund failed');
          toast('Refund issued');
          load();
        });
      }).catch(fail);
    }

    // Record cash or tips collected in person.
    var amount = h('input', { type: 'number', min: '0', step: '0.01', class: 'form-input', placeholder: 'Amount $' });
    var kind = h('select', { class: 'form-select' }, h('option', { value: 'tip', text: 'Tip' }), h('option', { value: 'class', text: 'Class (cash)' }));
    var note = h('input', { type: 'text', class: 'form-input', placeholder: 'Note (e.g. Wed AM class)' });
    content.appendChild(h('h2', { text: 'Record cash or tip' }));
    content.appendChild(h('div', { class: 'admin-toolbar' }, amount, kind, note,
      h('button', { type: 'button', class: 'admin-btn', text: 'Record', onclick: function () {
        var cents = Math.round((parseFloat(amount.value) || 0) * 100);
        if (cents <= 0) return toast('Enter an amount', true);
        sb.from('payments').insert({ provider: 'cash', kind: kind.value, amount_cents: cents, status: 'paid', notes: note.value || null })
          .then(function (res) {
            if (res.error) return fail(res.error);
            amount.value = ''; note.value = '';
            toast('Recorded');
            load();
          });
      } })));

    load();
  };

  // ---- Inquiries ----
  TABS.inquiries = function () {
    content.appendChild(h('p', { class: 'hint', text: 'Contact-form messages saved to the database. FormSubmit still emails every inquiry to aloha@peleawakening.com during the transition.' }));
    var box = h('div', { class: 'admin-table-wrap' });
    content.appendChild(box);
    sb.from('inquiries').select('*').order('received_at', { ascending: false }).limit(300).then(function (res) {
      if (res.error) return fail(res.error);
      box.appendChild(h('table', { class: 'admin-table' },
        h('thead', null, h('tr', null, ['Received', 'Name', 'Contact', 'Interest', 'Message', 'Source'].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, res.data.map(function (i) {
          return h('tr', null,
            h('td', { text: fmtDateTime(i.received_at) }),
            h('td', { text: i.name || '' }),
            h('td', null, i.email || '', i.phone ? h('div', { text: i.phone }) : '', i.contact_method ? h('div', { class: 'hint', text: 'prefers ' + i.contact_method }) : ''),
            h('td', { text: i.interest || '' }),
            h('td', { text: i.message || '' }),
            h('td', { text: i.source }));
        }))));
    });
  };

  // ---- Settings ----
  TABS.settings = function () {
    sb.from('settings').select('*').single().then(function (res) {
      if (res.error) return fail(res.error);
      var s = res.data;
      var hours = h('input', { type: 'number', min: '0', class: 'form-input', value: s.cancellation_hours });
      var policy = h('textarea', { class: 'form-textarea', value: s.cancellation_policy });
      var party = h('input', { type: 'number', min: '1', class: 'form-input', value: s.max_party_size });
      var windowDays = h('input', { type: 'number', min: '1', max: '120', class: 'form-input', value: s.booking_window_days });
      content.appendChild(h('div', { class: 'admin-settings' },
        h('label', null, 'Online cancellation cutoff (hours before class)', hours),
        h('label', null, 'Cancellation & refund policy', h('small', { text: 'Shown on /schedule, booking pages and confirmation emails.' }), policy),
        h('label', null, 'Max participants per online booking', party),
        h('label', null, 'Generate sessions this many days ahead', windowDays),
        h('p', null, h('strong', { text: 'Online payments: ' }),
          h('span', { class: 'pill ' + (s.online_payments_enabled ? 'pill--ok' : 'pill--warn'), text: s.online_payments_enabled ? 'Enabled' : 'Off (pay at class & free options only)' }),
          h('br'), h('small', { class: 'hint', text: 'Turned on by the developer after pricing and Stripe setup are approved.' })),
        h('div', null, h('button', { type: 'button', class: 'admin-btn', text: 'Save settings', onclick: function () {
          sb.from('settings').update({
            cancellation_hours: parseInt(hours.value, 10),
            cancellation_policy: policy.value.trim(),
            max_party_size: parseInt(party.value, 10),
            booking_window_days: parseInt(windowDays.value, 10),
            updated_at: new Date().toISOString()
          }).eq('id', true).then(function (r) { if (r.error) fail(r.error); else toast('Settings saved'); });
        } }))));
    });
  };
})();
