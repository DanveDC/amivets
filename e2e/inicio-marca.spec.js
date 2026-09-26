// @ts-check
// Pantalla de inicio con la marca de AmiVets y cabecera sin textos de otra
// sección (inicio-marca-cabecera).
const { test, expect } = require('@playwright/test');
const { ADMIN_CREDENTIALS } = require('./helpers');

async function loginAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Inicio — marca y cabecera', () => {
  test('el inicio muestra el logo y "AMIVETS · Sistema integral de gestión"', async ({ page }) => {
    await loginAdmin(page);
    const marca = page.locator('#inicioMarca');
    await expect(marca).toBeVisible();
    await expect(marca).toContainText('AMIVETS');
    await expect(marca).toContainText('Sistema integral de gestión');
    const logo = marca.locator('img');
    await expect(logo).toHaveAttribute('src', /logo-amivets\.png$/);
    expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  });

  test('al volver al inicio desde el Panel del día la cabecera no muestra su texto', async ({ page }) => {
    await loginAdmin(page);
    await page.locator('.av-launcher-card[data-target="sec-hoy"]').click();
    await expect(page.locator('#avHeaderTitleText')).toHaveText('Panel del día');
    await page.locator('.av-sidebar-brand').click();
    await expect(page.locator('#sec-inicio')).toBeVisible();
    await expect(page.locator('#avHeaderTitleText')).toHaveText('AMIVETS');
    await expect(page.locator('#avHeaderSubtitleText')).toHaveText('Sistema integral de gestión');
  });
});
