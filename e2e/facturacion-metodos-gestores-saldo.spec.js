// @ts-check
// Dashboard de facturación (facturacion-metodos-gestores-saldo):
//   GET /api/facturas/hoy                       — facturas emitidas hoy
//   GET /api/facturas/gestores-pagos             — pagos a gestores (solo admin)
//   GET /api/facturas/orden/{id}/saldo-pendiente — saldo pendiente por orden
//   POST /api/facturas/{id}/abonar               — orden_id opcional
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestPropietario,
  createTestOrden,
  anexarServicioOrden,
  confirmarServiciosOrden,
  tomarServicio,
  facturarOrden,
  pendientesFacturarOrden,
  createTestFactura,
  createTestGestor,
  createTestArea,
  agregarGestorArea,
  createTestCatalogoServicio,
  setComisionEncargado,
  liquidarComisiones,
  createTestRecepcionista,
  createTestVeterinario,
  loginAs,
  TEST_USER_PASSWORD,
  gotoSection,
} = require('./helpers');

const hoy = () => new Date().toISOString().slice(0, 10);

/** Orden cerrada con un ítem pendiente de facturar, lista para cobrar. */
async function ordenCerradaConItem(request, admin, precio = 1000) {
  const prop = await createTestPropietario(request, {}, admin);
  const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
  const servicio = await anexarServicioOrden(request, orden.id, {
    tipo_servicio: 'ESTETICA', nombre_servicio: testTag('bano'), precio_unitario: precio,
  }, admin);
  await confirmarServiciosOrden(request, orden.id, admin);
  const cerrar = await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(admin) });
  expect(cerrar.ok(), await cerrar.text()).toBeTruthy();
  return { orden, servicio, prop };
}

test.describe('Facturas de hoy', () => {
  test('una factura recién creada aparece en GET /facturas/hoy', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const factura = await createTestFactura(request, { propietarioId: prop.id }, admin);

    const res = await request.get('/api/facturas/hoy', { headers: authHeaders(admin) });
    expect(res.ok(), await res.text()).toBeTruthy();
    const facturas = await res.json();
    expect(facturas.some((f) => f.id === factura.id)).toBeTruthy();
  });

  test('respeta el filtro de estado', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const factura = await createTestFactura(request, { propietarioId: prop.id }, admin);

    const res = await request.get('/api/facturas/hoy?estado=ANULADA', { headers: authHeaders(admin) });
    expect(res.ok(), await res.text()).toBeTruthy();
    const facturas = await res.json();
    expect(facturas.some((f) => f.id === factura.id)).toBeFalsy();
  });
});

