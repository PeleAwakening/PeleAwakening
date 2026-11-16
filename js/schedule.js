/* ============================================
   PELE AWAKENING — /schedule booking flow
   ============================================ */
(function () {
  'use strict';

  var B = window.PABooking;
  var esc = B.escape;

  var statusEl = document.getElementById('scheduleStatus');
  var listEl = document.getElementById('scheduleList');
  var filtersEl = document.getElementById('classFilters');
  var policyEl = document.getElementById('policyText');

  var modal = document.getElementById('bookingModal');
  var form = document.getElementById('bookingForm');
  var titleEl = document.getElementById('bookingTitle');
  var metaEl = document.getElementById('bookingMeta');
  var optionsEl = document.getElementById('bookingOptions');
  var partyInput = document.getElementById('b-party');
  var partyHint = document.getElementById('partyHint');
  var totalEl = document.getElementById('bookingTotal');
  var formPolicyEl = document.getElementById('bookingPolicy');
  var errorEl = document.getElementById('bookingError');
  var submitBtn = document.getElementById('bookingSubmit');
  var doneEl = document.getElementById('bookingDone');

  var state = {
    sessions: [],
    settings: {},
    filter: new URLSearchParams(location.search).get('class') || 'all',
    session: null,
    lastFocus: null
  };

  if (!B.configured()) {
    statusEl.innerHTML = 'Online booking is coming soon. In the meantime, walk-ins are welcome, or <a href="/contact.html">contact us</a> to reserve a spot.';
    return;
  }

  // ---- Load & render schedule ----
  function load() {
    return B.rpc('get_public_schedule', { p_days: 14 }).then(function (data) {
      state.sessions = data.sessions || [];
      state.settings = data.settings || {};
      if (state.settings.cancellation_policy) policyEl.textContent = state.settings.cancellation_policy;
      renderFilters();
      renderList();
    }).catch(function () {
      statusEl.innerHTML = 'We couldn&rsquo;t load the schedule. Please refresh, or <a href="/contact.html">contact us</a>.';
    });
  }

  function renderFilters() {
    var classes = [];
    state.sessions.forEach(function (s) {
      if (!classes.some(function (c) { return c.slug === s.slug; })) classes.push({ slug: s.slug, name: s.class_name });
    });
    if (classes.length < 2) { filtersEl.hidden = true; return; }
    if (state.filter !== 'all' && !classes.some(function (c) { return c.slug === state.filter; })) state.filter = 'all';
    filtersEl.innerHTML = [{ slug: 'all', name: 'All Classes' }].concat(classes).map(function (c) {
      return '<button type="button" class="booking-chip' + (c.slug === state.filter ? ' is-active' : '') +
        '" data-filter="' + esc(c.slug) + '" aria-pressed="' + (c.slug === state.filter) + '">' + esc(c.name) + '</button>';
    }).join('');
    filtersEl.hidden = false;
  }

  filtersEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    var url = new URL(location.href);
    if (state.filter === 'all') url.searchParams.delete('class'); else url.searchParams.set('class', state.filter);
    history.replaceState(null, '', url);
    renderFilters();
    renderList();
  });

  function renderList() {
    var sessions = state.sessions.filter(function (s) { return state.filter === 'all' || s.slug === state.filter; });
    if (!sessions.length) {
      statusEl.innerHTML = 'No upcoming classes are open for booking right now. Please check back soon or <a href="/contact.html">contact us</a>.';
      statusEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }
    statusEl.hidden = true;

    var html = '';
    var currentDay = null;
    sessions.forEach(function (s) {
      var day = B.dayKey(s.starts_at);
      if (day !== currentDay) {
        if (currentDay) html += '</div>';
        html += '<h2 class="schedule-day">' + esc(B.dayLabel(s.starts_at)) + '</h2><div class="schedule-day-list">';
        currentDay = day;
      }
      var full = s.spots_left <= 0;
      var bookable = !full && s.price_options.length > 0;
      var spots = full ? 'Full &middot; walk-ins if space opens'
        : s.spots_left <= 5 ? 'Only ' + s.spots_left + ' spot' + (s.spots_left === 1 ? '' : 's') + ' left'
        : s.spots_left + ' spots open';
      var from = cheapest(s.price_options);

      html += '<article class="session-card' + (full ? ' is-full' : '') + '">' +
        '<div class="session-time">' + esc(B.timeRange(s.starts_at, s.ends_at)) + '</div>' +
        '<div class="session-body">' +
          '<h3 class="session-name">' + (s.detail_url ? '<a href="' + esc(B.safeUrl(s.detail_url)) + '">' + esc(s.class_name) + '</a>' : esc(s.class_name)) + '</h3>' +
          (s.instructor ? '<div class="session-meta">with ' + esc(s.instructor) + '</div>' : '') +
          '<div class="session-meta">' + esc(s.location_name || '') +
            (s.maps_url ? ' &middot; <a href="' + esc(B.safeUrl(s.maps_url)) + '" target="_blank" rel="noopener">Map</a>' : '') + '</div>' +
          (s.note ? '<div class="session-note">' + esc(s.note) + '</div>' : '') +
        '</div>' +
        '<div class="session-action">' +
          '<div class="session-spots' + (s.spots_left <= 5 ? ' is-low' : '') + '">' + spots + '</div>' +
          (from ? '<div class="session-price">' + esc(from) + '</div>' : '') +
          '<button type="button" class="btn btn-primary session-book" data-session="' + esc(s.id) + '"' + (bookable ? '' : ' disabled') + '>' +
            (full ? 'Full' : 'Book') + '</button>' +
        '</div>' +
      '</article>';
    });
    listEl.innerHTML = html + '</div>';
  }

  function cheapest(options) {
    if (!options.length) return '';
    if (options.some(function (o) { return o.kind === 'free'; })) {
      var paid = options.filter(function (o) { return o.kind !== 'free'; });
      return paid.length ? B.money(Math.min.apply(null, paid.map(function (o) { return o.amount_cents; }))) + ' · Free 60+' : 'Free';
    }
    return B.money(Math.min.apply(null, options.map(function (o) { return o.amount_cents; })));
  }

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-session]');
    if (!btn || btn.disabled) return;
    var s = state.sessions.find(function (x) { return x.id === btn.dataset.session; });
    if (s) openModal(s);
  });

  // ---- Booking modal ----
  function maxParty() {
    return Math.max(1, Math.min(state.settings.max_party_size || 6, state.session.spots_left));
  }

  function openModal(s) {
    state.session = s;
    state.lastFocus = document.activeElement;
    titleEl.textContent = s.class_name;
    metaEl.innerHTML = esc(B.dayLabel(s.starts_at)) + ' &middot; ' + esc(B.timeRange(s.starts_at, s.ends_at)) + ' (Hawai&#699;i time)<br>' +
      esc(s.location_name || '') + (s.instructor ? ' &middot; with ' + esc(s.instructor) : '');

    optionsEl.innerHTML = s.price_options.map(function (o, i) {
      var price = o.kind === 'free' ? 'Free' : B.money(o.amount_cents);
      return '<label class="booking-option">' +
        '<input type="radio" name="price_option_id" value="' + esc(o.id) + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span class="booking-option-text"><span class="booking-option-label">' + esc(o.label) + '</span>' +
        (o.note ? '<span class="booking-option-note">' + esc(o.note) + '</span>' : '') + '</span>' +
        '<span class="booking-option-price">' + price + (o.kind !== 'free' ? '<small>/person</small>' : '') + '</span>' +
      '</label>';
    }).join('');

    partyInput.max = maxParty();
    partyInput.value = 1;
    partyHint.textContent = s.spots_left + ' spot' + (s.spots_left === 1 ? '' : 's') + ' left';
    formPolicyEl.textContent = state.settings.cancellation_policy || '';
    errorEl.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    form.hidden = false;
    doneEl.hidden = true;
    submitBtn.disabled = false;
    syncPills();
    updateTotal();

    modal.hidden = false;
    document.documentElement.classList.add('booking-modal-open');
    document.body.classList.add('booking-modal-open');
    var firstOption = optionsEl.querySelector('input');
    if (firstOption) firstOption.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.documentElement.classList.remove('booking-modal-open');
    document.body.classList.remove('booking-modal-open');
    if (state.lastFocus) state.lastFocus.focus();
  }

  modal.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  function selectedOption() {
    var checked = form.querySelector('input[name="price_option_id"]:checked');
    return checked && state.session.price_options.find(function (o) { return o.id === checked.value; });
  }

  function partySize() {
    var n = parseInt(partyInput.value, 10);
    return isNaN(n) ? 1 : Math.min(Math.max(n, 1), maxParty());
  }

  function updateTotal() {
    var o = selectedOption();
    if (!o) { totalEl.textContent = ''; return; }
    var n = partySize();
    var people = n + ' participant' + (n === 1 ? '' : 's');
    if (o.kind === 'free') {
      totalEl.innerHTML = people + ' &middot; <strong>Free</strong>';
      submitBtn.textContent = 'Reserve';
    } else {
      var total = B.money(o.amount_cents * n);
      totalEl.innerHTML = people + ' &middot; Total <strong>' + total + '</strong>' + (o.kind === 'in_person' ? ' &middot; pay at class' : '');
      submitBtn.textContent = o.kind === 'online' ? 'Continue to Payment' : 'Reserve';
    }
  }

  function syncPills() {
    form.querySelectorAll('.form-radio-pill, .booking-option').forEach(function (pill) {
      var input = pill.querySelector('input');
      pill.classList.toggle('is-checked', input.checked);
    });
  }

  form.addEventListener('change', function () { syncPills(); updateTotal(); });
  partyInput.addEventListener('input', updateTotal);
  partyInput.addEventListener('blur', function () { partyInput.value = partySize(); updateTotal(); });
  form.querySelectorAll('[data-step]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      partyInput.value = Math.min(Math.max(partySize() + Number(btn.dataset.step), 1), maxParty());
      updateTotal();
    });
  });

  function showError(msg, field) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', 'bookingError');
      field.focus();
    }
  }

  form.addEventListener('input', function (e) {
    if (e.target.hasAttribute('aria-invalid')) {
      e.target.removeAttribute('aria-invalid');
      e.target.removeAttribute('aria-describedby');
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var data = new FormData(form);
    var o = selectedOption();
    if (!o) return showError('Please choose a booking option.');
    var nameInput = form.querySelector('#b-name');
    var emailInput = form.querySelector('#b-email');
    if (!String(data.get('name')).trim()) return showError('Please enter your name.', nameInput);
    if (!emailInput.checkValidity() || !String(data.get('email')).trim()) return showError('Please enter a valid email.', emailInput);

    var label = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = o.kind === 'online' ? 'Opening secure checkout…' : 'Reserving…';

    B.fn('create-booking', {
      session_id: state.session.id,
      price_option_id: o.id,
      party_size: partySize(),
      name: data.get('name'),
      email: data.get('email'),
      phone: data.get('phone'),
      preferred_contact: data.get('preferred_contact'),
      website: data.get('website')
    }).then(function (res) {
      if (res.checkout_url) {
        window.location.href = res.checkout_url; // Stripe-hosted checkout
        return;
      }
      document.getElementById('bookingDoneText').innerHTML =
        '<strong>' + esc(state.session.class_name) + '</strong><br>' +
        esc(B.dayLabel(state.session.starts_at)) + ' &middot; ' + esc(B.timeRange(state.session.starts_at, state.session.ends_at)) + '<br>' +
        partySize() + ' participant' + (partySize() === 1 ? '' : 's') + ' &middot; ' + esc(o.label) +
        (res.reference ? '<br>Booking reference: <strong class="booking-ref">' + esc(res.reference) + '</strong>' : '');
      document.getElementById('bookingManageLink').href = res.manage_url;
      form.hidden = true;
      doneEl.hidden = false;
      modal.querySelector('.booking-modal-panel').scrollTop = 0;
      load();
    }).catch(function (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = label;
      showError(err.message);
      if (err.status === 409) load();
    });
  });

  load();
})();
