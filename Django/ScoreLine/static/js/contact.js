/* ScoreLine contact / feedback form. Depends on js/api.js (ScoreLineAPI). */
(function () {
    'use strict';

    var API = window.ScoreLineAPI;
    var $ = function (id) { return document.getElementById(id); };
    var form = $('contactForm');
    var MAX = 1000, MIN = 10;
    var RATING_WORDS = ['No rating', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
    var startedAt = Date.now();

    var FIELDS = {
        full_name: function (v) {
            if (!v.trim()) return 'Enter your full name.';
            if (v.trim().length < 2) return 'Your name looks too short.';
            return '';
        },
        email: function (v) {
            if (!v.trim()) return 'Enter your email address so we can reply.';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) return 'Enter an email address like name@example.com.';
            return '';
        },
        phone: function (v) {
            if (!v.trim()) return '';
            var digits = v.replace(/\D/g, '');
            if (!/^[+\d][\d\s().-]*$/.test(v.trim()) || digits.length < 7 || digits.length > 15) return 'Enter a valid phone number (7–15 digits), or leave it blank.';
            return '';
        },
        subject: function (v) { return v ? '' : 'Choose what your feedback is about.'; },
        message: function (v) {
            var n = v.trim().length;
            if (!n) return 'Enter a message.';
            if (n < MIN) return 'Your message needs at least ' + MIN + ' characters (currently ' + n + ').';
            if (v.length > MAX) return 'Your message is too long (maximum ' + MAX + ' characters).';
            return '';
        }
    };
    var LABELS = { full_name: 'Full name', email: 'Email address', phone: 'Phone', subject: 'Feedback type', message: 'Message' };

    function setError(name, msg) {
        var input = $(name), err = $(name + '-error');
        input.classList.toggle('field-invalid', !!msg);
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        err.textContent = msg;
        err.classList.toggle('hidden', !msg);
    }
    function validateField(name) {
        var msg = FIELDS[name]($(name).value);
        setError(name, msg);
        return msg;
    }

    // Validate on blur; once a field has shown an error, re-check as the user types
    Object.keys(FIELDS).forEach(function (name) {
        var el = $(name);
        el.addEventListener('blur', function () { if (el.value || el.getAttribute('aria-invalid') === 'true') validateField(name); });
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
            if (el.getAttribute('aria-invalid') === 'true') validateField(name);
        });
    });

    // Character counter
    var msgEl = $('message'), counter = $('charCount');
    function updateCount() {
        var n = msgEl.value.length;
        counter.textContent = n + ' / ' + MAX;
        counter.className = 'text-[11px] tabular ' + (n > MAX * 0.9 ? 'text-amber-300 font-bold' : 'text-gray-400');
        // Only announce near the limit to avoid chatty screen readers
        counter.setAttribute('aria-live', n > MAX * 0.9 ? 'polite' : 'off');
    }
    msgEl.addEventListener('input', updateCount);
    updateCount();

    // Star rating
    var stars = Array.prototype.slice.call(document.querySelectorAll('#starRating input'));
    function paintStars(n) {
        stars.forEach(function (s, i) { s.nextElementSibling.classList.toggle('is-on', i < n); });
    }
    function currentRating() { var c = stars.filter(function (s) { return s.checked; })[0]; return c ? +c.value : 0; }
    function updateRating() {
        var r = currentRating();
        paintStars(r);
        $('ratingText').textContent = r ? r + '/5 · ' + RATING_WORDS[r] : RATING_WORDS[0];
        $('clearRating').classList.toggle('hidden', !r);
    }
    stars.forEach(function (s, i) {
        s.addEventListener('change', updateRating);
        s.nextElementSibling.addEventListener('mouseenter', function () { paintStars(i + 1); });
        s.nextElementSibling.addEventListener('mouseleave', function () { paintStars(currentRating()); });
    });
    $('clearRating').addEventListener('click', function () { stars.forEach(function (s) { s.checked = false; }); updateRating(); stars[0].focus(); });

    function showSummary(errors) {
        var box = $('errorSummary');
        if (!errors.length) { box.classList.add('hidden'); return; }
        box.innerHTML = '<p class="font-bold text-white mb-1">Please fix ' + (errors.length === 1 ? 'this' : 'these ' + errors.length) + ' before sending:</p><ul class="list-disc pl-5 space-y-0.5">' +
            errors.map(function (e) { return '<li><a href="#' + e.name + '" class="underline hover:text-white" data-focus="' + e.name + '">' + LABELS[e.name] + ': ' + e.msg + '</a></li>'; }).join('') + '</ul>';
        box.classList.remove('hidden');
    }
    $('errorSummary').addEventListener('click', function (e) {
        var a = e.target.closest('[data-focus]');
        if (a) { e.preventDefault(); $(a.getAttribute('data-focus')).focus(); }
    });

    function setSubmitting(on) {
        var btn = $('submitBtn');
        btn.disabled = on;
        btn.querySelector('span').textContent = on ? 'Sending…' : 'Send Message';
        btn.querySelector('i').className = on ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-paper-plane';
    }

    function showSuccess(isDemo) {
        $('formView').classList.add('hidden');
        $('successView').classList.remove('hidden');
        $('successDemo').classList.toggle('hidden', !isDemo);
        $('successView').focus();
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        $('submitError').classList.add('hidden');

        var errors = [];
        Object.keys(FIELDS).forEach(function (name) {
            var msg = validateField(name);
            if (msg) errors.push({ name: name, msg: msg });
        });
        showSummary(errors);
        if (errors.length) { $(errors[0].name).focus(); return; }

        // Honeypot or impossibly fast submission: pretend it worked, send nothing.
        if ($('website').value || Date.now() - startedAt < 1500) {
            console.info('[ScoreLine] Submission blocked by spam protection.');
            showSuccess(false);
            return;
        }

        var payload = {
            full_name: $('full_name').value.trim(),
            email: $('email').value.trim(),
            phone: $('phone').value.trim() || null,
            subject: $('subject').value,
            message: msgEl.value.trim(),
            rating: currentRating() || null,
            page: location.pathname,
            submitted_at: new Date().toISOString()
        };

        setSubmitting(true);
        try {
            var res = await API.submitContact(payload);
            showSuccess(!!(res && res.mock) || API.getStatus().source === 'mock');
        } catch (err) {
            var details = err.details && typeof err.details === 'object' ? err.details : null;
            // Map server-side field errors ({ errors: { email: ["..."] } }) back onto fields
            if (details && details.errors) {
                var mapped = [];
                Object.keys(details.errors).forEach(function (k) {
                    if (FIELDS[k]) { var m = [].concat(details.errors[k])[0]; setError(k, m); mapped.push({ name: k, msg: m }); }
                });
                showSummary(mapped);
            }
            $('submitErrorText').textContent = 'Your message couldn’t be sent: ' + err.message + ' Please try again, or email us directly.';
            $('submitError').classList.remove('hidden');
        } finally {
            setSubmitting(false);
        }
    });

    $('sendAnother').addEventListener('click', function () {
        form.reset();
        Object.keys(FIELDS).forEach(function (n) { setError(n, ''); });
        showSummary([]);
        updateCount(); updateRating();
        startedAt = Date.now();
        $('successView').classList.add('hidden');
        $('formView').classList.remove('hidden');
        $('full_name').focus();
    });
})();