test.describe('Pagos a gestores', () => {
  test('un rango con liquidaciones muestra los totales congelados por gestor', async ({ request }) => {
    const admin = await getAdminToken(request);
    const area = await createTestArea(request, admin);
    const gestor = await createTestGestor(request, admin);
    await agregarGestorArea(request, admin, area.id, gestor.user.id);
    await setComisionEncargado(request, admin, gestor.user.id, { tipo_comision: 'PORCENTAJE', porcentaje: 20 });
    const cat = await createTestCatalogoServicio(request, { area_id: area.id, categoria: 'PELUQUERIA', precio_ref: 1000 });

    // Orden con el ítem despachable al área del gestor: tomar -> ejecutar ->
    // recién ahí cerrar (mismo orden que comision-tipo-mixto.spec.js -- un
    // servicio de una orden ya CERRADA no se puede tomar).
    const prop = await createTestPropietario(request, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
    const servicio = await anexarServicioOrden(request, orden.id, {
      catalogo_servicio_id: cat.id, tipo_servicio: 'ESTETICA', nombre_servicio: testTag('bano'), precio_unitario: 1000,
    }, admin);
    await confirmarServiciosOrden(request, orden.id, admin);
    const tomar = await tomarServicio(request, servicio.id, gestor.token);
    expect(tomar.ok(), await tomar.text()).toBeTruthy();
    const ejecutar = await request.patch(`/api/servicios/${servicio.id}`, {
      headers: authHeaders(gestor.token), data: { estado: 'EJECUTADO', detalles_clinicos: 'ok' },
    });
    expect(ejecutar.ok(), await ejecutar.text()).toBeTruthy();
    const cerrar = await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(admin) });
    expect(cerrar.ok(), await cerrar.text()).toBeTruthy();

    const pend = await pendientesFacturarOrden(request, orden.id, admin);
    const facturaRes = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: pend.total }, admin);
    expect(facturaRes.status(), await facturaRes.text()).toBe(201);

    const liq = await liquidarComisiones(request, admin, gestor.user.id, hoy(), hoy());
    expect(liq.status(), await liq.text()).toBe(201);

    const res = await request.get(`/api/facturas/gestores-pagos?desde=${hoy()}&hasta=${hoy()}`, { headers: authHeaders(admin) });
    expect(res.ok(), await res.text()).toBeTruthy();
    const pagos = await res.json();
    const fila = pagos.find((p) => p.encargado_id === gestor.user.id);
    expect(fila).toBeTruthy();
    expect(Number(fila.total_encargado)).toBe(200);
    expect(Number(fila.total_amivets)).toBe(800);
    expect(fila.cantidad_lineas).toBe(1);
    expect(Number(fila.total_ajustes)).toBe(0);
  });

  test('un rango sin liquidaciones devuelve lista vacía', async ({ request }) => {
    const admin = await getAdminToken(request);
    const res = await request.get('/api/facturas/gestores-pagos?desde=2019-01-01&hasta=2019-01-02', { headers: authHeaders(admin) });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(await res.json()).toEqual([]);
  });

  test('solo admin: 403 para recepcionista y veterinario', async ({ request }) => {
    const admin = await getAdminToken(request);
    const recepcionista = await createTestRecepcionista(request, admin);
    const vetUser = await createTestVeterinario(request, admin);
    const vetToken = await loginAs(request, vetUser.username, TEST_USER_PASSWORD);

    const resRecep = await request.get(`/api/facturas/gestores-pagos?desde=${hoy()}&hasta=${hoy()}`, {
      headers: authHeaders(recepcionista.token),
    });
    expect(resRecep.status()).toBe(403);

    const resVet = await request.get(`/api/facturas/gestores-pagos?desde=${hoy()}&hasta=${hoy()}`, {
      headers: authHeaders(vetToken),
    });
    expect(resVet.status()).toBe(403);
  });

  test('formato de fecha inválido y rango invertido son 422', async ({ request }) => {
    const admin = await getAdminToken(request);
    const malFormato = await request.get('/api/facturas/gestores-pagos?desde=no-es-fecha&hasta=2026-01-01', { headers: authHeaders(admin) });
    expect(malFormato.status()).toBe(422);

    const rangoInvertido = await request.get('/api/facturas/gestores-pagos?desde=2026-01-31&hasta=2026-01-01', { headers: authHeaders(admin) });
    expect(rangoInvertido.status()).toBe(422);
  });
});

