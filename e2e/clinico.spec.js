// Unidad — Clínica extendida
//   /api/clinico  · /api/pruebas · /api/cirugias · /api/hospitalizaciones
//
// Para una mascota sembrada por API se cubre:
//   - vacunación:      POST /api/clinico/vacunacion   + GET /api/clinico/vacunaciones/{id}
//   - desparasitación: POST /api/clinico/desparasitacion + GET .../desparasitaciones/{id}
//   - hospitalización: POST /api/hospitalizaciones/ + GET / (activos)
//                      + PUT /api/hospitalizaciones/{id}/dar-alta
//                      + GET /api/clinico/hospitalizaciones/{id}
//   - cirugía:         POST /api/cirugias/ + GET /api/cirugias/mascota/{id}
//   - prueba compl.:   CRUD completo de /api/pruebas (POST, list, GET{id}, PUT, DELETE)
//
// Payloads y reglas tomados de backend/app/schemas/schemas.py y de los routers
// clinico/pruebas/cirugias/hospitalizaciones. vacunación y desparasitación
// descuentan stock de inventario y exigen una consulta previa.
//
// Criterio UI vs API: la mayoría va por API (los formularios de pestaña
// clínica dependen de la selección de paciente y de combos custom). Se recorre
// UNA registración por la UI —cirugía, que no toca inventario— desde la
// pestaña "procedimientos" del expediente, y se contrasta con la API.
//
// Nada se mockea: no interviene Supabase / QR.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestVeterinario,
  deleteTestUser,
  createTestConsulta,
  deleteTestConsulta,
  createTestProduct,
  deleteTestProduct,
  createTestVacunacion,
  createTestDesparasitacion,
  createTestHospitalizacion,
  createTestCirugia,
  createTestPrueba,
  deleteTestPrueba,
} = require('./helpers');

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

async function seleccionarPacientePorUI(page, mascota) {
  const nombreBase = mascota.nombre.split(' ')[0];
  await page.click('.menu-item[data-target="sec-consultorio"]');
  await page.fill('#consultorioSearchMascota', nombreBase);
  const item = page.locator('#consultorioMascotasList .pet-list-item', { hasText: nombreBase }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator('#patientWrapper')).toBeVisible();
}

