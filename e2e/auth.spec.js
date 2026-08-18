// Unidad A — Autenticación (static/js/auth.js, static/templates/login.html, index.html)
//
// Covers: login OK, login KO with clear error, admin menu visible only for
// admins (checkAdminAccess, commit ec1645a), logout invalidates access.

const { test, expect } = require('@playwright/test');
const { ADMIN_CREDENTIALS } = require('./helpers');

const DOCTOR_CREDENTIALS = { username: 'dr_pérez', password: 'doctor123' };

test.describe('Autenticación', () => {
  test.afterEach(async ({ page }) => {
    // Never leave a logged-in session behind for the next test.
    await page.evaluate(() => localStorage.clear()).catch(() => {});
  });

  test('login con credenciales correctas entra al dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', ADMIN_CREDENTIALS.username);
    await page.fill('#password', ADMIN_CREDENTIALS.password);
    await page.click('#btnLogin');

    await page.waitForURL('**/');
    await expect(page.locator('body')).toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
  });

  test('login con credenciales incorrectas falla con mensaje claro', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', ADMIN_CREDENTIALS.username);
    await page.fill('#password', 'contraseña-incorrecta');
    await page.click('#btnLogin');

    const error = page.locator('#loginError');
    await expect(error).toBeVisible();
    await expect(error).toHaveText(/usuario o contraseña incorrectos/i);

    // Never navigated away, no token stored.
    await expect(page).toHaveURL(/login/);
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeFalsy();
  });

  test('el menú de administración aparece solo para usuarios admin', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', ADMIN_CREDENTIALS.username);
    await page.fill('#password', ADMIN_CREDENTIALS.password);
    await page.click('#btnLogin');
    await page.waitForURL('**/');

    const adminNav = page.locator('.nav-link.admin-only[data-target="sec-usuarios"], .menu-item.admin-only[data-target="sec-usuarios"]');
    await expect(adminNav).toBeVisible();
  });

  test('un usuario no-admin no ve el menú de administración', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', DOCTOR_CREDENTIALS.username);
    await page.fill('#password', DOCTOR_CREDENTIALS.password);
    await page.click('#btnLogin');
    await page.waitForURL('**/');

    const adminNav = page.locator('.menu-item.admin-only[data-target="sec-usuarios"]');
    // Element exists in the DOM but must stay hidden (display:none) for non-admins.
    await expect(adminNav).toBeHidden();
  });

  test('cerrar sesión invalida el acceso', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', ADMIN_CREDENTIALS.username);
    await page.fill('#password', ADMIN_CREDENTIALS.password);
    await page.click('#btnLogin');
    await page.waitForURL('**/');

    await page.evaluate(() => window.logout());
    await page.waitForURL('**/login.html');

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeFalsy();

    // Visiting the dashboard again without a token must bounce back to login.
    await page.goto('/');
    await page.waitForURL('**/login.html');
  });
});
