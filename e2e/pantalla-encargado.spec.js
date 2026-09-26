// @ts-check
// Pantalla del encargado de área (pantalla-encargado).
//
//   - Sin búsqueda global para el gestor (botón oculto, la paleta no abre).
//   - Rubro: GET /api/areas/mias + cabecera y chips por área.
//   - Realizados: GET /api/servicios/realizados + pestaña con adjuntos.
//   - Mis comisiones: GET /api/comisiones/mias/liquidaciones + pestaña.
const { test, expect } = require('@playwright/test');
const {
  TEST_USER_PASSWORD,
  getAdminToken,
  authHeaders,
  testTag,
  loginAs,
  createTestVeterinario,
  createTestGestor,
  createTestRecepcionista,
  deleteTestUser,
  createTestArea,
  desactivarTestArea,
  agregarGestorArea,
  createTestCatalogoServicio,
  createTestPropietario,
  createTestMascota,
  createTestOrden,
  anexarServicioOrden,
  confirmarServiciosOrden,
  tomarServicio,
  subirAdjunto,
  facturarOrden,
  setPorcentajeEncargado,
  liquidarComisiones,
} = require('./helpers');

const hoy = () => new Date().toISOString().slice(0, 10);

/** Gestor nuevo, gestor de un área nueva (nombre legible para la UI). */
async function gestorConArea(request, admin, nombreArea = testTag('Lab')) {
  const area = await createTestArea(request, admin, { nombre: nombreArea });
  const gestor = await createTestGestor(request, admin);
  await agregarGestorArea(request, admin, area.id, gestor.user.id);
  const cat = await createTestCatalogoServicio(request, { area_id: area.id, categoria: 'LABORATORIO', precio_ref: 1000 });
  return { area, gestor, cat };
}

/** Orden con un servicio del área, confirmado (queda ASIGNADO en la bandeja). */
async function servicioAsignado(request, admin, { cat }, { nombre = testTag('hemograma'), precio = 1000 } = {}) {
  const prop = await createTestPropietario(request, {}, admin);
  const mascota = await createTestMascota(request, prop.id);
  const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id }, admin);
  const srv = await anexarServicioOrden(request, orden.id, {
    catalogo_servicio_id: cat.id, tipo_servicio: 'LABORATORIO', nombre_servicio: nombre, precio_unitario: precio,
  }, admin);
  await confirmarServiciosOrden(request, orden.id, admin);
  return { orden, servicio: srv, mascota };
}

/** Toma y ejecuta el servicio como el gestor, opcionalmente con adjunto. */
async function ejecutar(request, gestor, servicioId, { adjunto = false } = {}) {
  expect((await tomarServicio(request, servicioId, gestor.token)).ok()).toBeTruthy();
  if (adjunto) expect((await subirAdjunto(request, servicioId, gestor.token)).ok()).toBeTruthy();
  const r = await request.patch(`/api/servicios/${servicioId}`, {
    headers: authHeaders(gestor.token), data: { estado: 'EJECUTADO', detalles_clinicos: 'Valores normales' },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
}

/** Cierra la orden y la cobra completa. */
async function cobrar(request, admin, orden) {
  expect((await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(admin) })).ok()).toBeTruthy();
  const pend = await (await request.get(`/api/ordenes/${orden.id}/pendientes-facturar`, { headers: authHeaders(admin) })).json();
  const f = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: pend.total }, admin);
  expect(f.status(), await f.text()).toBe(201);
}

async function loginUI(page, username, password = TEST_USER_PASSWORD) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Pantalla del encargado — búsqueda global', () => {
  test('el gestor no ve el buscador y Ctrl/Cmd+K no abre la paleta', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const { user } = await createTestGestor(request, admin);
    try {
      await loginUI(page, user.username);
      await expect(page.locator('#sec-bandeja-gestor')).toBeVisible();
      await expect(page.locator('#cmdkTrigger')).toBeHidden();
      await page.keyboard.press('Control+k');
      await page.keyboard.press('Meta+k');
      await expect(page.locator('.av-cmdk-backdrop')).toHaveCount(0);
    } finally {
      await deleteTestUser(request, admin, user.id);
    }
  });

  test('un veterinario sí ve el buscador y lo abre', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const vet = await createTestVeterinario(request, admin);
    try {
      await loginUI(page, vet.username);
      await expect(page.locator('#cmdkTrigger')).toBeVisible();
      await page.locator('#cmdkTrigger').click();
      await expect(page.locator('.av-cmdk-backdrop')).toBeVisible();
    } finally {
      await deleteTestUser(request, admin, vet.id);
    }
  });
});