test.describe('Saldo pendiente por orden', () => {
  test('orden FACTURADA con factura PARCIAL: saldo = factura.saldo_pendiente', async ({ request }) => {
    const admin = await getAdminToken(request);
    const { orden } = await ordenCerradaConItem(request, admin, 1000);
    const pend = await pendientesFacturarOrden(request, orden.id, admin);
    // Pago parcial: menos que el total -> la factura queda PARCIAL.
    const facturaRes = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: pend.total / 2 }, admin);
    expect(facturaRes.status(), await facturaRes.text()).toBe(201);
    const factura = await facturaRes.json();
    expect(factura.estado).toBe('PARCIAL');

    const res = await request.get(`/api/facturas/orden/${orden.id}/saldo-pendiente`, { headers: authHeaders(admin) });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.factura_id).toBe(factura.id);
    expect(Number(body.saldo_pendiente)).toBe(Number(factura.saldo_pendiente));
  });

  test('orden CERRADA sin factura: saldo = total de ítems pendientes', async ({ request }) => {
    const admin = await getAdminToken(request);
    const { orden } = await ordenCerradaConItem(request, admin, 1500);

    const res = await request.get(`/api/facturas/orden/${orden.id}/saldo-pendiente`, { headers: authHeaders(admin) });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.factura_id).toBeNull();
    expect(Number(body.saldo_pendiente)).toBe(1500);
    expect(Number(body.total_factura)).toBe(1500);
  });

  test('orden ABIERTA sin factura: 409', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);

    const res = await request.get(`/api/facturas/orden/${orden.id}/saldo-pendiente`, { headers: authHeaders(admin) });
    expect(res.status()).toBe(409);
  });

  test('orden inexistente: 404', async ({ request }) => {
    const admin = await getAdminToken(request);
    const res = await request.get('/api/facturas/orden/99999999/saldo-pendiente', { headers: authHeaders(admin) });
    expect(res.status()).toBe(404);
  });

  test('factura anulada: el saldo vuelve a ser el de los ítems pendientes, no el de la factura muerta', async ({ request }) => {
    const admin = await getAdminToken(request);
    const { orden } = await ordenCerradaConItem(request, admin, 1800);
    const pend = await pendientesFacturarOrden(request, orden.id, admin);
    const facturaRes = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 0 }, admin);
    expect(facturaRes.status(), await facturaRes.text()).toBe(201);
    const factura = await facturaRes.json();
    expect(factura.estado).toBe('PENDIENTE');

    const anular = await request.post(`/api/facturas/${factura.id}/anular`, { headers: authHeaders(admin) });
    expect(anular.ok(), await anular.text()).toBeTruthy();

    // anular_factura revierte la orden FACTURADA -> CERRADA (decisión 7) pero
    // deja el vínculo FacturaOrden intacto -- el fix de obtener_saldo_pendiente_orden
    // tiene que ignorar esa factura ANULADA y volver a resolver por ítems pendientes.
    const res = await request.get(`/api/facturas/orden/${orden.id}/saldo-pendiente`, { headers: authHeaders(admin) });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.factura_id).toBeNull();
    expect(body.factura_estado).toBeNull();
    expect(Number(body.saldo_pendiente)).toBe(1800);
    expect(Number(body.total_factura)).toBe(1800);
  });

  test('orden refacturada tras anular: el saldo muestra la factura nueva, no la anulada', async ({ request }) => {
    const admin = await getAdminToken(request);
    const { orden } = await ordenCerradaConItem(request, admin, 2200);
    const pend = await pendientesFacturarOrden(request, orden.id, admin);
    const primeraRes = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 0 }, admin);
    expect(primeraRes.status(), await primeraRes.text()).toBe(201);
    const primeraFactura = await primeraRes.json();

    const anular = await request.post(`/api/facturas/${primeraFactura.id}/anular`, { headers: authHeaders(admin) });
    expect(anular.ok(), await anular.text()).toBeTruthy();

    // La orden volvió a CERRADA -> se puede refacturar. FacturaOrden.orden_id
    // no es único: ahora hay dos vínculos para la misma orden (uno ANULADA,
    // uno vigente) y el saldo tiene que resolver por la vigente.
    const segundaRes = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 500 }, admin);
    expect(segundaRes.status(), await segundaRes.text()).toBe(201);
    const segundaFactura = await segundaRes.json();
    expect(segundaFactura.id).not.toBe(primeraFactura.id);
    expect(segundaFactura.estado).toBe('PARCIAL');

    const res = await request.get(`/api/facturas/orden/${orden.id}/saldo-pendiente`, { headers: authHeaders(admin) });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.factura_id).toBe(segundaFactura.id);
    expect(body.factura_estado).toBe('PARCIAL');
    expect(Number(body.saldo_pendiente)).toBe(Number(segundaFactura.saldo_pendiente));
  });
});

