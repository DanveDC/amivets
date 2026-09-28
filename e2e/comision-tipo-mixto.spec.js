// @ts-check
// Commission types per encargado and per catalog item (comision-tipo-mixto-encargado).
//
//   PUT /api/comisiones/encargados/{id}  { tipo_comision, monto_fijo, porcentaje }
//   POST/PUT /api/catalogo/              tipo_comision_servicio override (admin-only)
//   GET /api/comisiones/?encargado_id=   each line carries tipo/monto_fijo/porcentaje used
//
// Every test uses fresh gestores/areas/catalog items, so it does not depend on
// the default percentage or on data from other specs.
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestPropietario,
  createTestGestor,
  createTestArea,
  agregarGestorArea,
  createTestCatalogoServicio,
  createTestOrden,
  anexarServicioOrden,
  confirmarServiciosOrden,
  tomarServicio,
  facturarOrden,
  setComisionEncargado,
  controlComisiones,
  liquidarComisiones,
  gotoSection,
} = require('./helpers');

const hoy = () => new Date().toISOString().slice(0, 10);

/** Fresh gestor of a fresh area, with a catalog item of that area. */
async function gestorConArea(request, admin, comision = null, catalogo = {}) {
  const area = await createTestArea(request, admin);
  const gestor = await createTestGestor(request, admin);
  await agregarGestorArea(request, admin, area.id, gestor.user.id);
  const cat = await createTestCatalogoServicio(request, { area_id: area.id, categoria: 'PELUQUERIA', precio_ref: 1000, ...catalogo });
  if (comision) {
    const res = await setComisionEncargado(request, admin, gestor.user.id, comision);
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  return { area, gestor, cat };
}

/** Order with one item of the area, taken and executed by the gestor, closed and fully paid. */
async function servicioCobrado(request, admin, { gestor, cat }, precio = 1000) {
  const prop = await createTestPropietario(request, {}, admin);
  const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
  const srv = await anexarServicioOrden(request, orden.id, {
    catalogo_servicio_id: cat.id, tipo_servicio: 'ESTETICA', nombre_servicio: testTag('bano'), precio_unitario: precio,
  }, admin);
  await confirmarServiciosOrden(request, orden.id, admin);
  expect((await tomarServicio(request, srv.id, gestor.token)).ok()).toBeTruthy();
  const ej = await request.patch(`/api/servicios/${srv.id}`, {
    headers: authHeaders(gestor.token), data: { estado: 'EJECUTADO', detalles_clinicos: 'ok' },
  });
  expect(ej.ok(), await ej.text()).toBeTruthy();
  const cerrar = await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(admin) });
  expect(cerrar.ok(), await cerrar.text()).toBeTruthy();
  const pend = await (await request.get(`/api/ordenes/${orden.id}/pendientes-facturar`, { headers: authHeaders(admin) })).json();
  const res = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: pend.total }, admin);
  expect(res.status(), await res.text()).toBe(201);
  return { orden, servicio: srv, factura: await res.json() };
}

