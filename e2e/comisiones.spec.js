// @ts-check
// Comisiones por servicio (comisiones-por-servicio).
//
//   /api/comisiones/configuracion       porcentaje por defecto (admin)
//   /api/comisiones/encargados[/{id}]   porcentaje propio por encargado (admin)
//   /api/comisiones/?encargado_id=      control: pendientes, liquidadas, totales
//   /api/comisiones/mias                lo propio (veterinario / gestor)
//   /api/comisiones/liquidaciones       liquidar (congela % y montos) + PDF
//
// Cada test usa encargados nuevos con un porcentaje propio, así no depende
// del porcentaje por defecto ni de datos de otros specs.
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  TEST_USER_PASSWORD,
  getAdminToken,
  authHeaders,
  testTag,
  loginAs,
  createTestPropietario,
  createTestMascota,
  createTestVeterinario,
  createTestRecepcionista,
  createTestGestor,
  createTestArea,
  desactivarTestArea,
  agregarGestorArea,
  createTestCatalogoServicio,
  createTestOrden,
  createTestConsulta,
  anexarServicioOrden,
  confirmarServiciosOrden,
  tomarServicio,
  facturarOrden,
  pagarFacturaCompleta,
  setTarifaConsulta,
  setPorcentajeDefecto,
  setPorcentajeEncargado,
  controlComisiones,
  liquidarComisiones,
  gotoSection,
} = require('./helpers');

const hoy = () => new Date().toISOString().slice(0, 10);

/** Gestor nuevo, gestor de un área nueva, con porcentaje propio. */
async function gestorConArea(request, admin, porcentaje = 40) {
  const area = await createTestArea(request, admin);
  const gestor = await createTestGestor(request, admin);
  await agregarGestorArea(request, admin, area.id, gestor.user.id);
  const cat = await createTestCatalogoServicio(request, { area_id: area.id, categoria: 'PELUQUERIA', precio_ref: 1000 });
  if (porcentaje !== null) {
    expect((await setPorcentajeEncargado(request, admin, gestor.user.id, porcentaje)).ok()).toBeTruthy();
  }
  return { area, gestor, cat };
}

/**
 * Orden con un servicio del área, tomado y ejecutado por el gestor, cerrada y
 * facturada. `pagado` = fracción cobrada (1 = PAGADA, 0 = PENDIENTE).
 * `extra` agrega líneas sin área a la misma orden.
 */
async function servicioCobrado(request, admin, { gestor, cat }, { precio = 1000, pagado = 1, extra = [] } = {}) {
  const prop = await createTestPropietario(request, {}, admin);
  const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
  const srv = await anexarServicioOrden(request, orden.id, {
    catalogo_servicio_id: cat.id, tipo_servicio: 'ESTETICA', nombre_servicio: testTag('bano'), precio_unitario: precio,
  }, admin);
  for (const e of extra) await anexarServicioOrden(request, orden.id, e, admin);
  await confirmarServiciosOrden(request, orden.id, admin);
  expect((await tomarServicio(request, srv.id, gestor.token)).ok()).toBeTruthy();
  const ej = await request.patch(`/api/servicios/${srv.id}`, {
    headers: authHeaders(gestor.token), data: { estado: 'EJECUTADO', detalles_clinicos: 'ok' },
  });
  expect(ej.ok(), await ej.text()).toBeTruthy();
  const cerrar = await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(admin) });
  expect(cerrar.ok(), await cerrar.text()).toBeTruthy();
  const pend = await (await request.get(`/api/ordenes/${orden.id}/pendientes-facturar`, { headers: authHeaders(admin) })).json();
  const res = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: pend.total * pagado }, admin);
  expect(res.status(), await res.text()).toBe(201);
  return { orden, servicio: srv, factura: await res.json() };
}

