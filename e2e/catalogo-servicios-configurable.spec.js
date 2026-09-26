// @ts-check
// Armado de servicios del catálogo: categoría nueva, área, adjunto, costo de
// insumos por unidad base y precio base desde ese costo
// (catalogo-servicios-configurable).
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestProduct,
  createTestArea,
  createTestCatalogoServicio,
  gotoSection,
} = require('./helpers');

async function loginAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Catálogo configurable', () => {
  test('crea un servicio con categoría nueva, área y adjunto obligatorio desde la UI', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const area = await createTestArea(request, admin, { nombre: testTag('Hospitalizacion') });
    const nombre = testTag('Internacion');
    const categoria = testTag('HOSP FELINA').toUpperCase().slice(0, 60);

    await loginAdmin(page);
    await gotoSection(page, 'sec-catalogo');
    await page.getByRole('button', { name: '+ Nuevo servicio' }).click();
    await expect(page.locator('#modalCatalogoServicio')).toBeVisible();
    await page.fill('#catalogoNombre', nombre);
    await page.selectOption('#catalogoCategoria', '__nueva__');
    await expect(page.locator('#catalogoCategoriaNueva')).toBeVisible();
    await page.fill('#catalogoCategoriaNueva', categoria);
    await page.selectOption('#catalogoArea', String(area.id));
    await page.selectOption('#catalogoAdjunto', 'si');
    await page.fill('#catalogoPrecioRef', '1500');
    await page.locator('#formCatalogoServicio button[type="submit"]').click();
    await expect(page.locator('#modalCatalogoServicio')).toBeHidden({ timeout: 10000 });

    const lista = await (await request.get(`/api/catalogo/?search=${encodeURIComponent(nombre)}`, { headers: authHeaders(admin) })).json();
    const creado = lista.find((s) => s.nombre === nombre);
    expect(creado).toBeTruthy();
    expect(creado.categoria).toBe(categoria);
    expect(creado.area_id).toBe(area.id);
    expect(creado.requiere_adjunto).toBe(true);
    const cats = await (await request.get('/api/catalogo/categorias', { headers: authHeaders(admin) })).json();
    expect(cats).toContain(categoria);
  });

  test('el costo de insumos se calcula por unidad base y se usa como precio base', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    // Envase de 1000 ml a 20: 50 ml cuestan 1.00.
    const material = await createTestProduct(request, {
      categoria: 'Insumo', tipo_item: 'MATERIAL', unidad_medida: 'ml', contenido_por_envase: 1000, stock_actual: 5000, precio_unitario: 20,
    }, admin);
    const s = await createTestCatalogoServicio(request, { categoria: 'PELUQUERIA', precio_ref: 300, nombre: testTag('Bano') });
    const rec = await request.post(`/api/catalogo/${s.id}/recetas`, {
      headers: authHeaders(admin), data: { inventario_id: material.id, cantidad: 50, unidad_medida: 'ml' },
    });
    expect(rec.ok()).toBeTruthy();

    const costo = await (await request.get(`/api/catalogo/${s.id}/costo`, { headers: authHeaders(admin) })).json();
    expect(costo.total).toBeCloseTo(1, 2);
    expect(costo.lineas[0].costo_unitario).toBeCloseTo(0.02, 4);

    await loginAdmin(page);
    await gotoSection(page, 'sec-catalogo');
    await page.locator(`.cat-item[data-id="${s.id}"]`).click();
    await expect(page.locator('#catCostoInsumos')).toContainText('1,00');
    page.once('dialog', (d) => d.accept());
    await page.click('#btnCatUsarCosto');
    await expect(page.locator('.notification-toast', { hasText: /Precio base actualizado/ }).first()).toBeVisible();
    const actualizado = await (await request.get(`/api/catalogo/${s.id}`, { headers: authHeaders(admin) })).json();
    expect(actualizado.precio_ref).toBeCloseTo(1, 2);
  });
});
