// Unidad A — Autenticación (static/js/auth.js, static/templates/login.html, index.html)
//
// Covers: login OK, login KO with clear error, admin menu visible only for
// admins (checkAdminAccess, commit ec1645a), logout invalidates access.

const { test, expect } = require('@playwright/test');
const { ADMIN_CREDENTIALS, getAdminToken, createTestUser, deleteTestUser } = require('./helpers');

const DOCTOR_PASSWORD = 'doctor123';

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

    // The admin-only entry now lives inside the user-menu dropdown.
    await page.locator('.av-usermenu > summary').click();
    const adminNav = page.locator('.av-usermenu [data-target="sec-usuarios"]');
    await expect(adminNav).toBeVisible();
  });

  test('un usuario no-admin no ve el menú de administración', async ({ page, request }) => {
    // No depende de un usuario sembrado por seed_data.py (dr_pérez, ya no
    // se crea automáticamente) — arma su propio veterinario descartable.
    const token = await getAdminToken(request);
    const doctor = await createTestUser(request, token, { role: 'veterinario', password: DOCTOR_PASSWORD });

    try {
      await page.goto('/login');
      await page.fill('#username', doctor.username);
      await page.fill('#password', DOCTOR_PASSWORD);
      await page.click('#btnLogin');
      await page.waitForURL('**/');

      const adminNav = page.locator('.av-usermenu [data-target="sec-usuarios"]');
      // The router prunes the admin-only entry from the DOM for non-admins.
      await expect(adminNav).toHaveCount(0);
    } finally {
      await deleteTestUser(request, token, doctor.id);
    }
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