async function control(request, admin, encargadoId) {
  const res = await controlComisiones(request, admin, encargadoId, hoy(), hoy());
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

test.describe('Comisiones — configuración', () => {
  test('el admin cambia el porcentaje por defecto; fuera de rango es 422', async ({ request }) => {
    const admin = await getAdminToken(request);
    const antes = await (await request.get('/api/comisiones/configuracion', { headers: authHeaders(admin) })).json();
    try {
      expect((await setPorcentajeDefecto(request, admin, 40)).status()).toBe(200);
      const cfg = await (await request.get('/api/comisiones/configuracion', { headers: authHeaders(admin) })).json();
      expect(Number(cfg.porcentaje_defecto)).toBe(40);
      expect((await setPorcentajeDefecto(request, admin, 120)).status()).toBe(422);
      expect((await setPorcentajeDefecto(request, admin, -5)).status()).toBe(422);
      const sigue = await (await request.get('/api/comisiones/configuracion', { headers: authHeaders(admin) })).json();
      expect(Number(sigue.porcentaje_defecto)).toBe(40);
    } finally {
      await setPorcentajeDefecto(request, admin, Number(antes.porcentaje_defecto));
    }
  });

  test('recepcionista y veterinario no pueden ver ni cambiar la configuración (403)', async ({ request }) => {
    const admin = await getAdminToken(request);
    const { token: recep } = await createTestRecepcionista(request, admin);
    const vet = await createTestVeterinario(request, admin);
    const vetToken = await loginAs(request, vet.username, TEST_USER_PASSWORD);
    for (const t of [recep, vetToken]) {
      expect((await request.get('/api/comisiones/configuracion', { headers: authHeaders(t) })).status()).toBe(403);
      expect((await setPorcentajeDefecto(request, t, 10)).status()).toBe(403);
    }
  });

  test('porcentaje propio por encargado y vuelta al defecto', async ({ request }) => {
    const admin = await getAdminToken(request);
    const { user } = await createTestGestor(request, admin);
    const cfg = await (await request.get('/api/comisiones/configuracion', { headers: authHeaders(admin) })).json();
    const defecto = Number(cfg.porcentaje_defecto);

    const r = await setPorcentajeEncargado(request, admin, user.id, 55);
    expect(r.status()).toBe(200);
    let lista = await (await request.get('/api/comisiones/encargados', { headers: authHeaders(admin) })).json();
    let fila = lista.find((e) => e.usuario_id === user.id);
    expect(Number(fila.porcentaje_propio)).toBe(55);
    expect(Number(fila.porcentaje_efectivo)).toBe(55);

    expect((await setPorcentajeEncargado(request, admin, user.id, null)).status()).toBe(200);
    lista = await (await request.get('/api/comisiones/encargados', { headers: authHeaders(admin) })).json();
    fila = lista.find((e) => e.usuario_id === user.id);
    expect(fila.porcentaje_propio).toBeNull();
    expect(Number(fila.porcentaje_efectivo)).toBe(defecto);

    expect((await setPorcentajeEncargado(request, admin, user.id, 101)).status()).toBe(422);
  });
});

test.describe('Comisiones — cálculo y control', () => {
  test('servicio de área cobrado: pendiente del gestor con reparto 40/60; lo sin área no suma', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, 40);
    const { servicio, factura } = await servicioCobrado(request, admin, ctx, {
      precio: 1000,
      extra: [{ tipo_servicio: 'ESTETICA', nombre_servicio: testTag('sinArea'), precio_unitario: 500 }],
    });
    const c = await control(request, admin, ctx.gestor.user.id);
    expect(c.pendientes).toHaveLength(1);
    const l = c.pendientes[0];
    expect(l.servicio_id).toBe(servicio.id);
    expect(l.factura_id).toBe(factura.id);
    expect(Number(l.subtotal)).toBe(1000);
    expect(Number(l.porcentaje)).toBe(40);
    expect(Number(l.monto_encargado)).toBe(400);
    expect(Number(l.monto_amivets)).toBe(600);
    expect(Number(c.totales_pendientes.encargado)).toBe(400);
    expect(Number(c.totales_pendientes.amivets)).toBe(600);
  });

  test('honorario de la consulta: la comisión es del veterinario', async ({ request }) => {
    const admin = await getAdminToken(request);
    const vet = await createTestVeterinario(request, admin);
    await setPorcentajeEncargado(request, admin, vet.id, 30);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id, orden_id: orden.id, precio_consulta: 25000 }, admin);
    await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(admin) });
    const res = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 25000 }, admin);
    expect(res.status(), await res.text()).toBe(201);

    const c = await control(request, admin, vet.id);
    expect(c.pendientes).toHaveLength(1);
    expect(Number(c.pendientes[0].subtotal)).toBe(25000);
    expect(Number(c.pendientes[0].monto_encargado)).toBe(7500);
  });

  test('factura PENDIENTE o PARCIAL no es elegible; al completar el pago (abono) sí', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, 40);
    await servicioCobrado(request, admin, ctx, { pagado: 0 });
    const { factura } = await servicioCobrado(request, admin, ctx, { pagado: 0.5 });
    expect(factura.estado).toBe('PARCIAL');
    expect((await control(request, admin, ctx.gestor.user.id)).pendientes).toHaveLength(0);

    await pagarFacturaCompleta(request, factura, 'Efectivo', admin);
    const c = await control(request, admin, ctx.gestor.user.id);
    expect(c.pendientes).toHaveLength(1);
    expect(c.pendientes[0].factura_id).toBe(factura.id);
  });

  test('/mias muestra solo lo propio; un gestor no ve el control de otro (403)', async ({ request }) => {
    const admin = await getAdminToken(request);
    const a = await gestorConArea(request, admin, 40);
    const b = await gestorConArea(request, admin, 40);
    const { servicio } = await servicioCobrado(request, admin, a);
    await servicioCobrado(request, admin, b);

    const mias = await request.get(`/api/comisiones/mias?desde=${hoy()}&hasta=${hoy()}`, { headers: authHeaders(a.gestor.token) });
    expect(mias.ok()).toBeTruthy();
    const body = await mias.json();
    expect(body.encargado_id).toBe(a.gestor.user.id);
    expect(body.pendientes.map((l) => l.servicio_id)).toEqual([servicio.id]);

    const ajeno = await controlComisiones(request, a.gestor.token, b.gestor.user.id, hoy(), hoy());
    expect(ajeno.status()).toBe(403);
  });

  test('una consulta ya liquidada con tarifa fija no vuelve a generar comisión', async ({ request }) => {
    const admin = await getAdminToken(request);
    const vet = await createTestVeterinario(request, admin);
    await setTarifaConsulta(request, admin, vet.id, 5000);
    await setPorcentajeEncargado(request, admin, vet.id, 30);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id, orden_id: orden.id }, admin);
    await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(admin) });
    const f = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 25000 }, admin);
    expect(f.status()).toBe(201);
    expect((await control(request, admin, vet.id)).pendientes).toHaveLength(1);

    const liq = await request.post('/api/liquidaciones/calcular', {
      headers: authHeaders(admin), data: { veterinario_id: vet.id, fecha_inicio: hoy(), fecha_fin: hoy() },
    });
    expect(liq.status(), await liq.text()).toBe(201);
    expect((await control(request, admin, vet.id)).pendientes).toHaveLength(0);
    const hist = await request.get(`/api/liquidaciones/?veterinario_id=${vet.id}`, { headers: authHeaders(admin) });
    expect(hist.ok()).toBeTruthy();
    expect((await hist.json()).length).toBe(1);
  });
});