async function control(request, admin, encargadoId) {
  const res = await controlComisiones(request, admin, encargadoId, hoy(), hoy());
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

const porServicio = (lineas, servicioId) => lineas.find((l) => l.servicio_id === servicioId && !l.es_ajuste);

test.describe('Comisión por tipo — configuración del encargado', () => {
  test('FIJO, PORCENTAJE y MIXTO se guardan y listan; sin tipo vuelve al defecto', async ({ request }) => {
    const admin = await getAdminToken(request);
    const g = await createTestGestor(request, admin);
    const fila = async () => (await (await request.get('/api/comisiones/encargados', { headers: authHeaders(admin) })).json())
      .find((e) => e.usuario_id === g.user.id);

    expect((await setComisionEncargado(request, admin, g.user.id, { tipo_comision: 'FIJO', monto_fijo: 50 })).ok()).toBeTruthy();
    let f = await fila();
    expect(f.tipo_comision).toBe('FIJO');
    expect(Number(f.monto_fijo)).toBe(50);
    expect(f.porcentaje_propio).toBeNull();

    // MIXTO keeps both fields; a stray field for FIJO is dropped, not rejected.
    expect((await setComisionEncargado(request, admin, g.user.id, { tipo_comision: 'MIXTO', monto_fijo: 30, porcentaje: 10 })).ok()).toBeTruthy();
    f = await fila();
    expect([f.tipo_comision, Number(f.monto_fijo), Number(f.porcentaje_propio)]).toEqual(['MIXTO', 30, 10]);

    expect((await setComisionEncargado(request, admin, g.user.id, { tipo_comision: 'PORCENTAJE', porcentaje: 20, monto_fijo: 99 })).ok()).toBeTruthy();
    f = await fila();
    expect([f.tipo_comision, f.monto_fijo, Number(f.porcentaje_efectivo)]).toEqual(['PORCENTAJE', null, 20]);

    // No type and no values: back to the default.
    expect((await setComisionEncargado(request, admin, g.user.id, {})).ok()).toBeTruthy();
    f = await fila();
    expect(f.tipo_comision).toBeNull();
  });

  test('campos obligatorios según el tipo: 422', async ({ request }) => {
    const admin = await getAdminToken(request);
    const g = await createTestGestor(request, admin);
    const casos = [
      [{ tipo_comision: 'FIJO' }, 'monto_fijo es obligatorio para tipo FIJO'],
      [{ tipo_comision: 'PORCENTAJE' }, 'porcentaje es obligatorio para tipo PORCENTAJE'],
      [{ tipo_comision: 'MIXTO', monto_fijo: 10 }, 'monto_fijo y porcentaje son obligatorios para tipo MIXTO'],
      [{ tipo_comision: 'FIJO', monto_fijo: -1 }, null],
    ];
    for (const [data, mensaje] of casos) {
      const res = await setComisionEncargado(request, admin, g.user.id, data);
      expect(res.status(), JSON.stringify(data)).toBe(422);
      if (mensaje) expect(await res.text()).toContain(mensaje);
    }
  });

  test('override del catálogo: coherencia 422 y solo admin', async ({ request }) => {
    const admin = await getAdminToken(request);
    const sinMonto = await request.post('/api/catalogo/', {
      headers: authHeaders(admin),
      data: { nombre: testTag('cat'), categoria: 'LABORATORIO', tipo_comision_servicio: 'FIJO' },
    });
    expect(sinMonto.status()).toBe(422);

    const cat = await createTestCatalogoServicio(request, { tipo_comision_servicio: 'FIJO', monto_fijo_servicio: 80 });
    expect(cat.tipo_comision_servicio).toBe('FIJO');
    expect(Number(cat.monto_fijo_servicio)).toBe(80);

    // Partial PUT: switching to PORCENTAJE without a percentage is 422.
    const put = (data, token = admin) => request.put(`/api/catalogo/${cat.id}`, { headers: authHeaders(token), data });
    expect((await put({ tipo_comision_servicio: 'PORCENTAJE' })).status()).toBe(422);
    // Only the amount: keeps FIJO.
    let res = await put({ monto_fijo_servicio: 90 });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect([(await res.json()).tipo_comision_servicio]).toEqual(['FIJO']);
    // Back to HEREDA clears both values.
    res = await put({ tipo_comision_servicio: 'HEREDA' });
    const hereda = await res.json();
    expect([hereda.tipo_comision_servicio, hereda.monto_fijo_servicio, hereda.porcentaje_servicio]).toEqual(['HEREDA', null, null]);

    const gestor = await createTestGestor(request, admin);
    const vetLike = await request.put(`/api/catalogo/${cat.id}`, {
      headers: authHeaders(gestor.token), data: { tipo_comision_servicio: 'FIJO', monto_fijo_servicio: 10 },
    });
    expect(vetLike.status()).toBe(403);
  });
});

test.describe('Comisión por tipo — cálculo y liquidación', () => {
  test('PORCENTAJE 20%: 200 de 1000', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, { tipo_comision: 'PORCENTAJE', porcentaje: 20 });
    const { servicio } = await servicioCobrado(request, admin, ctx, 1000);
    const l = porServicio((await control(request, admin, ctx.gestor.user.id)).pendientes, servicio.id);
    expect([l.tipo_comision_usado, Number(l.porcentaje_usado), l.monto_fijo_usado]).toEqual(['PORCENTAJE', 20, null]);
    expect([Number(l.monto_encargado), Number(l.monto_amivets)]).toEqual([200, 800]);
  });

  test('FIJO $100: paga 100, y nunca más que lo cobrado', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, { tipo_comision: 'FIJO', monto_fijo: 100 });
    const grande = await servicioCobrado(request, admin, ctx, 1000);
    const chico = await servicioCobrado(request, admin, ctx, 80);
    const c = await control(request, admin, ctx.gestor.user.id);

    const lg = porServicio(c.pendientes, grande.servicio.id);
    expect([lg.tipo_comision_usado, Number(lg.monto_fijo_usado), lg.porcentaje_usado]).toEqual(['FIJO', 100, null]);
    expect([Number(lg.monto_encargado), Number(lg.monto_amivets)]).toEqual([100, 900]);

    const lc = porServicio(c.pendientes, chico.servicio.id);
    expect([Number(lc.monto_encargado), Number(lc.monto_amivets)]).toEqual([80, 0]);
  });

  test('MIXTO $50 + 10%: 150 de 1000', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, { tipo_comision: 'MIXTO', monto_fijo: 50, porcentaje: 10 });
    const { servicio } = await servicioCobrado(request, admin, ctx, 1000);
    const l = porServicio((await control(request, admin, ctx.gestor.user.id)).pendientes, servicio.id);
    expect([l.tipo_comision_usado, Number(l.monto_fijo_usado), Number(l.porcentaje_usado)]).toEqual(['MIXTO', 50, 10]);
    expect([Number(l.monto_encargado), Number(l.monto_amivets)]).toEqual([150, 850]);
  });

  test('el catálogo FIJO $200 manda sobre el encargado PORCENTAJE 20%', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(
      request, admin,
      { tipo_comision: 'PORCENTAJE', porcentaje: 20 },
      { tipo_comision_servicio: 'FIJO', monto_fijo_servicio: 200 },
    );
    const { servicio } = await servicioCobrado(request, admin, ctx, 1000);
    const l = porServicio((await control(request, admin, ctx.gestor.user.id)).pendientes, servicio.id);
    expect([l.tipo_comision_usado, Number(l.monto_fijo_usado), Number(l.monto_encargado)]).toEqual(['FIJO', 200, 200]);
  });

  test('la liquidación congela el tipo: cambiar la config después no la mueve', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, { tipo_comision: 'MIXTO', monto_fijo: 50, porcentaje: 10 });
    const g = ctx.gestor.user.id;
    await servicioCobrado(request, admin, ctx, 1000);

    const res = await liquidarComisiones(request, admin, g, hoy(), hoy());
    expect(res.status(), await res.text()).toBe(201);
    const liq = await res.json();
    const d = liq.detalles[0];
    expect([d.tipo_comision_usado, Number(d.monto_fijo_usado), Number(d.porcentaje_usado), Number(d.monto_encargado)])
      .toEqual(['MIXTO', 50, 10, 150]);

    await setComisionEncargado(request, admin, g, { tipo_comision: 'PORCENTAJE', porcentaje: 15 });
    const c = await control(request, admin, g);
    expect(c.pendientes).toHaveLength(0);
    const l = c.liquidadas[0];
    expect([l.tipo_comision_usado, Number(l.monto_fijo_usado), Number(l.porcentaje_usado), Number(l.monto_encargado)])
      .toEqual(['MIXTO', 50, 10, 150]);

    const pdf = await request.get(`/api/comisiones/liquidaciones/${liq.id}/pdf`, { headers: authHeaders(admin) });
    expect(pdf.status()).toBe(200);
  });

  test('el ajuste por factura anulada respeta el tipo congelado', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, { tipo_comision: 'FIJO', monto_fijo: 100 });
    const g = ctx.gestor.user.id;
    const { factura } = await servicioCobrado(request, admin, ctx, 1000);
    expect((await liquidarComisiones(request, admin, g, hoy(), hoy())).status()).toBe(201);

    // Config changes after liquidating; the adjustment still reverts FIJO $100.
    await setComisionEncargado(request, admin, g, { tipo_comision: 'PORCENTAJE', porcentaje: 50 });
    expect((await request.post(`/api/facturas/${factura.id}/anular`, { headers: authHeaders(admin) })).ok()).toBeTruthy();

    const ajuste = (await control(request, admin, g)).pendientes.find((l) => l.es_ajuste);
    expect(ajuste).toBeTruthy();
    expect([ajuste.tipo_comision_usado, Number(ajuste.monto_fijo_usado)]).toEqual(['FIJO', 100]);
    expect([Number(ajuste.monto_encargado), Number(ajuste.monto_amivets)]).toEqual([-100, -900]);

    const res = await liquidarComisiones(request, admin, g, hoy(), hoy());
    expect(res.status(), await res.text()).toBe(201);
    const det = (await res.json()).detalles.find((x) => x.es_ajuste);
    expect([det.tipo_comision_usado, Number(det.monto_fijo_usado), Number(det.monto_encargado)]).toEqual(['FIJO', 100, -100]);
  });
});

