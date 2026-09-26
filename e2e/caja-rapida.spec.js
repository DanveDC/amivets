// @ts-check
// Caja rápida (caja-rapida): venta de mostrador sin registrar cliente.
//
//   POST /api/caja-rapida/ventas → factura PAGADA en un solo paso; orden
//        FACTURADA con origen CAJA_RAPIDA; sin propietario_id se factura a
//        "Consumidor final".
//   GET  /api/caja-rapida/items?q= → productos (PRODUCTO) y servicios sin área.
//
// Cada test crea sus propios productos/servicios y anula las facturas que
// deja, para devolver el stock y no ensuciar la base compartida.
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  TEST_USER_PASSWORD,
  getAdminToken,
  authHeaders,
  testTag,
  createTestProduct,
  deleteTestProduct,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  createTestArea,
  desactivarTestArea,
  createTestPropietario,
  deleteTestPropietario,
  createTestVeterinario,
  createTestRecepcionista,
  deleteTestUser,
  loginAs,
  anularTestFactura,
  ventaRapida,
  buscarItemsCaja,
  gotoSection,
} = require('./helpers');

async function stockOf(request, token, id) {
  const res = await request.get(`/api/inventario/${id}`, { headers: authHeaders(token) });
  expect(res.ok()).toBeTruthy();
  return Number((await res.json()).stock_actual);
}

