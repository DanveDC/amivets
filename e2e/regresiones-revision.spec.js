// @ts-check
// Regresiones de la revisión de la rama feature/ordenes-caja-comisiones-encargado.
// Un test por hallazgo arreglado (los que se pueden reproducir por e2e):
//   1. cantidad fraccionaria facturada por su subtotal exacto
//   2. honorario ya facturado no bloquea facturar el resto de la orden
//   4. el consumo real indicado al agregar se respeta al ejecutar
//   5. la comisión se calcula sobre lo cobrado (descuento incluido)
//   7. anular una venta de caja rápida anula su orden (no la reabre)
//   8. una orden cerrada sin nada pendiente no aparece "por cobrar"
//   9. una consulta sin orden se puede facturar desde Historia clínica
//  10. las fechas de las liquidaciones se muestran en el día local
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestProduct,
  createTestPropietario,
  createTestMascota,
  createTestVeterinario,
  createTestConsulta,
  createTestOrden,
  createTestCatalogoServicio,
  createTestArea,
  agregarGestorArea,
  anexarServicioConsulta,
  createTestGestor,
  anexarServicioOrden,
  confirmarServiciosOrden,
  tomarServicio,
  facturarOrden,
  anularTestFactura,
  ventaRapida,
  setPorcentajeEncargado,
  controlComisiones,
  liquidarComisiones,
  gotoSection,
} = require('./helpers');

const hoy = () => new Date().toISOString().slice(0, 10);

async function cerrar(request, admin, ordenId) {
  const r = await request.post(`/api/ordenes/${ordenId}/cerrar`, { headers: authHeaders(admin) });
  expect(r.ok(), await r.text()).toBeTruthy();
}

async function stockOf(request, admin, id) {
  return Number((await (await request.get(`/api/inventario/${id}`, { headers: authHeaders(admin) })).json()).stock_actual);
}

async function loginAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Revisión — facturar por orden', () => {
  test('1. una cantidad fraccionaria se factura por su subtotal exacto', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
    await anexarServicioOrden(request, orden.id, { tipo_servicio: 'ESTETICA', nombre_servicio: testTag('medio'), cantidad: 0.5, precio_unitario: 40 }, admin);
    await anexarServicioOrden(request, orden.id, { tipo_servicio: 'ESTETICA', nombre_servicio: testTag('entero'), cantidad: 2, precio_unitario: 10 }, admin);
    await confirmarServiciosOrden(request, orden.id, admin);
    await cerrar(request, admin, orden.id);

    const pend = await (await request.get(`/api/ordenes/${orden.id}/pendientes-facturar`, { headers: authHeaders(admin) })).json();
    expect(pend.total).toBeCloseTo(40, 2);
    const res = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 40 }, admin);
    expect(res.status(), await res.text()).toBe(201);
    const f = await res.json();
    expect(f.total).toBeCloseTo(40, 2);
    expect(f.estado).toBe('PAGADA');
    const medio = f.detalles.find((d) => d.descripcion.includes('0.5'));
    expect(medio.cantidad).toBe(1);
    expect(medio.precio_unitario).toBeCloseTo(20, 2);
    await anularTestFactura(request, f.id, admin);
  });

  test('2. si el honorario ya se facturó aparte, el resto de la orden se factura igual', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    const consulta = await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id, orden_id: orden.id }, admin);
    await anexarServicioOrden(request, orden.id, { tipo_servicio: 'ESTETICA', nombre_servicio: testTag('extra'), precio_unitario: 500 }, admin);
    await confirmarServiciosOrden(request, orden.id, admin);

    // El honorario se cobra aparte, en una factura con la consulta.
    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(admin) })).json();
    const linea = detalle.servicios.find((s) => s.tipo_servicio === 'CONSULTA');
    const aparte = await request.post('/api/facturas/', {
      headers: authHeaders(admin),
      data: { propietario_id: prop.id, consulta_id: consulta.id, total_pagado: 0,
              detalles: [{ descripcion: 'Honorario', cantidad: 1, precio_unitario: linea.precio_unitario, servicio_id: linea.id }] },
    });
    expect(aparte.status(), await aparte.text()).toBe(201);

    await cerrar(request, admin, orden.id);
    const res = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 500 }, admin);
    expect(res.status(), await res.text()).toBe(201);
    const f = await res.json();
    expect(f.consulta_id).toBeNull();
    expect(f.detalles).toHaveLength(1);
    expect(f.total).toBeCloseTo(500, 2);
    const orden2 = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(admin) })).json();
    expect(orden2.estado).toBe('FACTURADA');
  });

  test('8. una orden cerrada sin nada pendiente no aparece "por cobrar"', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
    const s = await anexarServicioOrden(request, orden.id, { tipo_servicio: 'ESTETICA', nombre_servicio: testTag('cancelado'), precio_unitario: 100 }, admin);
    const c = await request.patch(`/api/servicios/${s.id}`, { headers: authHeaders(admin), data: { estado: 'CANCELADO' } });
    expect(c.ok(), await c.text()).toBeTruthy();
    await cerrar(request, admin, orden.id);

    const cerradas = await (await request.get(`/api/ordenes/?estado=CERRADA&propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(cerradas.map((o) => o.id)).toContain(orden.id);
    const porCobrar = await (await request.get(`/api/ordenes/?por_cobrar=true&propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(porCobrar.map((o) => o.id)).not.toContain(orden.id);
  });
});

