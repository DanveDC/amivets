// Unidad A — Gestión de inventario (static/js/app.js + backend/app/routers/inventario.py)
//
// inventario.spec.js sólo cubre POST /{id}/movimiento. Acá se llenan los
// huecos:
//   - alta por UI     (handleProductoSubmit -> POST /api/inventario/)
//   - edición por UI  (handleEditarProductoSubmit -> PUT /api/inventario/{id})
//   - baja por UI     (confirmarEliminarProducto -> DELETE /api/inventario/{id})
//   - GET /api/inventario/{id}
//   - GET /api/inventario/alertas-stock  (producto bajo su stock_minimo)
//
// Toda mutación por UI se contrasta con un GET a la API. Nada se mockea.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  testTag,
  createTestProduct,
  deleteTestProduct,
} = require('./helpers');

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe.serial('Gestión de inventario — huecos no cubiertos por inventario.spec.js', () => {
  const S = { token: null, uiProd: null, lowProd: null, codigo: null };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.codigo = testTag('SKU').slice(0, 40);
  });

  test.afterAll(async ({ request }) => {
    if (S.uiProd?.id) await deleteTestProduct(request, S.uiProd.id);
    if (S.lowProd?.id) await deleteTestProduct(request, S.lowProd.id);
  });

  test('alta por UI: el modal "Nuevo Producto" crea el producto (contrastado por API + GET /{id})', async ({ page, request }) => {
    const nombre = testTag('prodUI');

    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-inventario"]');
    await page.click('#btnNuevoProducto');
    await expect(page.locator('#modalProducto')).toBeVisible();

    await page.fill('#prodCodigo', S.codigo);
    await page.selectOption('#prodTipo', 'Insumo');
    await page.fill('#prodNombre', nombre);
    await page.fill('#prodDescripcion', 'PWTEST insumo de prueba');
    await page.fill('#prodStock', '8');
    await page.fill('#prodMinimo', '3');
    await page.fill('#prodPrecio', '1500');
    await page.fill('#prodProveedor', 'PWTEST Proveedor');
    await page.click('#formProducto button[type="submit"]');
    await expect(page.locator('#modalProducto')).toBeHidden();

    // handleProductoSubmit llama loadInventario(): la fila ya está en la tabla.
    await page.fill('#searchInventario', S.codigo);
    await expect(page.locator('#inventarioTableBody')).toContainText(nombre);

    // Contraste API: aparece en el listado y en GET /{id}.
    const items = await (await request.get('/api/inventario/?limit=500')).json();
    const creado = items.find((p) => p.codigo === S.codigo);
    expect(creado, 'el producto creado por UI debe aparecer en la API').toBeTruthy();
    expect(creado.nombre).toBe(nombre);
    expect(creado.categoria).toBe('Insumo');
    expect(creado.stock_actual).toBe(8);
    expect(creado.stock_minimo).toBe(3);
    expect(creado.precio_unitario).toBeCloseTo(1500, 2);
    S.uiProd = creado;

    const getRes = await request.get(`/api/inventario/${S.uiProd.id}`);
    expect(getRes.ok()).toBeTruthy();
    expect((await getRes.json()).proveedor).toBe('PWTEST Proveedor');

    // GET /{id} inexistente -> 404.
    const missing = await request.get('/api/inventario/99999999');
    expect(missing.status()).toBe(404);
  });

  test('edición por UI: cambia nombre, precio y stock_minimo; el código y el stock no se tocan', async ({ page, request }) => {
    const nuevoNombre = `${S.uiProd.nombre}_edit`;

    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-inventario"]');
    await page.fill('#searchInventario', S.codigo);
    await expect(page.locator('#inventarioTableBody')).toContainText(S.uiProd.nombre);

    await page.click(`#inventarioTableBody tr:has-text("${S.codigo}") button[title="Editar"]`);
    await expect(page.locator('#modalEditarProducto')).toBeVisible();
    // abrirEditarProducto(id) prellena el form.
    await expect(page.locator('#editProdNombre')).toHaveValue(S.uiProd.nombre);
    await expect(page.locator('#editProdCodigo')).toHaveValue(S.codigo);

    await page.fill('#editProdNombre', nuevoNombre);
    await page.fill('#editProdPrecio', '2750');
    // stock_minimo por encima del stock_actual (8) -> lo deja como bajo stock,
    // lo que se aprovecha en el test de alertas-stock.
    await page.fill('#editProdMinimo', '50');
    await page.click('#formEditarProducto button[type="submit"]');
    await expect(page.locator('#modalEditarProducto')).toBeHidden();

    // Contraste API.
    const actualizado = await (await request.get(`/api/inventario/${S.uiProd.id}`)).json();
    expect(actualizado.nombre).toBe(nuevoNombre);
    expect(actualizado.precio_unitario).toBeCloseTo(2750, 2);
    expect(actualizado.stock_minimo).toBe(50);
    expect(actualizado.codigo).toBe(S.codigo); // readonly, intacto
    expect(actualizado.stock_actual).toBe(8); // readonly, intacto
    S.uiProd = actualizado;
  });

  test('GET /alertas-stock y ?bajo_stock=true traen los productos en o bajo el mínimo', async ({ request }) => {
    // Producto claramente por debajo del mínimo, creado por API.
    S.lowProd = await createTestProduct(request, { stock_actual: 1, stock_minimo: 9, precio_unitario: 10 });
    // Producto claramente bien surtido (control negativo).
    const okProd = await createTestProduct(request, { stock_actual: 80, stock_minimo: 5, precio_unitario: 10 });

    try {
      const alertas = await (await request.get('/api/inventario/alertas-stock')).json();
      expect(Array.isArray(alertas)).toBe(true);
      for (const p of alertas) expect(p.stock_actual).toBeLessThanOrEqual(p.stock_minimo);

      // El producto bajo mínimo (API) y el editado por UI (min 50 > stock 8) aparecen.
      expect(alertas.some((p) => p.id === S.lowProd.id)).toBe(true);
      expect(alertas.some((p) => p.id === S.uiProd.id)).toBe(true);
      // El bien surtido, no.
      expect(alertas.some((p) => p.id === okProd.id)).toBe(false);

      // El filtro equivalente del listado general.
      const bajoStock = await (await request.get('/api/inventario/?limit=500&bajo_stock=true')).json();
      expect(bajoStock.some((p) => p.id === S.lowProd.id)).toBe(true);
      expect(bajoStock.some((p) => p.id === okProd.id)).toBe(false);
    } finally {
      await deleteTestProduct(request, okProd.id);
    }
  });

  test('baja por UI: confirmarEliminarProducto desactiva el producto (borrado lógico)', async ({ page, request }) => {
    page.on('dialog', (d) => d.accept()); // confirmarEliminarProducto pide confirm()

    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-inventario"]');
    await page.fill('#searchInventario', S.codigo);
    const row = page.locator(`#inventarioTableBody tr:has-text("${S.codigo}")`);
    await expect(row).toBeVisible();
    await row.locator('button[title="Desactivar"]').click();

    await expect(page.locator('#inventarioTableBody')).not.toContainText(S.codigo);

    // Contraste API: sigue existiendo con activo=false; ausente del listado (sólo activos).
    const getRes = await request.get(`/api/inventario/${S.uiProd.id}`);
    expect(getRes.ok()).toBeTruthy();
    expect((await getRes.json()).activo).toBe(false);

    const activos = await (await request.get('/api/inventario/?limit=500')).json();
    expect(activos.some((p) => p.id === S.uiProd.id)).toBe(false);

    S.uiProd = null; // ya desactivado; nada que limpiar

    // DELETE sobre id inexistente -> 404.
    const missing = await request.delete('/api/inventario/99999999');
    expect(missing.status()).toBe(404);
  });
});