test.describe('Comisiones — liquidación, ajustes y PDF', () => {
  test('liquidar congela % y montos, no paga dos veces y el PDF se descarga', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, 40);
    await servicioCobrado(request, admin, ctx, { precio: 1000 });
    await servicioCobrado(request, admin, ctx, { precio: 500 });

    const res = await liquidarComisiones(request, admin, ctx.gestor.user.id, hoy(), hoy());
    expect(res.status(), await res.text()).toBe(201);
    const liq = await res.json();
    expect(liq.numero).toMatch(/^LC-\d{6}$/);
    expect(liq.detalles).toHaveLength(2);
    expect(Number(liq.total_encargado)).toBe(600);
    expect(Number(liq.total_amivets)).toBe(900);

    // Cambiar el porcentaje después no mueve lo liquidado.
    await setPorcentajeEncargado(request, admin, ctx.gestor.user.id, 10);
    const c = await control(request, admin, ctx.gestor.user.id);
    expect(c.pendientes).toHaveLength(0);
    expect(c.liquidadas).toHaveLength(2);
    expect(c.liquidadas.every((l) => Number(l.porcentaje) === 40)).toBe(true);

    // Sin pendientes: 409.
    expect((await liquidarComisiones(request, admin, ctx.gestor.user.id, hoy(), hoy())).status()).toBe(409);

    // Listado de liquidaciones.
    const lista = await (await request.get(`/api/comisiones/liquidaciones?encargado_id=${ctx.gestor.user.id}`, { headers: authHeaders(admin) })).json();
    expect(lista.map((l) => l.id)).toEqual([liq.id]);

    // PDF: admin y dueño sí; otro gestor no.
    for (const t of [admin, ctx.gestor.token]) {
      const pdf = await request.get(`/api/comisiones/liquidaciones/${liq.id}/pdf`, { headers: authHeaders(t) });
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()['content-type']).toContain('application/pdf');
      expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    }
    const otro = await createTestGestor(request, admin);
    expect((await request.get(`/api/comisiones/liquidaciones/${liq.id}/pdf`, { headers: authHeaders(otro.token) })).status()).toBe(403);
  });

  test('anular antes de liquidar saca la línea; anular después genera un ajuste que descuenta', async ({ request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, 40);
    const g = ctx.gestor.user.id;

    // Antes de liquidar: la línea desaparece de pendientes.
    const a = await servicioCobrado(request, admin, ctx, { precio: 1000 });
    expect((await control(request, admin, g)).pendientes).toHaveLength(1);
    expect((await request.post(`/api/facturas/${a.factura.id}/anular`, { headers: authHeaders(admin) })).ok()).toBeTruthy();
    expect((await control(request, admin, g)).pendientes).toHaveLength(0);

    // Después de liquidar: ajuste -400 que se descuenta en la próxima.
    const b = await servicioCobrado(request, admin, ctx, { precio: 1000 });
    expect((await liquidarComisiones(request, admin, g, hoy(), hoy())).status()).toBe(201);
    expect((await request.post(`/api/facturas/${b.factura.id}/anular`, { headers: authHeaders(admin) })).ok()).toBeTruthy();

    let c = await control(request, admin, g);
    const ajuste = c.pendientes.find((l) => l.es_ajuste);
    expect(ajuste).toBeTruthy();
    expect(Number(ajuste.monto_encargado)).toBe(-400);
    expect(Number(ajuste.monto_amivets)).toBe(-600);

    await servicioCobrado(request, admin, ctx, { precio: 2500 });
    c = await control(request, admin, g);
    expect(Number(c.totales_pendientes.encargado)).toBe(1000 - 400);

    const res = await liquidarComisiones(request, admin, g, hoy(), hoy());
    expect(res.status(), await res.text()).toBe(201);
    const liq = await res.json();
    expect(liq.detalles.filter((d) => d.es_ajuste)).toHaveLength(1);
    expect(Number(liq.total_encargado)).toBe(600);
    expect((await control(request, admin, g)).pendientes).toHaveLength(0);

    const pdf = await request.get(`/api/comisiones/liquidaciones/${liq.id}/pdf`, { headers: authHeaders(admin) });
    expect(pdf.status()).toBe(200);
  });
});