test.describe('Revisión — consumo y comisiones', () => {
  test('4. el consumo real indicado al agregar el servicio se respeta al ejecutar', async ({ request }) => {
    const admin = await getAdminToken(request);
    const material = await createTestProduct(request, {
      categoria: 'Insumo', tipo_item: 'MATERIAL', unidad_medida: 'ml', contenido_por_envase: 1000, stock_actual: 1000, precio_unitario: 1,
    }, admin);
    const cat = await createTestCatalogoServicio(request, { categoria: 'PELUQUERIA', precio_ref: 100 });
    const rec = await request.post(`/api/catalogo/${cat.id}/recetas`, {
      headers: authHeaders(admin), data: { inventario_id: material.id, cantidad: 50, unidad_medida: 'ml' },
    });
    expect(rec.ok()).toBeTruthy();

    const prop = await createTestPropietario(request, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
    await anexarServicioOrden(request, orden.id, {
      catalogo_servicio_id: cat.id, tipo_servicio: 'ESTETICA', nombre_servicio: testTag('bano'), precio_unitario: 100,
      consumos: [{ inventario_id: material.id, cantidad: 7 }],
    }, admin);
    expect(await stockOf(request, admin, material.id)).toBe(1000); // agregar no descuenta
    await confirmarServiciosOrden(request, orden.id, admin); // sin área: se ejecuta al confirmar
    expect(await stockOf(request, admin, material.id)).toBe(993); // 7, no los 50 de la receta
  });

  test('4b. editar el consumo antes de ejecutar lo actualiza, y 0 significa "no se usó"', async ({ request }) => {
    const admin = await getAdminToken(request);
    const material = await createTestProduct(request, {
      categoria: 'Insumo', tipo_item: 'MATERIAL', unidad_medida: 'ml', contenido_por_envase: 1000, stock_actual: 1000, precio_unitario: 1,
    }, admin);
    const cat = await createTestCatalogoServicio(request, { categoria: 'PELUQUERIA', precio_ref: 100 });
    await request.post(`/api/catalogo/${cat.id}/recetas`, { headers: authHeaders(admin), data: { inventario_id: material.id, cantidad: 50, unidad_medida: 'ml' } });
    const prop = await createTestPropietario(request, {}, admin);

    // Editado en SOLICITADO: 50 al agregar -> 10 por PATCH -> se descuentan 10.
    const o1 = await createTestOrden(request, { propietarioId: prop.id }, admin);
    const s1 = await anexarServicioOrden(request, o1.id, {
      catalogo_servicio_id: cat.id, tipo_servicio: 'ESTETICA', nombre_servicio: testTag('a'), precio_unitario: 100,
      consumos: [{ inventario_id: material.id, cantidad: 50 }],
    }, admin);
    const pt = await request.patch(`/api/servicios/${s1.id}`, { headers: authHeaders(admin), data: { consumos: [{ inventario_id: material.id, cantidad: 10 }] } });
    expect(pt.ok(), await pt.text()).toBeTruthy();
    await confirmarServiciosOrden(request, o1.id, admin);
    expect(await stockOf(request, admin, material.id)).toBe(990);

    // Cero: no se descuenta nada.
    const o2 = await createTestOrden(request, { propietarioId: prop.id }, admin);
    await anexarServicioOrden(request, o2.id, {
      catalogo_servicio_id: cat.id, tipo_servicio: 'ESTETICA', nombre_servicio: testTag('b'), precio_unitario: 100,
      consumos: [{ inventario_id: material.id, cantidad: 0 }],
    }, admin);
    await confirmarServiciosOrden(request, o2.id, admin);
    expect(await stockOf(request, admin, material.id)).toBe(990);
  });

  test('6. el honorario re-cobrado por consulta tras anular la factura de la orden genera comisión', async ({ request }) => {
    const admin = await getAdminToken(request);
    const vet = await createTestVeterinario(request, admin);
    await setPorcentajeEncargado(request, admin, vet.id, 30);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    const consulta = await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id, orden_id: orden.id, precio_consulta: 25000 }, admin);
    await cerrar(request, admin, orden.id);
    const a = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 25000 }, admin);
    expect(a.status(), await a.text()).toBe(201);
    await request.post(`/api/facturas/${(await a.json()).id}/anular`, { headers: authHeaders(admin) });

    const b = await request.post(`/api/facturas/from-consulta/${consulta.id}`, { headers: authHeaders(admin), data: { metodo_pago: 'EFECTIVO', total_pagado: 25000 } });
    expect(b.status(), await b.text()).toBe(201);
    expect((await b.json()).estado).toBe('PAGADA');

    const c = await (await controlComisiones(request, admin, vet.id, hoy(), hoy())).json();
    expect(c.pendientes).toHaveLength(1);
    expect(Number(c.pendientes[0].monto_encargado)).toBe(7500);
  });

  test('5. la comisión se calcula sobre lo cobrado, con el descuento de la factura', async ({ request }) => {
    const admin = await getAdminToken(request);
    const area = await createTestArea(request, admin);
    const gestor = await createTestGestor(request, admin);
    await agregarGestorArea(request, admin, area.id, gestor.user.id);
    await setPorcentajeEncargado(request, admin, gestor.user.id, 40);
    const cat = await createTestCatalogoServicio(request, { area_id: area.id, categoria: 'LABORATORIO', precio_ref: 1000 });
    const prop = await createTestPropietario(request, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
    const s = await anexarServicioOrden(request, orden.id, { catalogo_servicio_id: cat.id, tipo_servicio: 'LABORATORIO', nombre_servicio: testTag('hemo'), precio_unitario: 1000 }, admin);
    await confirmarServiciosOrden(request, orden.id, admin);
    expect((await tomarServicio(request, s.id, gestor.token)).ok()).toBeTruthy();
    expect((await request.patch(`/api/servicios/${s.id}`, { headers: authHeaders(gestor.token), data: { estado: 'EJECUTADO' } })).ok()).toBeTruthy();
    await cerrar(request, admin, orden.id);
    const res = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', descuento: 100, total_pagado: 900 }, admin);
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).estado).toBe('PAGADA');

    const c = await (await controlComisiones(request, admin, gestor.user.id, hoy(), hoy())).json();
    expect(c.pendientes).toHaveLength(1);
    expect(Number(c.pendientes[0].subtotal)).toBe(900);
    expect(Number(c.pendientes[0].monto_encargado)).toBe(360);
  });

  test('10. las fechas de las liquidaciones se muestran en el día local', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const area = await createTestArea(request, admin);
    const gestor = await createTestGestor(request, admin);
    await agregarGestorArea(request, admin, area.id, gestor.user.id);
    await setPorcentajeEncargado(request, admin, gestor.user.id, 40);
    const cat = await createTestCatalogoServicio(request, { area_id: area.id, categoria: 'LABORATORIO', precio_ref: 1000 });
    const prop = await createTestPropietario(request, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id }, admin);
    const s = await anexarServicioOrden(request, orden.id, { catalogo_servicio_id: cat.id, tipo_servicio: 'LABORATORIO', nombre_servicio: testTag('x'), precio_unitario: 1000 }, admin);
    await confirmarServiciosOrden(request, orden.id, admin);
    await tomarServicio(request, s.id, gestor.token);
    await request.patch(`/api/servicios/${s.id}`, { headers: authHeaders(gestor.token), data: { estado: 'EJECUTADO' } });
    await cerrar(request, admin, orden.id);
    await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 1000 }, admin);
    const liq = await (await liquidarComisiones(request, admin, gestor.user.id, hoy(), hoy())).json();

    await loginAdmin(page);
    await gotoSection(page, 'sec-reportes');
    await page.selectOption('#comEncargadoSelect', String(gestor.user.id));
    const fila = page.locator(`#comLiquidacionesLista [data-com-liquidacion="${liq.id}"]`);
    await expect(fila).toBeVisible({ timeout: 15000 });
    const [y, m, d] = hoy().split('-').map(Number);
    const esperado = await page.evaluate(([yy, mm, dd]) => new Date(yy, mm - 1, dd).toLocaleDateString(), [y, m, d]);
    await expect(fila).toContainText(`${esperado} a ${esperado}`);
  });
});