test.describe('Abono con orden_id', () => {
  test('registrar un abono vinculando la orden de la factura', async ({ request }) => {
    const admin = await getAdminToken(request);
    const { orden } = await ordenCerradaConItem(request, admin, 2000);
    const pend = await pendientesFacturarOrden(request, orden.id, admin);
    const facturaRes = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 0 }, admin);
    expect(facturaRes.status(), await facturaRes.text()).toBe(201);
    const factura = await facturaRes.json();

    const res = await request.post(`/api/facturas/${factura.id}/abonar`, {
      headers: authHeaders(admin),
      data: { monto: 500, metodo_pago: 'EFECTIVO', orden_id: orden.id },
    });
    expect(res.status(), await res.text()).toBe(201);
    const abono = await res.json();
    expect(abono.orden_id).toBe(orden.id);
    expect(abono.orden_numero).toBe(orden.numero);
  });

  test('orden de otra factura: 409', async ({ request }) => {
    const admin = await getAdminToken(request);
    const a = await ordenCerradaConItem(request, admin, 1000);
    const b = await ordenCerradaConItem(request, admin, 1000);
    // Ambas quedan PENDIENTE (sin cobro) para que el abono sea válido salvo
    // por el orden_id cruzado.
    const facturaA = await (await facturarOrden(request, a.orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 0 }, admin)).json();
    await facturarOrden(request, b.orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 0 }, admin);

    // facturaA está vinculada a la orden A -- pedirle el abono con orden_id de
    // B (que tiene su propia factura) tiene que rechazar con 409.
    const res = await request.post(`/api/facturas/${facturaA.id}/abonar`, {
      headers: authHeaders(admin),
      data: { monto: 10, metodo_pago: 'EFECTIVO', orden_id: b.orden.id },
    });
    expect(res.status()).toBe(409);
  });

  test('orden inexistente: 404', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const factura = await createTestFactura(request, { propietarioId: prop.id }, admin);

    const res = await request.post(`/api/facturas/${factura.id}/abonar`, {
      headers: authHeaders(admin),
      data: { monto: 10, metodo_pago: 'EFECTIVO', orden_id: 99999999 },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('Pantalla de Facturación — nuevas pestañas', () => {
  async function loginAdmin(page) {
    await page.goto('/login');
    await page.fill('#username', ADMIN_CREDENTIALS.username);
    await page.fill('#password', ADMIN_CREDENTIALS.password);
    await page.click('#btnLogin');
    await page.waitForURL('**/');
  }

  test('el admin ve "Hoy" y "Pagos a gestores"; el veterinario no ve "Pagos a gestores"', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const factura = await createTestFactura(request, { propietarioId: prop.id }, admin);

    await loginAdmin(page);
    await gotoSection(page, 'sec-facturacion');
    await page.click('#facTabHoy');
    await expect(page.locator(`#facHoyTableBody tr:has-text("${factura.numero_factura}")`)).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#facTabGestores')).toBeVisible();
    await page.click('#facTabGestores');
    await expect(page.locator('#facViewGestores')).toBeVisible();

    const vetUser = await createTestVeterinario(request, admin);
    const vetToken = await loginAs(request, vetUser.username, TEST_USER_PASSWORD);
    await page.evaluate((token) => {
      localStorage.setItem('token', token);
      localStorage.removeItem('role');
    }, vetToken);
    await page.reload();
    await gotoSection(page, 'sec-facturacion');
    await expect(page.locator('#facTabGestores')).toBeHidden();
  });

  test('"Órdenes por cobrar" muestra la columna Saldo pendiente', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const { orden } = await ordenCerradaConItem(request, admin, 1234);

    await loginAdmin(page);
    await gotoSection(page, 'sec-facturacion');
    const fila = page.locator('#facOrdenesBody tr', { hasText: orden.numero });
    await expect(fila).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`#facOrdenSaldo-${orden.id}`)).toContainText('$1234.00', { timeout: 10000 });
  });
});