test.describe('Pantalla del encargado — rubro', () => {
  test('GET /areas/mias devuelve solo las áreas activas propias', async ({ request }) => {
    const admin = await getAdminToken(request);
    const a = await gestorConArea(request, admin);
    const b = await gestorConArea(request, admin);
    const inactiva = await createTestArea(request, admin);
    await agregarGestorArea(request, admin, inactiva.id, a.gestor.user.id);
    await desactivarTestArea(request, admin, inactiva.id);

    const res = await request.get('/api/areas/mias', { headers: authHeaders(a.gestor.token) });
    expect(res.ok()).toBeTruthy();
    const ids = (await res.json()).map((x) => x.id);
    expect(ids).toEqual([a.area.id]);
    expect(ids).not.toContain(b.area.id);
  });

  test('la cabecera muestra el rubro aunque la bandeja esté vacía; sin áreas muestra un aviso', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const nombre = testTag('Laboratorio');
    const { gestor } = await gestorConArea(request, admin, nombre);
    await loginUI(page, gestor.user.username);
    await expect(page.locator('#bgRubro')).toContainText(nombre);
    await expect(page.locator('#bgFilters')).toContainText(nombre);
    await expect(page.locator('#bgQueueBody')).toContainText('No hay nada pendiente');

    const sinArea = await createTestGestor(request, admin);
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await loginUI(page, sinArea.user.username);
    await expect(page.locator('#bgRubro')).toContainText('Todavía no tenés un área asignada');
  });

  test('un servicio con nombre HTML se muestra literal y no se ejecuta', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin);
    const malicioso = '<img src=x onerror="window.__xss=1">';
    await servicioAsignado(request, admin, ctx, { nombre: malicioso });
    await loginUI(page, ctx.gestor.user.username);
    await expect(page.locator('#bgQueueBody')).toContainText(malicioso);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('#bgQueueBody img')).toHaveCount(0);
  });
});

test.describe('Pantalla del encargado — realizados', () => {
  test('API: lo propio ejecutado, ordenado; sin lo ajeno; filtros de rango y área', async ({ request }) => {
    const admin = await getAdminToken(request);
    const a = await gestorConArea(request, admin);
    const b = await gestorConArea(request, admin);
    const s1 = await servicioAsignado(request, admin, a);
    const s2 = await servicioAsignado(request, admin, a);
    const sb = await servicioAsignado(request, admin, b);
    await ejecutar(request, a.gestor, s1.servicio.id, { adjunto: true });
    await ejecutar(request, a.gestor, s2.servicio.id);
    await ejecutar(request, b.gestor, sb.servicio.id);

    const res = await request.get(`/api/servicios/realizados?desde=${hoy()}&hasta=${hoy()}`, { headers: authHeaders(a.gestor.token) });
    expect(res.ok()).toBeTruthy();
    const lista = await res.json();
    expect(lista.map((x) => x.id)).toEqual([s2.servicio.id, s1.servicio.id]);
    const r1 = lista.find((x) => x.id === s1.servicio.id);
    expect(r1.adjuntos).toBe(1);
    expect(r1.area_nombre).toBe(a.area.nombre);
    // La respuesta de alta de la mascota decora el nombre; el servicio trae el nombre real.
    expect(s1.mascota.nombre.startsWith(r1.mascota_nombre)).toBe(true);
    expect(r1.orden_numero).toBe(s1.orden.numero);

    const ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const vacio = await (await request.get(`/api/servicios/realizados?desde=${ayer}&hasta=${ayer}`, { headers: authHeaders(a.gestor.token) })).json();
    expect(vacio).toEqual([]);

    const propia = await request.get(`/api/servicios/realizados?desde=${hoy()}&hasta=${hoy()}&area_id=${a.area.id}`, { headers: authHeaders(a.gestor.token) });
    expect((await propia.json()).length).toBe(2);
    const ajena = await request.get(`/api/servicios/realizados?area_id=${b.area.id}`, { headers: authHeaders(a.gestor.token) });
    expect(ajena.status()).toBe(403);
  });

  test('UI: el servicio realizado aparece en "Realizados" y su adjunto se descarga', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin);
    const { servicio } = await servicioAsignado(request, admin, ctx);
    await ejecutar(request, ctx.gestor, servicio.id, { adjunto: true });

    await loginUI(page, ctx.gestor.user.username);
    await page.click('#bgTabRealizados');
    await expect(page.locator('#bgViewRealizados')).toBeVisible();
    await expect(page.locator('#bgViewBandeja')).toBeHidden();
    const fila = page.locator(`[data-real-id="${servicio.id}"]`);
    await expect(fila).toContainText(servicio.nombre_servicio);
    await fila.getByRole('button', { name: 'Ver' }).click();
    const detalle = page.locator(`[data-real-detalle="${servicio.id}"]`);
    await expect(detalle).toContainText('Valores normales');
    const descarga = page.waitForEvent('download');
    await detalle.getByRole('button', { name: /Descargar resultado\.pdf/ }).click();
    expect((await descarga).suggestedFilename()).toBe('resultado.pdf');
  });
});