test.describe('Revisión — caja rápida e historia clínica', () => {
  test('7. anular una venta de caja rápida anula su orden y no la vuelve "por cobrar"', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const cat = await createTestCatalogoServicio(request, { categoria: 'PELUQUERIA', precio_ref: 300 });
    const r = await ventaRapida(request, { propietario_id: prop.id, metodo_pago: 'EFECTIVO', items: [{ tipo: 'SERVICIO', id: cat.id, cantidad: 1 }] }, admin);
    expect(r.status(), await r.text()).toBe(201);
    const factura = await r.json();
    const an = await request.post(`/api/facturas/${factura.id}/anular`, { headers: authHeaders(admin) });
    expect(an.ok(), await an.text()).toBeTruthy();

    const ordenes = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(ordenes).toHaveLength(1);
    expect(ordenes[0].estado).toBe('ANULADA');
    const porCobrar = await (await request.get(`/api/ordenes/?por_cobrar=true&propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(porCobrar).toHaveLength(0);
  });

  test('7b. anular una venta de caja rápida devuelve el material de sus servicios y los cancela', async ({ request }) => {
    const admin = await getAdminToken(request);
    const material = await createTestProduct(request, {
      categoria: 'Insumo', tipo_item: 'MATERIAL', unidad_medida: 'ml', contenido_por_envase: 1000, stock_actual: 1000, precio_unitario: 1,
    }, admin);
    const cat = await createTestCatalogoServicio(request, { categoria: 'PELUQUERIA', precio_ref: 300 });
    await request.post(`/api/catalogo/${cat.id}/recetas`, { headers: authHeaders(admin), data: { inventario_id: material.id, cantidad: 50, unidad_medida: 'ml' } });
    const prop = await createTestPropietario(request, {}, admin);
    const r = await ventaRapida(request, { propietario_id: prop.id, metodo_pago: 'EFECTIVO', items: [{ tipo: 'SERVICIO', id: cat.id, cantidad: 1 }] }, admin);
    expect(r.status()).toBe(201);
    expect(await stockOf(request, admin, material.id)).toBe(950);
    await request.post(`/api/facturas/${(await r.json()).id}/anular`, { headers: authHeaders(admin) });
    expect(await stockOf(request, admin, material.id)).toBe(1000);
    const [orden] = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(admin) })).json();
    expect(detalle.estado).toBe('ANULADA');
    expect(detalle.anulada_por_id).toBeTruthy();
    expect(detalle.servicios.every((s) => s.estado === 'CANCELADO')).toBe(true);
  });

  test('2b. una nota libre en las observaciones de otra factura no anula una venta de caja ajena', async ({ request }) => {
    const admin = await getAdminToken(request);
    const p = await createTestProduct(request, { stock_actual: 5, precio_unitario: 100 }, admin);
    const prop = await createTestPropietario(request, {}, admin);
    const r = await ventaRapida(request, { propietario_id: prop.id, metodo_pago: 'EFECTIVO', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 1 }] }, admin);
    expect(r.status()).toBe(201);
    const [orden] = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();

    const manual = await request.post('/api/facturas/', {
      headers: authHeaders(admin),
      data: { propietario_id: prop.id, observaciones: `Reintegro orden ${orden.numero}`, total_pagado: 0,
              detalles: [{ descripcion: 'Ajuste manual', cantidad: 1, precio_unitario: 10 }] },
    });
    expect(manual.status(), await manual.text()).toBe(201);
    await request.post(`/api/facturas/${(await manual.json()).id}/anular`, { headers: authHeaders(admin) });
    const [despues] = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(despues.estado).toBe('FACTURADA');
  });

  test('7c. anular una venta de caja rápida solo de productos también anula su orden', async ({ request }) => {
    const admin = await getAdminToken(request);
    const p = await createTestProduct(request, { stock_actual: 5, precio_unitario: 100 }, admin);
    const prop = await createTestPropietario(request, {}, admin);
    const r = await ventaRapida(request, { propietario_id: prop.id, metodo_pago: 'EFECTIVO', items: [{ tipo: 'PRODUCTO', id: p.id, cantidad: 2 }] }, admin);
    expect(r.status()).toBe(201);
    await request.post(`/api/facturas/${(await r.json()).id}/anular`, { headers: authHeaders(admin) });
    expect(await stockOf(request, admin, p.id)).toBe(5);
    const [orden] = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(orden.estado).toBe('ANULADA');
  });

  test('9. una consulta sin orden muestra "Facturar" y se factura', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const consulta = await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    // Sin su línea CONSULTA, la consulta queda sin orden (orden_id derivado = null).
    const c0 = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(admin) })).json();
    const linea = (c0.servicios || []).find((s) => s.tipo_servicio === 'CONSULTA');
    expect((await request.delete(`/api/servicios/${linea.id}`, { headers: authHeaders(admin) })).ok()).toBeTruthy();
    const c1 = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(admin) })).json();
    expect(c1.orden_id ?? null).toBeNull();

    await loginAdmin(page);
    await gotoSection(page, 'sec-consultorio');
    const nombreBase = mascota.nombre.split(' ')[0];
    await page.fill('#consultorioSearchMascota', nombreBase);
    await page.locator('#consultorioMascotasList .pet-list-item', { hasText: nombreBase }).first().click();
    await page.click('.pet-nav-item[data-tab="consultas"]');
    const btn = page.locator('#sec-consultorio').getByRole('button', { name: /Facturar$/ });
    await expect(btn).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#sec-consultorio').getByRole('button', { name: /Ir a la orden/ })).toHaveCount(0);
    page.once('dialog', (dlg) => dlg.accept());
    await btn.click();
    await expect(page.locator('.notification-toast', { hasText: /Factura #/ }).first()).toBeVisible({ timeout: 10000 });

    const facturas = await (await request.get(`/api/facturas/?propietario_id=${prop.id}&limit=10`, { headers: authHeaders(admin) })).json();
    const f = facturas.find((x) => x.consulta_id === consulta.id);
    expect(f).toBeTruthy();
    // Solo el honorario: una línea, sin servicio_id, por precio_consulta.
    expect(f.detalles).toHaveLength(1);
    expect(f.detalles[0].servicio_id ?? null).toBeNull();
    expect(f.total).toBeCloseTo(c0.precio_consulta, 2);
    await anularTestFactura(request, f.id, admin);
  });

  test('1c. el honorario que le falta a la orden se agrega y se cobra con ella', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const consulta = await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id, precio_consulta: 25000 }, admin);
    const srv = await anexarServicioConsulta(request, consulta.id, { precio_unitario: 1000 }, admin);
    const c0 = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(admin) })).json();
    const linea = c0.servicios.find((x) => x.tipo_servicio === 'CONSULTA');
    await request.delete(`/api/servicios/${linea.id}`, { headers: authHeaders(admin) });
    const c1 = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(admin) })).json();
    expect(c1.orden_id).toBe(srv.orden_id);
    expect(c1.honorario_en_orden).toBe(false);

    // UI: ofrece "Ir a la orden" y "Agregar honorario a la orden".
    await loginAdmin(page);
    await gotoSection(page, 'sec-consultorio');
    const nombreBase = mascota.nombre.split(' ')[0];
    await page.fill('#consultorioSearchMascota', nombreBase);
    await page.locator('#consultorioMascotasList .pet-list-item', { hasText: nombreBase }).first().click();
    await page.click('.pet-nav-item[data-tab="consultas"]');
    const seccion = page.locator('#sec-consultorio');
    await expect(seccion.getByRole('button', { name: /Ir a la orden/ })).toBeVisible({ timeout: 15000 });
    page.once('dialog', (d) => d.accept());
    await seccion.getByRole('button', { name: /Agregar honorario a la orden/ }).click();
    await expect(page.locator('.notification-toast', { hasText: /Honorario agregado/ }).first()).toBeVisible({ timeout: 10000 });
    await expect(seccion.getByRole('button', { name: /Agregar honorario a la orden/ })).toHaveCount(0);

    // La orden ahora lista el honorario para cobrarlo, y no se puede agregar dos veces.
    const pend = await (await request.get(`/api/ordenes/${srv.orden_id}/pendientes-facturar`, { headers: authHeaders(admin) })).json();
    expect(pend.items.some((it) => it.descripcion === 'Consulta veterinaria' && it.precio_unitario === 25000)).toBe(true);
    const otra = await request.post(`/api/consultas/${consulta.id}/honorario-en-orden`, { headers: authHeaders(admin), data: {} });
    expect(otra.status()).toBe(409);
  });

  test('9b. una consulta sin línea CONSULTA pero con servicios llega a su orden por ellos', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const consulta = await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    const srv = await anexarServicioConsulta(request, consulta.id, {}, admin);
    const c0 = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(admin) })).json();
    const linea = c0.servicios.find((s) => s.tipo_servicio === 'CONSULTA');
    expect((await request.delete(`/api/servicios/${linea.id}`, { headers: authHeaders(admin) })).ok()).toBeTruthy();
    const c1 = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(admin) })).json();
    expect(c1.orden_id).toBe(srv.orden_id);
  });

  test('3. from-consulta factura una cantidad fraccionaria por su subtotal exacto', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const consulta = await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    const srv = await anexarServicioConsulta(request, consulta.id, { nombre_servicio: testTag('medio'), cantidad: 0.5, precio_unitario: 40, estado: 'EJECUTADO' }, admin);
    const res = await request.post(`/api/facturas/from-consulta/${consulta.id}`, { headers: authHeaders(admin), data: {} });
    expect(res.status(), await res.text()).toBe(201);
    const f = await res.json();
    const linea = f.detalles.find((d) => d.servicio_id === srv.id);
    expect(linea.cantidad).toBe(1);
    expect(linea.precio_unitario).toBeCloseTo(20, 2);
    await anularTestFactura(request, f.id, admin);
  });
});
