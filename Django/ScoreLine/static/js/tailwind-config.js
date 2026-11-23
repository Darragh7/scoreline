/* Shared Tailwind (Play CDN) theme for every ScoreLine page.
   Load AFTER https://cdn.tailwindcss.com and BEFORE any page markup is styled. */
tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                sportDark: '#0b0c10',
                sportCard: '#16181d',
                sportBorder: '#262930',
                activeRed: '#ff1744',
                glowRed: '#ff2a2a',
                darkRed: '#800a20',
                // Slightly deeper red for solid buttons so white label text meets WCAG AA (5.2:1).
                ctaRed: '#d6153b',
                ctaRedHover: '#b8102f',
                // Outcome colours (always paired with text labels, never colour alone)
                outHome: '#ff1744',
                outDraw: '#9ca3af',
                outAway: '#e5e7eb',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                display: ['Impact', 'Teko', 'sans-serif'],
            },
            boxShadow: {
                'red-glow': '0 0 25px -5px rgba(255, 23, 68, 0.5)',
                'red-glow-lg': '0 0 40px 2px rgba(255, 23, 68, 0.6)',
                'card-glow': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
            }
        }
    }
};