test.describe('Caja rápida — API', () => {
  /** @type {string} */
  let token;
  /** Facturas a anular al final de cada test (devuelve stock). */
  let facturas = [];
  /** Limpiezas best-effort a correr al final de cada test. */
  let limpiezas = [];

  test.beforeEach(async ({ request }) => {
    token = await getAdminToken(request);
    facturas = [];
    limpiezas = [];
  });

  test.afterEach(async ({ request }) => {
    for (const id of facturas) await anularTestFactura(request, id, token);
    for (const fn of limpiezas.reverse()) await fn();
  });

  async function producto(request, overrides = {}) {
    const p = await createTestProduct(request, { precio_unitario: 250, stock_actual: 10, ...overrides }, token);
    limpiezas.push(() => deleteTestProduct(request, p.id, token));
    return p;
  }

  async function servicio(request, overrides = {}) {
    const s = await createTestCatalogoServicio(request, { categoria: 'PELUQUERIA', precio_ref: 800, ...overrides });
    limpiezas.push(() => deleteTestCatalogoServicio(request, s.id, token));
    return s;
  }

  async function vender(request, body, t = token) {
    const res = await ventaRapida(request, body, t);
    if (res.status() === 201) {
      const json = await res.json();
      facturas.push(json.id);
      return { res, json };
    }
    return { res, json: null };
  }

  test('vende un producto y un servicio: factura PAGADA, baja el stock y la orden queda FACTURADA', async ({ request }) => {
    const prop = await createTestPropietario(request, {}, token);
    limpiezas.push(() => deleteTestPropietario(request, prop.id, token));
    const p = await producto(request);
    const s = await servicio(request);

    const { res, json } = await vender(request, {
      propietario_id: prop.id,
      metodo_pago: 'EFECTIVO',
      items: [
        { tipo: 'PRODUCTO', id: p.id, cantidad: 2 },
        { tipo: 'SERVICIO', id: s.id, cantidad: 1 },
      ],
    });
    expect(res.status()).toBe(201);
    expect(json.estado).toBe('PAGADA');
    expect(json.detalles).toHaveLength(2);
    expect(json.total).toBeCloseTo(2 * 250 + 800, 2);
    expect(json.total_pagado).toBeCloseTo(json.total, 2);
    expect(json.saldo_pendiente).toBe(0);
    expect(json.metodo_pago).toBe('EFECTIVO');
    expect(await stockOf(request, token, p.id)).toBe(8);

    const ordenes = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(token) })).json();
    expect(ordenes).toHaveLength(1);
    expect(ordenes[0].estado).toBe('FACTURADA');
    expect(ordenes[0].origen).toBe('CAJA_RAPIDA');
    expect(ordenes[0].mascota_id).toBeNull();
    const detalle = await (await request.get(`/api/ordenes/${ordenes[0].id}`, { headers: authHeaders(token) })).json();
    expect(detalle.servicios).toHaveLength(1);
    expect(detalle.servicios[0].estado).toBe('EJECUTADO');
    expect(detalle.servicios[0].facturado).toBe(true);
  });

  test('sin ítems o con un método de pago inválido responde 422', async ({ request }) => {
    const p = await producto(request);
    expect((await vender(request, { metodo_pago: 'EFECTIVO', items: [] })).res.status()).toBe(422);
    expect((await vender(request, { items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 1 }] })).res.status()).toBe(422);
    expect((await vender(request, { metodo_pago: 'BITCOIN', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 1 }] })).res.status()).toBe(422);
    expect(await stockOf(request, token, p.id)).toBe(10);
  });

  test('si un producto no tiene stock no queda nada a medias (409, sin factura ni orden, stock intacto)', async ({ request }) => {
    const prop = await createTestPropietario(request, {}, token);
    limpiezas.push(() => deleteTestPropietario(request, prop.id, token));
    const ok = await producto(request);
    const sinStock = await producto(request, { stock_actual: 1 });
    const s = await servicio(request);

    const { res } = await vender(request, {
      propietario_id: prop.id,
      metodo_pago: 'EFECTIVO',
      items: [
        { tipo: 'PRODUCTO', id: ok.id, cantidad: 3 },
        { tipo: 'SERVICIO', id: s.id, cantidad: 1 },
        { tipo: 'PRODUCTO', id: sinStock.id, cantidad: 5 },
      ],
    });
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain(sinStock.nombre);
    expect(await stockOf(request, token, ok.id)).toBe(10);
    const fact = await (await request.get(`/api/facturas/?propietario_id=${prop.id}&limit=10`, { headers: authHeaders(token) })).json();
    expect(fact).toHaveLength(0);
    const ordenes = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(token) })).json();
    expect(ordenes).toHaveLength(0);
  });

  test('un producto repetido en dos líneas suma para el control de stock', async ({ request }) => {
    const p = await producto(request, { stock_actual: 3 });
    const { res } = await vender(request, {
      metodo_pago: 'EFECTIVO',
      items: [
        { tipo: 'PRODUCTO', id: p.id, cantidad: 2 },
        { tipo: 'PRODUCTO', id: p.id, cantidad: 2 },
      ],
    });
    expect(res.status()).toBe(409);
    expect(await stockOf(request, token, p.id)).toBe(3);
  });

  test('sin propietario factura siempre al mismo "Consumidor final"', async ({ request }) => {
    const p = await producto(request);
    const a = await vender(request, { metodo_pago: 'TARJETA', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 1 }] });
    const b = await vender(request, { metodo_pago: 'TRANSFERENCIA', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 1 }] });
    expect(a.res.status()).toBe(201);
    expect(b.res.status()).toBe(201);
    expect(a.json.propietario_id).toBe(b.json.propietario_id);
    const cf = await (await request.get(`/api/propietarios/${a.json.propietario_id}`, { headers: authHeaders(token) })).json();
    expect(`${cf.nombre} ${cf.apellido}`).toBe('Consumidor final');
  });

  test('con un propietario existente factura a su nombre; con uno inexistente responde 404', async ({ request }) => {
    const prop = await createTestPropietario(request, {}, token);
    limpiezas.push(() => deleteTestPropietario(request, prop.id, token));
    const p = await producto(request);
    const ok = await vender(request, { propietario_id: prop.id, metodo_pago: 'EFECTIVO', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 1 }] });
    expect(ok.res.status()).toBe(201);
    expect(ok.json.propietario_id).toBe(prop.id);

    const nf = await vender(request, { propietario_id: 999999999, metodo_pago: 'EFECTIVO', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 1 }] });
    expect(nf.res.status()).toBe(404);
    expect(await stockOf(request, token, p.id)).toBe(9);
  });

  test('rechaza con 409 un servicio con área y un material', async ({ request }) => {
    const area = await createTestArea(request, token);
    limpiezas.push(() => desactivarTestArea(request, token, area.id));
    const conArea = await servicio(request, { area_id: area.id });
    const material = await producto(request, { tipo_item: 'MATERIAL', categoria: 'Insumo' });

    const r1 = await vender(request, { metodo_pago: 'EFECTIVO', items: [{ tipo: 'SERVICIO', id: conArea.id, cantidad: 1 }] });
    expect(r1.res.status()).toBe(409);
    expect(await r1.res.text()).toContain(conArea.nombre);

    const r2 = await vender(request, { metodo_pago: 'EFECTIVO', items: [{ tipo: 'PRODUCTO', id: material.id, cantidad: 1 }] });
    expect(r2.res.status()).toBe(409);
    expect(await stockOf(request, token, material.id)).toBe(10);
  });

  test('ignora el precio del cliente salvo en servicios de precio variable', async ({ request }) => {
    const p = await producto(request, { precio_unitario: 250 });
    const variable = await servicio(request, { precio_variable: true, precio_ref: 0 });

    const r = await vender(request, {
      metodo_pago: 'EFECTIVO',
      items: [
        { tipo: 'PRODUCTO', id: p.id, cantidad: 1, precio_unitario: 1 },
        { tipo: 'SERVICIO', id: variable.id, cantidad: 1, precio_unitario: 3500 },
      ],
    });
    expect(r.res.status()).toBe(201);
    const linea = (id) => r.json.detalles.find((d) => d.descripcion === id);
    expect(linea(p.nombre).precio_unitario).toBe(250);
    expect(linea(variable.nombre).precio_unitario).toBe(3500);
    expect(r.json.total).toBeCloseTo(3750, 2);

    const sinPrecio = await vender(request, { metodo_pago: 'EFECTIVO', items: [{ tipo: 'SERVICIO', id: variable.id, cantidad: 1 }] });
    expect(sinPrecio.res.status()).toBe(422);
  });

  test('vender un servicio consume los materiales de su receta', async ({ request }) => {
    const material = await producto(request, {
      categoria: 'Insumo', tipo_item: 'MATERIAL', unidad_medida: 'ml',
      contenido_por_envase: 1000, stock_actual: 2000, precio_unitario: 10,
    });
    const s = await servicio(request);
    const rec = await request.post(`/api/catalogo/${s.id}/recetas`, {
      headers: authHeaders(token),
      data: { inventario_id: material.id, cantidad: 50, unidad_medida: 'ml' },
    });
    expect(rec.ok()).toBeTruthy();

    const r = await vender(request, { metodo_pago: 'EFECTIVO', items: [{ tipo: 'SERVICIO', id: s.id, cantidad: 1 }] });
    expect(r.res.status()).toBe(201);
    expect(await stockOf(request, token, material.id)).toBe(1950);
  });

  test('anular la factura de una venta devuelve el stock', async ({ request }) => {
    const p = await producto(request);
    const r = await vender(request, { metodo_pago: 'EFECTIVO', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 4 }] });
    expect(r.res.status()).toBe(201);
    expect(await stockOf(request, token, p.id)).toBe(6);

    const an = await request.post(`/api/facturas/${r.json.id}/anular`, { headers: authHeaders(token) });
    expect(an.ok()).toBeTruthy();
    facturas = facturas.filter((id) => id !== r.json.id);
    expect(await stockOf(request, token, p.id)).toBe(10);
  });

  test('la búsqueda trae productos y servicios vendibles, sin materiales ni servicios con área', async ({ request }) => {
    const tag = testTag('cajaq');
    const area = await createTestArea(request, token);
    limpiezas.push(() => desactivarTestArea(request, token, area.id));
    const p = await producto(request, { nombre: `${tag} producto` });
    const m = await producto(request, { nombre: `${tag} material`, tipo_item: 'MATERIAL', categoria: 'Insumo' });
    const s = await servicio(request, { nombre: `${tag} servicio` });
    const sa = await servicio(request, { nombre: `${tag} con area`, area_id: area.id });

    const res = await buscarItemsCaja(request, tag, token);
    expect(res.ok()).toBeTruthy();
    const items = await res.json();
    const claves = items.map((i) => `${i.tipo}:${i.id}`);
    expect(claves).toContain(`PRODUCTO:${p.id}`);
    expect(claves).toContain(`SERVICIO:${s.id}`);
    expect(claves).not.toContain(`PRODUCTO:${m.id}`);
    expect(claves).not.toContain(`SERVICIO:${sa.id}`);
    const prod = items.find((i) => i.tipo === 'PRODUCTO' && i.id === p.id);
    expect(prod.precio).toBe(250);
    expect(prod.stock).toBe(10);
  });

  test('solo admin y recepcionista: veterinario 403, sin sesión 401', async ({ request }) => {
    const p = await producto(request);
    const vet = await createTestVeterinario(request, token);
    limpiezas.push(() => deleteTestUser(request, token, vet.id));
    const vetToken = await loginAs(request, vet.username, TEST_USER_PASSWORD);
    const body = { metodo_pago: 'EFECTIVO', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 1 }] };

    expect((await vender(request, body, vetToken)).res.status()).toBe(403);
    expect((await ventaRapida(request, body)).status()).toBe(401);
    expect((await buscarItemsCaja(request, 'x')).status()).toBe(401);
    expect((await buscarItemsCaja(request, 'x', vetToken)).status()).toBe(403);

    const { user: recep, token: recepToken } = await createTestRecepcionista(request, token);
    limpiezas.push(() => deleteTestUser(request, token, recep.id));
    expect((await vender(request, body, recepToken)).res.status()).toBe(201);
    expect(await stockOf(request, token, p.id)).toBe(9);
  });
});

