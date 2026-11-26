/* ScoreLine shared layout: header (with mobile menu), footer and account modals.
   Single source of truth for navigation on every page.
   Usage: <body data-page="home|predictor|about|contact">
          <div id="site-header"></div> ... <div id="site-footer"></div>
          <script src="js/layout.js"></script>  (right after #site-header, not deferred, to avoid a flash) */
(function () {
    'use strict';

    var page = document.body.getAttribute('data-page') || '';

    var NAV = [
        { id: 'home', href: 'index.html', label: 'Home' },
        { id: 'predictor', href: 'predictor.html', label: 'Predictor', children: [
            { href: 'predictor.html', icon: 'fa-bolt', label: 'Live Predictor' },
            { href: 'predictor.html#fixtures', icon: 'fa-calendar-days', label: 'Browse Fixtures' },
            { href: 'about.html#performance', icon: 'fa-chart-line', label: 'Model Performance' }
        ] },
        { id: 'about', href: 'about.html', label: 'About Us' },
        { id: 'contact', href: 'contact.html', label: 'Contact Us' }
    ];

    function linkCls(id) {
        return id === page
            ? 'text-sm font-semibold text-activeRed transition-colors'
            : 'text-sm font-medium text-gray-300 hover:text-activeRed transition-colors';
    }
    function current(id) { return id === page ? ' aria-current="page"' : ''; }

    function desktopNav() {
        return NAV.map(function (item) {
            if (!item.children) {
                return '<a href="' + item.href + '" class="' + linkCls(item.id) + '"' + current(item.id) + '>' + item.label + '</a>';
            }
            var sub = item.children.map(function (c) {
                return '<a href="' + c.href + '" class="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-gray-200 hover:bg-sportCard hover:text-activeRed focus:bg-sportCard focus:text-activeRed transition-colors">' +
                    '<i class="fa-solid ' + c.icon + ' text-activeRed w-4" aria-hidden="true"></i><span>' + c.label + '</span></a>';
            }).join('');
            return '<div class="relative group" data-dropdown>' +
                '<div class="inline-flex items-center gap-1.5 py-2">' +
                    '<a href="' + item.href + '" class="' + linkCls(item.id) + '"' + current(item.id) + '>' + item.label + '</a>' +
                    '<button type="button" class="p-1 text-gray-400 hover:text-activeRed" aria-expanded="false" aria-haspopup="true" aria-label="Show predictor sections" data-dropdown-toggle>' +
                        '<i class="fa-solid fa-chevron-down text-[10px] transition-transform duration-200 group-hover:rotate-180" aria-hidden="true"></i>' +
                    '</button>' +
                '</div>' +
                '<div class="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-all duration-150 absolute left-0 top-full pt-2 w-56 z-50" data-dropdown-menu>' +
                    '<div class="glass-panel rounded-xl border border-sportBorder shadow-red-glow py-2 overflow-hidden">' + sub + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function mobileNav() {
        var out = '';
        NAV.forEach(function (item) {
            out += '<a href="' + item.href + '" class="block px-3 py-3 rounded-lg text-base ' +
                (item.id === page ? 'text-activeRed font-semibold bg-sportCard' : 'text-gray-200 hover:bg-sportCard hover:text-activeRed') + '"' + current(item.id) + '>' + item.label + '</a>';
            if (item.children) {
                item.children.slice(1).forEach(function (c) {
                    out += '<a href="' + c.href + '" class="block pl-8 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-sportCard hover:text-activeRed"><i class="fa-solid ' + c.icon + ' text-activeRed w-4 mr-2" aria-hidden="true"></i>' + c.label + '</a>';
                });
            }
        });
        return out;
    }

    var header =
        '<a href="#main" class="skip-link">Skip to main content</a>' +
        '<header class="sticky top-0 z-50 w-full glass-panel border-b border-sportBorder/60">' +
            '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">' +
                '<a href="index.html" class="flex items-center gap-3 group" aria-label="ScoreLine home">' +
                    '<div class="w-10 h-10 bg-activeRed rounded-lg flex items-center justify-center transform -skew-x-12 group-hover:scale-105 transition-all shadow-red-glow">' +
                        '<i class="fa-solid fa-bolt text-white text-xl transform skew-x-12" aria-hidden="true"></i>' +
                    '</div>' +
                    '<div class="flex flex-col">' +
                        '<span class="font-extrabold text-2xl tracking-wider text-white uppercase font-teko leading-none">SCORE<span class="text-activeRed">LINE</span></span>' +
                        '<span class="text-[10px] tracking-widest text-gray-400 uppercase font-semibold">Pitch Analytics</span>' +
                    '</div>' +
                '</a>' +
                '<nav class="hidden md:flex items-center gap-8" aria-label="Main">' + desktopNav() + '</nav>' +
                '<div class="flex items-center gap-2 sm:gap-3">' +
                    '<button type="button" data-open-modal="loginModal" class="hidden sm:inline-flex px-4 py-2.5 text-sm font-semibold text-gray-200 hover:text-white transition-colors">Log In</button>' +
                    '<button type="button" data-open-modal="registerModal" class="hidden sm:inline-flex relative items-center justify-center px-5 py-2.5 text-sm font-bold text-white bg-ctaRed hover:bg-ctaRedHover rounded-md shadow-red-glow hover:shadow-red-glow-lg transition-all uppercase tracking-wider gap-2">' +
                        'Get Started <i class="fa-solid fa-arrow-right text-xs" aria-hidden="true"></i></button>' +
                    '<button type="button" id="mobileMenuBtn" class="md:hidden w-11 h-11 inline-flex items-center justify-center rounded-lg border border-sportBorder text-gray-200 hover:text-activeRed" aria-expanded="false" aria-controls="mobileMenu" aria-label="Open menu">' +
                        '<i class="fa-solid fa-bars text-lg" aria-hidden="true"></i></button>' +
                '</div>' +
            '</div>' +
            '<div id="mobileMenu" class="md:hidden hidden border-t border-sportBorder/60 px-4 pb-4 pt-2">' +
                '<nav aria-label="Mobile">' + mobileNav() + '</nav>' +
                '<div class="grid grid-cols-2 gap-3 mt-3">' +
                    '<button type="button" data-open-modal="loginModal" class="py-3 rounded-lg border border-sportBorder text-sm font-semibold text-gray-200">Log In</button>' +
                    '<button type="button" data-open-modal="registerModal" class="py-3 rounded-lg bg-ctaRed text-sm font-bold text-white uppercase tracking-wider">Get Started</button>' +
                '</div>' +
            '</div>' +
        '</header>';

    var footer =
        '<footer class="w-full bg-black border-t border-sportBorder/60 py-12 mt-auto">' +
            '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8">' +
                '<div>' +
                    '<div class="flex items-center gap-3 mb-4">' +
                        '<div class="w-8 h-8 bg-activeRed rounded flex items-center justify-center text-white text-sm font-bold shadow-red-glow"><i class="fa-solid fa-bolt" aria-hidden="true"></i></div>' +
                        '<span class="font-bold text-lg text-white font-teko tracking-wider">SCORE<span class="text-activeRed">LINE</span></span>' +
                    '</div>' +
                    '<p class="text-xs text-gray-400 leading-relaxed">Explore home win, draw, and away win forecasts powered by ScoreLine before the next whistle.</p>' +
                '</div>' +
                '<div><h2 class="text-xs font-bold text-white uppercase tracking-wider mb-4">Platform Pages</h2>' +
                    '<ul class="space-y-2 text-xs text-gray-400">' +
                        '<li><a href="index.html" class="hover:text-activeRed transition-colors">Home</a></li>' +
                        '<li><a href="predictor.html" class="hover:text-activeRed transition-colors">Live Predictor</a></li>' +
                        '<li><a href="about.html" class="hover:text-activeRed transition-colors">About Us &amp; Methodology</a></li>' +
                        '<li><a href="contact.html" class="hover:text-activeRed transition-colors">Contact Us</a></li>' +
                    '</ul></div>' +
                '<div><h2 class="text-xs font-bold text-white uppercase tracking-wider mb-4">Account</h2>' +
                    '<ul class="space-y-2 text-xs text-gray-400">' +
                        '<li><button type="button" data-open-modal="loginModal" class="hover:text-activeRed transition-colors text-left">Sign In</button></li>' +
                        '<li><button type="button" data-open-modal="registerModal" class="hover:text-activeRed transition-colors text-left">Create Account</button></li>' +
                    '</ul></div>' +
                '<div><h2 class="text-xs font-bold text-white uppercase tracking-wider mb-4">Transparency</h2>' +
                    '<ul class="space-y-2 text-xs text-gray-400">' +
                        '<li><a href="about.html#method" class="hover:text-activeRed transition-colors">How Predictions Are Made</a></li>' +
                        '<li><a href="about.html#performance" class="hover:text-activeRed transition-colors">Model Performance</a></li>' +
                        '<li><a href="contact.html" class="hover:text-activeRed transition-colors">Support &amp; Feedback</a></li>' +
                    '</ul></div>' +
            '</div>' +
            '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 border-t border-sportBorder/40 text-center text-xs text-gray-400">' +
                '&copy; 2026 ScoreLine (Pitch Analytics). All rights reserved. For analytical insight, not betting advice.' +
            '</div>' +
        '</footer>';

    function modal(id, title, subtitle, fieldsHtml, submitLabel) {
        return '<div id="' + id + '" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] hidden items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="' + id + 'Title">' +
            '<div class="glass-panel w-full max-w-md p-6 sm:p-8 rounded-2xl border border-activeRed/40 shadow-red-glow relative">' +
                '<button type="button" data-close-modal="' + id + '" class="absolute top-4 right-4 w-9 h-9 inline-flex items-center justify-center text-gray-400 hover:text-white text-xl" aria-label="Close dialog"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
                '<div class="text-center mb-6">' +
                    '<h2 id="' + id + 'Title" class="text-2xl font-black text-white uppercase italic">' + title + '</h2>' +
                    '<p class="text-xs text-gray-400 mt-1">' + subtitle + '</p>' +
                '</div>' +
                '<form class="space-y-4" data-auth-form novalidate>' + fieldsHtml +
                    '<p class="hidden text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg p-3" role="status" data-auth-note>' +
                        'Accounts aren’t connected to the backend yet, so nothing was saved. You can use the predictor without an account.</p>' +
                    '<button type="submit" class="w-full py-3.5 bg-ctaRed hover:bg-ctaRedHover text-white font-bold rounded-lg uppercase tracking-wider text-xs shadow-red-glow transition-all">' + submitLabel + '</button>' +
                '</form>' +
            '</div></div>';
    }
    function field(id, label, type, placeholder, autocomplete) {
        return '<div><label for="' + id + '" class="block text-xs font-semibold text-gray-300 uppercase mb-1">' + label + '</label>' +
            '<input id="' + id + '" type="' + type + '" required placeholder="' + placeholder + '" autocomplete="' + autocomplete + '" class="w-full bg-sportCard border border-sportBorder rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-activeRed"></div>';
    }

    var modals =
        modal('loginModal', 'Welcome Back', 'Sign in to access your account',
            field('loginEmail', 'Username or Email', 'text', 'analyst@scoreline.com', 'username') +
            field('loginPassword', 'Password', 'password', '••••••••', 'current-password'),
            'Sign In') +
        modal('registerModal', 'Create Account', 'Join ScoreLine today',
            '<div class="grid grid-cols-2 gap-3">' +
                field('regFirst', 'First Name', 'text', 'Name', 'given-name') +
                field('regLast', 'Last Name', 'text', 'Surname', 'family-name') +
            '</div>' +
            field('regEmail', 'Email Address', 'email', 'analyst@scoreline.com', 'email') +
            field('regPassword', 'Password', 'password', '••••••••', 'new-password'),
            'Register Account');

    // ---- Render ----
    var headerSlot = document.getElementById('site-header');
    if (headerSlot) headerSlot.outerHTML = header;

    function renderFooter() {
        var footerSlot = document.getElementById('site-footer');
        if (footerSlot) footerSlot.outerHTML = footer;
        document.body.insertAdjacentHTML('beforeend', modals);

        if (location.protocol === 'file:') {
            document.body.insertAdjacentHTML('afterbegin',
                '<div role="alert" class="bg-amber-500 text-black text-sm font-semibold text-center px-4 py-3">' +
                'You opened this page from the file system. Predictions and the contact form need a local web server: run <code>.\\serve.ps1</code> and open http://localhost:5500/ (see README).</div>');
        }
        wireUp();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderFooter);
    else renderFooter();

    // ---- Behaviour ----
    var lastFocus = null;
    function openModal(id) {
        var m = document.getElementById(id);
        if (!m) return;
        closeMobileMenu();
        lastFocus = document.activeElement;
        m.classList.remove('hidden');
        m.classList.add('flex');
        var note = m.querySelector('[data-auth-note]');
        if (note) note.classList.add('hidden');
        var first = m.querySelector('input');
        if (first) first.focus();
    }
    function closeModal(id) {
        var m = document.getElementById(id);
        if (!m || m.classList.contains('hidden')) return;
        m.classList.add('hidden');
        m.classList.remove('flex');
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function closeMobileMenu() {
        var menu = document.getElementById('mobileMenu');
        var btn = document.getElementById('mobileMenuBtn');
        if (!menu || menu.classList.contains('hidden')) return;
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Open menu');
        btn.innerHTML = '<i class="fa-solid fa-bars text-lg" aria-hidden="true"></i>';
    }

    function wireUp() {
        document.addEventListener('click', function (e) {
            var opener = e.target.closest('[data-open-modal]');
            if (opener) { openModal(opener.getAttribute('data-open-modal')); return; }
            var closer = e.target.closest('[data-close-modal]');
            if (closer) { closeModal(closer.getAttribute('data-close-modal')); return; }
            if (e.target.matches('[role="dialog"]')) closeModal(e.target.id);
            if (e.target.closest('#mobileMenu a')) closeMobileMenu();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeModal('loginModal');
                closeModal('registerModal');
                closeMobileMenu();
            }
            // Keep focus inside an open dialog
            if (e.key === 'Tab') {
                var open = document.querySelector('[role="dialog"].flex');
                if (!open) return;
                var f = open.querySelectorAll('button, input, a[href]');
                if (!f.length) return;
                var first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });

        document.querySelectorAll('[data-auth-form]').forEach(function (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                if (!form.checkValidity()) { form.reportValidity(); return; }
                form.querySelector('[data-auth-note]').classList.remove('hidden');
            });
        });

        var btn = document.getElementById('mobileMenuBtn');
        if (btn) btn.addEventListener('click', function () {
            var menu = document.getElementById('mobileMenu');
            var willOpen = menu.classList.contains('hidden');
            if (!willOpen) { closeMobileMenu(); return; }
            menu.classList.remove('hidden');
            btn.setAttribute('aria-expanded', 'true');
            btn.setAttribute('aria-label', 'Close menu');
            btn.innerHTML = '<i class="fa-solid fa-xmark text-lg" aria-hidden="true"></i>';
        });

        // Keyboard/touch support for the Predictor dropdown toggle
        document.querySelectorAll('[data-dropdown]').forEach(function (dd) {
            var toggle = dd.querySelector('[data-dropdown-toggle]');
            var menu = dd.querySelector('[data-dropdown-menu]');
            function set(open) {
                toggle.setAttribute('aria-expanded', String(open));
                menu.classList.toggle('visible', open);
                menu.classList.toggle('opacity-100', open);
            }
            toggle.addEventListener('click', function () { set(toggle.getAttribute('aria-expanded') !== 'true'); });
            dd.addEventListener('focusout', function (e) { if (!dd.contains(e.relatedTarget)) set(false); });
            dd.addEventListener('keydown', function (e) { if (e.key === 'Escape') { set(false); toggle.focus(); } });
        });
    }

    window.ScoreLineLayout = { openModal: openModal, closeModal: closeModal };
})();
