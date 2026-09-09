// core/theme.js — light / dark theme toggle.
//
// The no-FOUC snippet in index.html <head> already stamped
// document.documentElement.dataset.theme from localStorage before first paint.
// This module keeps the #themeToggle control in the user menu in sync and
// persists the choice. Three states: explicit "light", explicit "dark", or
// unset = follow the OS (prefers-color-scheme, handled in themes.css).

const KEY = 'amivets-theme';
const mql = window.matchMedia('(prefers-color-scheme: dark)');

/** The theme actually being rendered right now. */
function effectiveTheme() {
    const attr = document.documentElement.dataset.theme;
    if (attr === 'light' || attr === 'dark') return attr;
    return mql.matches ? 'dark' : 'light';
}

function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
        document.documentElement.dataset.theme = theme;
        try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode */ }
    } else {
        delete document.documentElement.dataset.theme;
        try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    }
    syncControl();
}

function syncControl() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const isDark = effectiveTheme() === 'dark';
    // The button flips to the *other* theme.
    const label = btn.querySelector('[data-theme-label]');
    const icon = btn.querySelector('[data-theme-icon]');
    btn.setAttribute('aria-pressed', String(!isDark));
    if (label) label.textContent = isDark ? 'Tema claro' : 'Tema oscuro';
    if (icon) icon.className = 'ph ' + (isDark ? 'ph-sun' : 'ph-moon');
    btn.setAttribute('aria-label', isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
}

export function init() {
    syncControl();

    const btn = document.getElementById('themeToggle');
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            apply(effectiveTheme() === 'dark' ? 'light' : 'dark');
            // close the <details> menu after choosing
            btn.closest('details.av-usermenu')?.removeAttribute('open');
        });
    }

    // If the user never made an explicit choice, follow the OS as it changes.
    mql.addEventListener('change', () => {
        let stored = null;
        try { stored = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
        if (stored !== 'light' && stored !== 'dark') syncControl();
    });
}