test.describe.serial('Clínica extendida — vacunación, desparasitación, hospitalización, cirugía, pruebas', () => {
  const S = {
    token: null,
    propietario: null,
    mascota: null,
    vet: null,
    consulta: null,
    vacunaProd: null,
    despProd: null,
    hosp: null,
    pruebaApi: null,
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);
    S.vet = await createTestVeterinario(request, S.token);
    S.consulta = await createTestConsulta(request, { mascotaId: S.mascota.id, veterinarioId: S.vet.id });
    S.vacunaProd = await createTestProduct(request, { categoria: 'Vacuna', stock_actual: 20, stock_minimo: 2, precio_unitario: 500 });
    S.despProd = await createTestProduct(request, { categoria: 'Antiparasitario', stock_actual: 20, stock_minimo: 2, precio_unitario: 300 });
  });

  test.afterAll(async ({ request }) => {
    if (S.pruebaApi?.id) await deleteTestPrueba(request, S.pruebaApi.id);
    if (S.consulta?.id) await deleteTestConsulta(request, S.consulta.id);
    if (S.vacunaProd?.id) await deleteTestProduct(request, S.vacunaProd.id);
    if (S.despProd?.id) await deleteTestProduct(request, S.despProd.id);
    if (S.vet?.id) await deleteTestUser(request, S.token, S.vet.id);
    if (S.mascota?.id) await deleteTestMascota(request, S.mascota.id);
    if (S.propietario?.id) await deleteTestPropietario(request, S.propietario.id);
  });

  test('vacunación: aplica, descuenta stock, deja servicio en la consulta y lista', async ({ request }) => {
    const antes = await (await request.get(`/api/inventario/${S.vacunaProd.id}`)).json();

    const vac = await createTestVacunacion(request, { consultaId: S.consulta.id, vacunaId: S.vacunaProd.id, lote: 'PWTEST-L1' });
    expect(vac.id).toBeTruthy();
    expect(vac.vacuna_id).toBe(S.vacunaProd.id);
    expect(vac.fecha_aplicacion).toBeTruthy();

    // Stock descontado en 1.
    const despues = await (await request.get(`/api/inventario/${S.vacunaProd.id}`)).json();
    expect(despues.stock_actual).toBe(antes.stock_actual - 1);

    // Aparece en el historial de vacunaciones de la mascota.
    const lista = await (await request.get(`/api/clinico/vacunaciones/${S.mascota.id}`)).json();
    const enLista = lista.find((v) => v.id === vac.id);
    expect(enLista).toBeTruthy();
    expect(enLista.vacuna_nombre).toBe(S.vacunaProd.nombre);

    // El router crea un ServicioConsulta "VACUNACION" en la consulta.
    const consulta = await (await request.get(`/api/consultas/${S.consulta.id}`, { headers: authHeaders(S.token) })).json();
    expect(consulta.servicios.some((s) => s.tipo_servicio === 'VACUNACION')).toBe(true);

    // Consulta inexistente -> 404.
    const noCons = await request.post('/api/clinico/vacunacion', {
      data: { consulta_id: 99999999, vacuna_id: S.vacunaProd.id, lote: 'x' },
    });
    expect(noCons.status()).toBe(404);

    // Vacuna (producto) inexistente -> 404.
    const noVac = await request.post('/api/clinico/vacunacion', {
      data: { consulta_id: S.consulta.id, vacuna_id: 99999999, lote: 'x' },
    });
    expect(noVac.status()).toBe(404);
  });

  test('desparasitación: aplica, descuenta stock y lista', async ({ request }) => {
    const antes = await (await request.get(`/api/inventario/${S.despProd.id}`)).json();

    const desp = await createTestDesparasitacion(request, { consultaId: S.consulta.id, productoId: S.despProd.id, tipo: 'Externa', dosis: '2 ml' });
    expect(desp.id).toBeTruthy();
    expect(desp.fecha_aplicacion).toBeTruthy();

    const despues = await (await request.get(`/api/inventario/${S.despProd.id}`)).json();
    expect(despues.stock_actual).toBe(antes.stock_actual - 1);

    const lista = await (await request.get(`/api/clinico/desparasitaciones/${S.mascota.id}`)).json();
    const enLista = lista.find((d) => d.id === desp.id);
    expect(enLista).toBeTruthy();
    expect(enLista.tipo).toBe('Externa');
    expect(enLista.producto_nombre).toBe(S.despProd.nombre);

    // Producto inexistente -> 404.
    const noProd = await request.post('/api/clinico/desparasitacion', {
      data: { consulta_id: S.consulta.id, producto_id: 99999999, tipo: 'Interna', dosis: '1 ml' },
    });
    expect(noProd.status()).toBe(404);
  });

  test('hospitalización: ingreso, aparición en activos, alta y baja de activos', async ({ request }) => {
    S.hosp = await createTestHospitalizacion(request, { mascotaId: S.mascota.id, jaula_nro: 'J-7' });
    expect(S.hosp.id).toBeTruthy();
    expect(S.hosp.activo).toBe(true);
    expect(S.hosp.fecha_egreso).toBeNull();

    // Aparece en el listado de hospitalizados activos.
    const activos = await (await request.get('/api/hospitalizaciones/?activos=true')).json();
    expect(activos.some((h) => h.id === S.hosp.id)).toBe(true);

    // Aparece en el historial de la mascota (router clinico).
    const porMascota = await (await request.get(`/api/clinico/hospitalizaciones/${S.mascota.id}`)).json();
    expect(porMascota.some((h) => h.id === S.hosp.id)).toBe(true);

    // Dar de alta: cierra fecha_egreso y baja activo.
    const altaRes = await request.put(`/api/hospitalizaciones/${S.hosp.id}/dar-alta`);
    expect(altaRes.ok(), await altaRes.text()).toBeTruthy();
    const alta = await altaRes.json();
    expect(alta.activo).toBe(false);
    expect(alta.fecha_egreso).toBeTruthy();

    // Ya no está entre los activos.
    const activosDespues = await (await request.get('/api/hospitalizaciones/?activos=true')).json();
    expect(activosDespues.some((h) => h.id === S.hosp.id)).toBe(false);

    // Alta sobre id inexistente -> 404.
    const noHosp = await request.put('/api/hospitalizaciones/99999999/dar-alta');
    expect(noHosp.status()).toBe(404);

    // Ingreso con mascota inexistente -> 404.
    const noMascota = await request.post('/api/hospitalizaciones/', {
      data: { mascota_id: 99999999, motivo: 'x', dias_cama: 1 },
    });
    expect(noMascota.status()).toBe(404);
  });

  test('cirugía: registro por UI en la pestaña de procedimientos, contrastado por API', async ({ page, request }) => {
    const procedimiento = testTag('cirUI').slice(0, 55);

    await loginAsAdmin(page);
    await seleccionarPacientePorUI(page, S.mascota);

    await page.click('.pet-nav-item[data-tab="procedimientos"]');
    await page.click('button:has-text("+ Registrar Cirugía")');
    await expect(page.locator('#formCirugia')).toBeVisible();

    // El combo de consultas se hidrata desde /consultas/?mascota_id=; elegimos la sembrada.
    await page.selectOption('#formCirugia select[name="consulta_id"]', String(S.consulta.id));
    await page.fill('#formCirugia input[name="tipo_procedimiento"]', procedimiento);
    await page.selectOption('#formCirugia select[name="riesgo_asa"]', 'III');
    await page.click('#formCirugia button[type="submit"]');

    // submitClinico refresca la pestaña; la fila aparece en la tabla.
    await expect(page.locator('#petTabContent')).toContainText(procedimiento);

    // Contraste API: el router clinico guarda la cirugía ligada a la mascota.
    const lista = await (await request.get(`/api/clinico/cirugias/${S.mascota.id}`)).json();
    const creada = lista.find((c) => c.tipo_procedimiento === procedimiento);
    expect(creada, 'la cirugía creada por UI debe aparecer en la API').toBeTruthy();
    expect(creada.riesgo_asa).toBe('III');
    expect(creada.consulta_id).toBe(S.consulta.id);
  });

  test('cirugía: alta directa por /api/cirugias/ y consulta del historial', async ({ request }) => {
    const cir = await createTestCirugia(request, { mascotaId: S.mascota.id });
    expect(cir.id).toBeTruthy();
    expect(cir.fecha_cirugia).toBeTruthy();

    const lista = await (await request.get(`/api/cirugias/mascota/${S.mascota.id}`)).json();
    expect(lista.some((c) => c.id === cir.id)).toBe(true);
  });

  test('pruebas complementarias: CRUD completo de /api/pruebas', async ({ request }) => {
    // POST
    S.pruebaApi = await createTestPrueba(request, { mascotaId: S.mascota.id, consultaId: S.consulta.id, tipo: 'Radiologia' });
    expect(S.pruebaApi.id).toBeTruthy();
    expect(S.pruebaApi.mascota_id).toBe(S.mascota.id);
    expect(S.pruebaApi.estado_orden).toBe('Pendiente');
    expect(S.pruebaApi.fecha).toBeTruthy();

    // LIST con filtro por mascota.
    const lista = await (await request.get(`/api/pruebas/?mascota_id=${S.mascota.id}`)).json();
    expect(lista.some((p) => p.id === S.pruebaApi.id)).toBe(true);

    // GET {id}
    const getRes = await request.get(`/api/pruebas/${S.pruebaApi.id}`);
    expect(getRes.ok()).toBeTruthy();
    expect((await getRes.json()).tipo).toBe('Radiologia');

    // PUT parcial (exclude_unset): sólo resultado + observaciones.
    const nuevoResultado = testTag('resultadoUpd');
    const putRes = await request.put(`/api/pruebas/${S.pruebaApi.id}`, {
      data: { resultado: nuevoResultado, observaciones: 'PWTEST obs' },
    });
    expect(putRes.ok(), await putRes.text()).toBeTruthy();
    const actualizada = await putRes.json();
    expect(actualizada.resultado).toBe(nuevoResultado);
    expect(actualizada.observaciones).toBe('PWTEST obs');
    expect(actualizada.tipo).toBe('Radiologia'); // no tocado

    // DELETE (borrado real, 204).
    const delRes = await request.delete(`/api/pruebas/${S.pruebaApi.id}`);
    expect(delRes.status()).toBe(204);
    const gone = await request.get(`/api/pruebas/${S.pruebaApi.id}`);
    expect(gone.status()).toBe(404);
    S.pruebaApi = null;

    // POST con mascota inexistente -> 404.
    const noMascota = await request.post('/api/pruebas/', {
      data: { mascota_id: 99999999, tipo: 'Laboratorio', resultado: 'x' },
    });
    expect(noMascota.status()).toBe(404);

    // PUT / DELETE sobre id inexistente -> 404.
    expect((await request.put('/api/pruebas/99999999', { data: { resultado: 'x' } })).status()).toBe(404);
    expect((await request.delete('/api/pruebas/99999999')).status()).toBe(404);
  });
});