test.describe('Comisión por tipo — pantallas', () => {
  async function loginAdmin(page) {
    await page.goto('/login');
    await page.fill('#username', ADMIN_CREDENTIALS.username);
    await page.fill('#password', ADMIN_CREDENTIALS.password);
    await page.click('#btnLogin');
    await page.waitForURL('**/');
  }

  test('el admin configura un encargado MIXTO y el control muestra tipo, monto fijo y %', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin);
    const { servicio } = await servicioCobrado(request, admin, ctx, 1000);
    const g = ctx.gestor.user;

    await loginAdmin(page);
    await gotoSection(page, 'sec-reportes');
    const tipo = page.locator(`[data-com-tipo="${g.id}"]`);
    await expect(tipo).toBeVisible({ timeout: 15000 });

    // Conditional fields.
    const monto = page.locator(`[data-com-monto="${g.id}"]`);
    const porcentaje = page.locator(`[data-com-pct="${g.id}"]`);
    await expect(monto).toBeHidden();
    await tipo.selectOption('FIJO');
    await expect(monto).toBeVisible();
    await expect(porcentaje).toBeHidden();
    await tipo.selectOption('MIXTO');
    await expect(porcentaje).toBeVisible();

    // Frontend validation mirrors the backend.
    await monto.fill('30');
    await porcentaje.fill('');
    await page.locator(`[data-com-guardar="${g.id}"]`).click();
    await expect(page.locator('.notification-toast', { hasText: /porcentaje es obligatorio/ }).first()).toBeVisible();

    await porcentaje.fill('10');
    await page.locator(`[data-com-guardar="${g.id}"]`).click();
    await expect(page.locator(`[data-com-efectivo="${g.id}"]`)).toHaveText('$30.00 + 10%');

    await page.selectOption('#comEncargadoSelect', String(g.id));
    await page.fill('#comDesde', hoy());
    await page.fill('#comHasta', hoy());
    await page.click('#btnComVer');
    const fila = page.locator('#comControlWrap tr', { hasText: servicio.nombre_servicio });
    await expect(fila).toContainText('Mixto');
    await expect(fila).toContainText('$30.00');
    await expect(fila).toContainText('10%');
    await expect(fila).toContainText('$130.00');

    // Back to "Por defecto": the leftover percentage must not be saved as PORCENTAJE.
    await tipo.selectOption('');
    await expect(porcentaje).toHaveValue('');
    await page.locator(`[data-com-guardar="${g.id}"]`).click();
    await expect(page.locator('.notification-toast', { hasText: /Vuelve al porcentaje por defecto/ }).first()).toBeVisible();
    const lista = await (await request.get('/api/comisiones/encargados', { headers: authHeaders(admin) })).json();
    expect(lista.find((e) => e.usuario_id === g.id).tipo_comision).toBeNull();
  });

  test('el admin pone un override FIJO en el catálogo desde el modal', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const cat = await createTestCatalogoServicio(request);

    await loginAdmin(page);
    await gotoSection(page, 'sec-catalogo');
    // Filtrar por nombre: la lista trae como mucho 500 filas (catalogo.js) y la
    // base de e2e acumula más, así que un servicio recién creado puede no estar.
    await page.fill('#catalogoSearch', cat.nombre);
    await page.locator(`.cat-item[data-id="${cat.id}"]`).click();
    await page.click('#btnCatEditar');
    await expect(page.locator('#modalCatalogoServicio')).toBeVisible();

    const tipo = page.locator('#catalogoTipoComision');
    await expect(tipo).toHaveValue('HEREDA');
    await expect(page.locator('#catalogoMontoFijoComision')).toBeHidden();
    await tipo.selectOption('FIJO');
    await page.fill('#catalogoMontoFijoComision', '75');
    await page.locator('#formCatalogoServicio button[type="submit"]').click();
    await expect(page.locator('#modalCatalogoServicio')).toBeHidden({ timeout: 10000 });

    const actualizado = await (await request.get(`/api/catalogo/${cat.id}`, { headers: authHeaders(admin) })).json();
    expect([actualizado.tipo_comision_servicio, Number(actualizado.monto_fijo_servicio), actualizado.porcentaje_servicio])
      .toEqual(['FIJO', 75, null]);
  });
});
