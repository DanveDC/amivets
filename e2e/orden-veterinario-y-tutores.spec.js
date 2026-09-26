// @ts-check
// Orden con veterinario asignado, veterinario en el Panel del día, sección
// Propietarios y todas las mascotas de un tutor (orden-veterinario-y-tutores).
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  TEST_USER_PASSWORD,
  getAdminToken,
  authHeaders,
  createTestPropietario,
  createTestMascota,
  createTestVeterinario,
  createTestOrden,
  gotoSection,
} = require('./helpers');

async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Orden con veterinario asignado', () => {
  test('el admin abre una orden asignando un veterinario y ese veterinario la ve en su panel', async ({ page, request, browser }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await page.locator('.av-launcher-card[data-target="sec-hoy"]').click();
    await page.click('#btnHoyNuevaOrden');
    await page.fill('#selectorMascotaSearch', mascota.nombre.split(' ')[0]);
    await page.locator('#selectorMascotaResultados .pd-waiting-row', { hasText: mascota.nombre.split(' ')[0] }).first().click();
    await expect(page.locator('#modalAbrirOrden')).toBeVisible();

    // Sin veterinario no se abre.
    await page.click('#btnConfirmarAbrirOrden');
    await expect(page.locator('.notification-toast', { hasText: /Elegí el veterinario/ }).first()).toBeVisible();
    const sinOrden = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(sinOrden).toHaveLength(0);

    await page.selectOption('#abrirOrdenVeterinario', String(vet.id));
    await page.fill('#abrirOrdenMotivo', 'Control anual');
    await page.click('#btnConfirmarAbrirOrden');
    await expect(page.locator('#sec-orden-abierta')).toBeVisible();

    const [orden] = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(orden.veterinario_id).toBe(vet.id);
    expect(orden.motivo_visita).toBe('Control anual');

    // Panel del día: columna Veterinario.
    await gotoSection(page, 'sec-hoy');
    await expect(page.locator(`tr[data-orden-id="${orden.id}"]`)).toContainText(vet.username, { timeout: 15000 });

    // El veterinario la ve en su propio panel.
    const ctx = await browser.newContext();
    const vetPage = await ctx.newPage();
    try {
      await loginUI(vetPage, vet.username, TEST_USER_PASSWORD);
      await vetPage.locator('.av-launcher-card[data-target="sec-hoy"]').click();
      await expect(vetPage.locator(`tr[data-orden-id="${orden.id}"]`)).toBeVisible({ timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });

  test('el veterinario de una orden se cambia desde la pantalla de la orden', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vetA = await createTestVeterinario(request, admin);
    const vetB = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vetA.id }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await page.locator('.av-launcher-card[data-target="sec-hoy"]').click();
    await page.locator(`tr[data-orden-id="${orden.id}"]`).click();
    const select = page.locator('#oaVeterinarioSelect');
    await expect(select).toHaveValue(String(vetA.id), { timeout: 15000 });
    await select.selectOption(String(vetB.id));
    await expect(page.locator('.notification-toast', { hasText: /Veterinario asignado/ }).first()).toBeVisible();
    const actual = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(admin) })).json();
    expect(actual.veterinario_id).toBe(vetB.id);
  });
});

test.describe('Propietarios y sus mascotas', () => {
  test('Propietarios tiene entrada propia en el menú', async ({ page }) => {
    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-mascotas');
    const item = page.locator('.av-sidebar [data-target="sec-propietarios"]');
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator('#sec-propietarios')).toBeVisible();
  });

  test('un tutor con varias mascotas las muestra todas, desde Propietarios y desde la búsqueda global', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    for (let i = 0; i < 3; i++) await createTestMascota(request, prop.id);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);

    // Búsqueda global: elegir el tutor lleva a sus mascotas.
    await page.locator('#cmdkTrigger').click();
    await page.locator('.av-cmdk-input').fill(prop.nombre);
    const opcion = page.locator('.av-cmdk-item', { hasText: prop.nombre }).filter({ hasText: 'Cédula' }).first();
    await expect(opcion).toBeVisible({ timeout: 10000 });
    await opcion.click();
    await expect(page.locator('#consultorioMascotasList .pet-list-item')).toHaveCount(3, { timeout: 15000 });

    // Desde el listado de Propietarios.
    await gotoSection(page, 'sec-propietarios');
    await page.fill('#searchPropietario', prop.nombre);
    await page.locator(`button[onclick^="verMascotasPropietario(${prop.id},"]`).click();
    await expect(page.locator('#consultorioMascotasList .pet-list-item')).toHaveCount(3, { timeout: 15000 });
  });

  test('los selectores de propietario piden todos los propietarios, no los primeros 100', async ({ page }) => {
    const pedidos = [];
    page.on('request', (r) => { if (r.url().includes('/api/propietarios/')) pedidos.push(r.url()); });
    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-mascotas');
    await page.click('#btnNuevaMascotaListado');
    await expect(page.locator('#modalMascota')).toBeVisible();
    const sinLimite = pedidos.filter((u) => /\/api\/propietarios\/(\?(?!.*limit=)|$)/.test(u));
    expect(sinLimite, `pedidos sin limit: ${sinLimite.join(', ')}`).toHaveLength(0);
    expect(pedidos.some((u) => u.includes('limit=1000'))).toBe(true);
  });
});
