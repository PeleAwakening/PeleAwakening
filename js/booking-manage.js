/* ============================================
   PELE AWAKENING — Booking receipt / manage / Stripe return pages
   ============================================ */
(function () {
  'use strict';

  var B = window.PABooking;
  var esc = B.escape;
  var root = document.getElementById('bookingReceipt');
  var mode = root.dataset.mode; // manage | success | cancelled
  var token = new URLSearchParams(location.search).get('t');

  function setStatus(html) {
    root.innerHTML = '<p class="booking-status">' + html + '</p>';
  }

  if (!B.configured() || !token) {
    setStatus('This booking link is incomplete. Please use the link from your confirmation email, or <a href="/contact.html">contact us</a>.');
    return;
  }

  var STATUS_TEXT = {
    confirmed: 'Confirmed',
    pending: 'Awaiting payment',
    cancelled: 'Cancelled',
    expired: 'Not completed'
  };

  function render(b, note) {
    var payment = b.payment_mode === 'online'
      ? (b.payment_status === 'paid' ? 'Paid online ' + B.money(b.total_amount_cents)
        : b.payment_status === 'refunded' ? 'Refunded'
        : 'Online payment ' + (b.payment_status || 'pending'))
      : b.payment_mode === 'in_person' ? 'Pay at class: ' + B.money(b.total_amount_cents)
      : (b.option_label || 'Free');

    root.innerHTML =
      (note ? '<p class="booking-receipt-note">' + note + '</p>' : '') +
      '<div class="booking-receipt-card">' +
        '<div class="booking-receipt-status is-' + esc(b.status) + '">' + esc(STATUS_TEXT[b.status] || b.status) + '</div>' +
        (b.session_cancelled ? '<p class="booking-error">This class has been cancelled by Pele Awakening. We&rsquo;ll be in touch.</p>' : '') +
        '<h2>' + esc(b.class_name) + '</h2>' +
        (b.reference ? '<p class="booking-muted">Booking reference: <strong class="booking-ref">' + esc(b.reference) + '</strong></p>' : '') +
        '<p>' + esc(B.dayLabel(b.starts_at)) + ' &middot; ' + esc(B.timeRange(b.starts_at, b.ends_at)) + ' (Hawai&#699;i time)</p>' +
        '<p>' + esc(b.location_name || '') + (b.location_address ? '<br><span class="booking-muted">' + esc(b.location_address) + '</span>' : '') + '</p>' +
        (b.maps_url ? '<p><a class="map-link" href="' + esc(B.safeUrl(b.maps_url)) + '" target="_blank" rel="noopener">Open in Google Maps &rarr;</a></p>' : '') +
        '<p>' + b.party_size + ' participant' + (b.party_size === 1 ? '' : 's') + ' &middot; ' + esc(payment) + '</p>' +
        (b.refund_requested && b.payment_status !== 'refunded' ? '<p class="booking-muted">Refund requested. We&rsquo;ll process it shortly.</p>' : '') +
        (b.can_cancel && b.status === 'confirmed'
          ? '<div class="booking-cancel"><button type="button" class="btn btn-ghost" id="cancelBtn">Cancel Booking</button>' +
            '<div class="booking-cancel-confirm" id="cancelConfirm" hidden><p>Cancel this booking' +
            (b.payment_status === 'paid' ? ' and request a refund' : '') + '?</p>' +
            '<button type="button" class="btn btn-primary" id="cancelYes">Yes, Cancel</button> ' +
            '<button type="button" class="btn btn-ghost" id="cancelNo">Keep Booking</button></div></div>'
          : '') +
        '<p class="booking-muted booking-policy">' + esc(b.cancellation_policy) + '</p>' +
        '<p class="booking-error" id="manageError" role="alert" hidden></p>' +
      '</div>';

    var cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
      var confirmBox = document.getElementById('cancelConfirm');
      cancelBtn.addEventListener('click', function () { cancelBtn.hidden = true; confirmBox.hidden = false; });
      document.getElementById('cancelNo').addEventListener('click', function () { cancelBtn.hidden = false; confirmBox.hidden = true; });
      document.getElementById('cancelYes').addEventListener('click', function (e) {
        e.target.disabled = true;
        B.fn('manage-booking', { token: token, action: 'cancel' })
          .then(function (res) { render(res, 'Your booking has been cancelled.'); })
          .catch(function (err) {
            var el = document.getElementById('manageError');
            el.textContent = err.message;
            el.hidden = false;
            e.target.disabled = false;
          });
      });
    }
  }

  function fail(err) {
    setStatus(esc(err.message) + ' Please <a href="/contact.html">contact us</a> if you need help.');
  }

  if (mode === 'cancelled') {
    // Customer left Stripe Checkout: release the held spots right away.
    B.fn('manage-booking', { token: token, action: 'release' }).then(function (b) {
      if (b.status === 'confirmed') render(b, 'Your payment already went through, so your booking is confirmed.');
      else setStatus('Your card was not charged and your spot was released. You can <a href="/schedule/">choose another class</a> or book again anytime.');
    }).catch(fail);
    return;
  }

  if (mode === 'success') {
    // Payment confirmation arrives via Stripe's webhook; wait briefly for it.
    var tries = 0;
    (function poll() {
      B.fn('manage-booking', { token: token, action: 'view' }).then(function (b) {
        if (b.status === 'confirmed') return render(b, 'Payment received. Your spot is confirmed and a confirmation email is on its way.');
        if (b.status === 'pending' && ++tries < 10) {
          setStatus('Confirming your payment&hellip;');
          return setTimeout(poll, 2000);
        }
        render(b, b.status === 'pending'
          ? 'Your payment is still processing. You&rsquo;ll receive an email once it&rsquo;s confirmed.'
          : '');
      }).catch(fail);
    })();
    return;
  }

  B.fn('manage-booking', { token: token, action: 'view' }).then(function (b) { render(b); }).catch(fail);
})();