test.describe('Pantalla del encargado — mis comisiones', () => {
  test('API: /comisiones/mias/liquidaciones devuelve solo lo propio; recepcionista 403', async ({ request }) => {
    const admin = await getAdminToken(request);
    const a = await gestorConArea(request, admin);
    const b = await gestorConArea(request, admin);
    for (const ctx of [a, b]) {
      await setPorcentajeEncargado(request, admin, ctx.gestor.user.id, 40);
      const { orden, servicio } = await servicioAsignado(request, admin, ctx);
      await ejecutar(request, ctx.gestor, servicio.id);
      await cobrar(request, admin, orden);
      expect((await liquidarComisiones(request, admin, ctx.gestor.user.id, hoy(), hoy())).status()).toBe(201);
    }
    const res = await request.get('/api/comisiones/mias/liquidaciones', { headers: authHeaders(a.gestor.token) });
    expect(res.ok()).toBeTruthy();
    const lista = await res.json();
    expect(lista).toHaveLength(1);
    expect(lista[0].encargado_id).toBe(a.gestor.user.id);

    const { token: recep } = await createTestRecepcionista(request, admin);
    expect((await request.get('/api/comisiones/mias/liquidaciones', { headers: authHeaders(recep) })).status()).toBe(403);
  });

  test('UI: el gestor ve su pendiente y descarga el PDF de su liquidación', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const ctx = await gestorConArea(request, admin);
    await setPorcentajeEncargado(request, admin, ctx.gestor.user.id, 40);
    const uno = await servicioAsignado(request, admin, ctx, { precio: 1000 });
    await ejecutar(request, ctx.gestor, uno.servicio.id);
    await cobrar(request, admin, uno.orden);
    expect((await liquidarComisiones(request, admin, ctx.gestor.user.id, hoy(), hoy())).status()).toBe(201);
    const dos = await servicioAsignado(request, admin, ctx, { precio: 2000 });
    await ejecutar(request, ctx.gestor, dos.servicio.id);
    await cobrar(request, admin, dos.orden);

    await loginUI(page, ctx.gestor.user.username);
    await page.click('#bgTabComisiones');
    await expect(page.locator('#bgComWrap')).toContainText(dos.servicio.nombre_servicio);
    await expect(page.locator('#bgComTotalesPendientes')).toContainText('$800.00');
    const liq = page.locator('#bgComLiquidaciones [data-bg-liquidacion]');
    await expect(liq).toHaveCount(1);
    const descarga = page.waitForEvent('download');
    await liq.getByRole('button', { name: 'Descargar PDF' }).click();
    expect((await descarga).suggestedFilename()).toMatch(/^Liquidacion_LC-\d{6}\.pdf$/);
  });
});