test.describe('Comisiones — pantalla', () => {
  test('el admin fija el porcentaje de un gestor, ve lo pendiente, liquida y descarga el PDF', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin, null);
    const { servicio } = await servicioCobrado(request, admin, ctx, { precio: 2000 });
    const g = ctx.gestor.user;

    await page.goto('/login');
    await page.fill('#username', ADMIN_CREDENTIALS.username);
    await page.fill('#password', ADMIN_CREDENTIALS.password);
    await page.click('#btnLogin');
    await page.waitForURL('**/');
    await gotoSection(page, 'sec-reportes');
    await expect(page.locator('#liqSeccion')).toBeVisible();

    // Porcentaje propio desde la tabla de encargados.
    const input = page.locator(`[data-com-pct="${g.id}"]`);
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill('25');
    await page.locator(`[data-com-guardar="${g.id}"]`).click();
    await expect(page.locator(`[data-com-efectivo="${g.id}"]`)).toHaveText('25%');

    // Control: la línea pendiente con el 25%.
    await page.selectOption('#comEncargadoSelect', String(g.id));
    await page.fill('#comDesde', hoy());
    await page.fill('#comHasta', hoy());
    await page.click('#btnComVer');
    const wrap = page.locator('#comControlWrap');
    await expect(wrap).toContainText(servicio.nombre_servicio);
    await expect(page.locator('#comTotalesPendientes')).toContainText('$500.00');

    // Liquidar (pide confirm) -> aparece en la lista con su PDF.
    page.once('dialog', (d) => d.accept());
    await page.click('#btnComLiquidar');
    const fila = page.locator('#comLiquidacionesLista [data-com-liquidacion]').first();
    await expect(fila).toContainText(/LC-\d{6}/, { timeout: 10000 });
    await expect(page.locator('#btnComLiquidar')).toBeDisabled();

    const descarga = page.waitForEvent('download');
    await fila.getByRole('button', { name: 'Descargar PDF' }).click();
    const archivo = await descarga;
    expect(archivo.suggestedFilename()).toMatch(/^Liquidacion_LC-\d{6}\.pdf$/);
  });
});