test.describe('Caja rápida — pantalla', () => {
  /** @type {string} */
  let adminToken;
  let limpiezas = [];

  test.beforeEach(async ({ request }) => {
    adminToken = await getAdminToken(request);
    limpiezas = [];
  });

  test.afterEach(async () => {
    for (const fn of limpiezas.reverse()) await fn();
  });

  async function loginUI(page, username, password) {
    await page.goto('/login');
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('#btnLogin');
    await page.waitForURL('**/');
  }

  async function recepcionistaEnCaja(page, request) {
    const { user } = await createTestRecepcionista(request, adminToken);
    limpiezas.push(() => deleteTestUser(request, adminToken, user.id));
    await loginUI(page, user.username, TEST_USER_PASSWORD);
    await gotoSection(page, 'sec-caja-rapida');
    await expect(page.locator('#sec-caja-rapida')).toBeVisible();
  }

  async function agregarDesdeBuscador(page, nombre) {
    await page.fill('#cajaBuscar', nombre);
    const fila = page.locator('#cajaResultadosBody tr', { hasText: nombre });
    await expect(fila).toBeVisible({ timeout: 10000 });
    await fila.getByRole('button', { name: 'Agregar' }).click();
    await expect(page.locator('#cajaCarritoBody tr', { hasText: nombre })).toBeVisible();
  }

  test('la recepcionista vende un producto en efectivo, ve la factura y el carrito queda vacío', async ({ page, request }) => {
    const p = await createTestProduct(request, { nombre: testTag('cajaui'), precio_unitario: 320, stock_actual: 5 }, adminToken);
    limpiezas.push(() => deleteTestProduct(request, p.id, adminToken));
    await recepcionistaEnCaja(page, request);

    await agregarDesdeBuscador(page, p.nombre);
    await expect(page.locator('#cajaTotal')).toHaveText('$320.00');

    const respuesta = page.waitForResponse((r) => r.url().includes('/api/caja-rapida/ventas') && r.request().method() === 'POST');
    await page.locator('#btnCajaCobrar').click();
    const factura = await (await respuesta).json();
    limpiezas.push(() => anularTestFactura(request, factura.id, adminToken));

    await expect(page.locator('#cajaConfirmacion')).toBeVisible();
    await expect(page.locator('#cajaFacturaNumero')).toContainText(factura.numero_factura);
    expect(factura.estado).toBe('PAGADA');
    expect(factura.metodo_pago).toBe('EFECTIVO');

    await page.locator('#btnCajaNueva').click();
    await expect(page.locator('#cajaVenta')).toBeVisible();
    await expect(page.locator('#cajaCarritoBody')).toContainText('El carrito está vacío.');
    await expect(page.locator('#btnCajaCobrar')).toBeDisabled();
  });

  test('si la venta falla por stock, se ve el error y el carrito conserva el ítem', async ({ page, request }) => {
    const p = await createTestProduct(request, { nombre: testTag('cajaui'), stock_actual: 1 }, adminToken);
    limpiezas.push(() => deleteTestProduct(request, p.id, adminToken));
    await recepcionistaEnCaja(page, request);

    await agregarDesdeBuscador(page, p.nombre);
    await page.locator(`#cajaCarritoBody input[data-caja-cantidad]`).fill('3');
    await page.locator('#btnCajaCobrar').click();

    await expect(page.locator('.notification-toast', { hasText: /Stock insuficiente/ }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#cajaConfirmacion')).toBeHidden();
    await expect(page.locator('#cajaCarritoBody tr', { hasText: p.nombre })).toBeVisible();
    await expect(page.locator('#cajaCarritoBody input[data-caja-cantidad]')).toHaveValue('3');
  });

  test('un veterinario no ve la caja rápida en la barra lateral', async ({ page, request }) => {
    const vet = await createTestVeterinario(request, adminToken);
    limpiezas.push(() => deleteTestUser(request, adminToken, vet.id));
    await loginUI(page, vet.username, TEST_USER_PASSWORD);
    // En el lanzador la barra lateral está oculta, pero ya está armada: su
    // data-signature lista las secciones que el rol puede ver.
    await expect(page.locator('#avSidebar')).toHaveAttribute('data-signature', /^veterinario::/);
    await expect(page.locator('#avSidebar')).not.toHaveAttribute('data-signature', /sec-caja-rapida/);
    await expect(page.locator('#avSidebar')).not.toHaveAttribute('data-signature', /sec-facturacion/);
  });
});
