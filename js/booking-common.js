/* ============================================
   PELE AWAKENING — Booking helpers (shared)
   ============================================ */
(function () {
  'use strict';

  var cfg = window.PA_CONFIG || {};
  var TZ = 'Pacific/Honolulu';

  function configured() {
    return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  function request(path, body) {
    return fetch(cfg.supabaseUrl.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.supabaseAnonKey
      },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || data.message || 'Something went wrong. Please try again.');
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function fmt(date, opts) {
    return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ }, opts)).format(new Date(date));
  }

  window.PABooking = {
    configured: configured,
    rpc: function (fn, args) { return request('/rest/v1/rpc/' + fn, args); },
    fn: function (name, body) { return request('/functions/v1/' + name, body); },
    // Hawaii calendar date key, e.g. 2026-11-18
    dayKey: function (date) {
      return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
    },
    dayLabel: function (date) { return fmt(date, { weekday: 'long', month: 'long', day: 'numeric' }); },
    time: function (date) { return fmt(date, { hour: 'numeric', minute: '2-digit' }); },
    timeRange: function (start, end) { return this.time(start) + '–' + this.time(end); },
    money: function (cents) {
      var dollars = cents / 100;
      return '$' + (dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2));
    },
    escape: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    // Only allow http(s) links from data into href attributes.
    safeUrl: function (url) {
      return /^https?:\/\//i.test(url || '') || /^\/(?!\/)/.test(url || '') ? url : '#';
    }
  };
})();
