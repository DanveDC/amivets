// Unidad E — Liquidaciones a veterinarios (backend/app/routers/liquidaciones.py)
//
// Endpoints (todos admin-only):
//   GET /tarifas · PUT /tarifa/{veterinario_id} · GET /preview
//   POST /calcular · GET /
//
// Regla de negocio: una consulta es elegible para liquidar sólo si
//   (a) su factura está PAGADA y
//   (b) no fue incluida antes en ninguna LiquidacionDetalle.
// El monto = tarifa_consulta del veterinario × cantidad de consultas elegibles,
// y la tarifa se congela (snapshot) en cada fila de detalle al calcular.
//
// Se siembran DOS cadenas completas por API (reutilizando helpers.js):
//   veterinario -> tarifa -> propietario -> mascota -> consulta (hoy) -> factura PAGADA
// La cadena A ejercita preview/calcular/historial por API; la cadena B se
// recorre por la UI de Liquidaciones (sec-reportes -> initLiquidaciones ->
// previewLiquidacion -> confirmarLiquidacion), que sólo ve un admin.
//
// Nada se mockea: no interviene Supabase / QR.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  createTestVeterinario,
  createTestUser,
  deleteTestUser,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestConsulta,
  deleteTestConsulta,
  createTestFactura,
  anularTestFactura,
  pagarFacturaCompleta,
  setTarifaConsulta,
} = require('./helpers');

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

const TARIFA_A = 5000;
const TARIFA_B = 7000;

/** Seeds veterinario + tarifa + propietario + mascota + consulta(hoy) + factura PAGADA. */
async function seedCadenaLiquidable(request, token, tarifa) {
  const vet = await createTestVeterinario(request, token);
  await setTarifaConsulta(request, token, vet.id, tarifa);
  const propietario = await createTestPropietario(request);
  const mascota = await createTestMascota(request, propietario.id);
  const consulta = await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id });
  const factura = await createTestFactura(request, {
    propietarioId: propietario.id,
    consultaId: consulta.id,
    detalles: [{ descripcion: 'PWTEST consulta liquidable', cantidad: 1, precio_unitario: 25000 }],
  });
  const facturaPagada = await pagarFacturaCompleta(request, factura);
  return { vet, propietario, mascota, consulta, factura: facturaPagada };
}

async function cleanupCadena(request, token, c) {
  if (!c) return;
  if (c.factura?.id) await anularTestFactura(request, c.factura.id);
  if (c.consulta?.id) await deleteTestConsulta(request, c.consulta.id);
  if (c.mascota?.id) await deleteTestMascota(request, c.mascota.id);
  if (c.propietario?.id) await deleteTestPropietario(request, c.propietario.id);
  if (c.vet?.id) await deleteTestUser(request, token, c.vet.id);
}

test.describe.serial('Liquidaciones a veterinarios — /api/liquidaciones', () => {
  const S = { token: null, A: null, B: null, vetSinTarifa: null, userNoVet: null };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.A = await seedCadenaLiquidable(request, S.token, TARIFA_A);
    S.B = await seedCadenaLiquidable(request, S.token, TARIFA_B);
    S.vetSinTarifa = await createTestVeterinario(request, S.token); // sin tarifa configurada
    S.userNoVet = await createTestUser(request, S.token); // role "user"
  });

  test.afterAll(async ({ request }) => {
    if (S.userNoVet?.id) await deleteTestUser(request, S.token, S.userNoVet.id);
    if (S.vetSinTarifa?.id) await deleteTestUser(request, S.token, S.vetSinTarifa.id);
    await cleanupCadena(request, S.token, S.B);
    await cleanupCadena(request, S.token, S.A);
    // Nota: no hay DELETE para Liquidacion; las filas calculadas quedan en la
    // base (tagueadas por el veterinario PWTEST). Es inocuo.
  });

  test('GET /tarifas lista veterinarios con su tarifa; PUT /tarifa valida rol y existencia', async ({ request }) => {
    const res = await request.get('/api/liquidaciones/tarifas', { headers: authHeaders(S.token) });
    expect(res.ok()).toBeTruthy();
    const tarifas = await res.json();
    expect(Array.isArray(tarifas)).toBe(true);
    const filaA = tarifas.find((t) => t.id === S.A.vet.id);
    const filaB = tarifas.find((t) => t.id === S.B.vet.id);
    expect(Number(filaA.tarifa_consulta)).toBe(TARIFA_A);
    expect(Number(filaB.tarifa_consulta)).toBe(TARIFA_B);

    // PUT sobre un usuario sin rol veterinario -> 400.
    const noVet = await request.put(`/api/liquidaciones/tarifa/${S.userNoVet.id}`, {
      headers: authHeaders(S.token),
      data: { tarifa_consulta: 1000 },
    });
    expect(noVet.status()).toBe(400);

    // PUT sobre un id inexistente -> 404.
    const missing = await request.put('/api/liquidaciones/tarifa/99999999', {
      headers: authHeaders(S.token),
      data: { tarifa_consulta: 1000 },
    });
    expect(missing.status()).toBe(404);

    // Sin token de admin -> 401.
    const anon = await request.get('/api/liquidaciones/tarifas');
    expect(anon.status()).toBe(401);
  });

  test('GET /preview: desglose de la cadena A + validaciones de rango y tarifa', async ({ request }) => {
    const hoy = todayUTC();
    const res = await request.get(
      `/api/liquidaciones/preview?veterinario_id=${S.A.vet.id}&fecha_inicio=${hoy}&fecha_fin=${hoy}`,
      { headers: authHeaders(S.token) }
    );
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.veterinario_id).toBe(S.A.vet.id);
    expect(Number(body.tarifa_consulta)).toBe(TARIFA_A);
    expect(body.total_consultas).toBeGreaterThanOrEqual(1);
    // total == tarifa * cantidad de consultas elegibles.
    expect(Number(body.total)).toBeCloseTo(TARIFA_A * body.total_consultas, 2);
    const item = body.consultas.find((c) => c.consulta_id === S.A.consulta.id);
    expect(item, 'la consulta sembrada de A debe ser elegible').toBeTruthy();
    expect(item.factura_id).toBe(S.A.factura.id);
    expect(Number(item.tarifa_aplicada)).toBe(TARIFA_A);

    // Sin fechas -> 400.
    const sinFechas = await request.get(`/api/liquidaciones/preview?veterinario_id=${S.A.vet.id}`, {
      headers: authHeaders(S.token),
    });
    expect(sinFechas.status()).toBe(400);

    // Veterinario sin tarifa configurada -> 400.
    const sinTarifa = await request.get(
      `/api/liquidaciones/preview?veterinario_id=${S.vetSinTarifa.id}&fecha_inicio=${hoy}&fecha_fin=${hoy}`,
      { headers: authHeaders(S.token) }
    );
    expect(sinTarifa.status()).toBe(400);

    // Veterinario inexistente -> 404.
    const noVet = await request.get(
      `/api/liquidaciones/preview?veterinario_id=99999999&fecha_inicio=${hoy}&fecha_fin=${hoy}`,
      { headers: authHeaders(S.token) }
    );
    expect(noVet.status()).toBe(404);
  });

  test('POST /calcular: persiste la liquidación de A, aparece en el historial y la matemática cuadra', async ({ request }) => {
    const hoy = todayUTC();
    const res = await request.post('/api/liquidaciones/calcular', {
      headers: authHeaders(S.token),
      data: { veterinario_id: S.A.vet.id, fecha_inicio: hoy, fecha_fin: hoy },
    });
    expect(res.status(), await res.text()).toBe(201);
    const liq = await res.json();
    expect(liq.veterinario_id).toBe(S.A.vet.id);
    expect(liq.detalles.length).toBeGreaterThanOrEqual(1);
    // total == tarifa congelada * cantidad de detalles.
    expect(Number(liq.total)).toBeCloseTo(TARIFA_A * liq.detalles.length, 2);
    const detalle = liq.detalles.find((d) => d.consulta_id === S.A.consulta.id);
    expect(detalle, 'la consulta de A debe quedar en el detalle liquidado').toBeTruthy();
    expect(detalle.factura_id).toBe(S.A.factura.id);
    expect(Number(detalle.tarifa_aplicada)).toBe(TARIFA_A);

    // Historial: GET / filtrado por veterinario devuelve esta liquidación.
    const histRes = await request.get(`/api/liquidaciones/?veterinario_id=${S.A.vet.id}`, {
      headers: authHeaders(S.token),
    });
    const historial = await histRes.json();
    expect(historial.some((l) => l.id === liq.id)).toBe(true);
  });

  test('GET /preview de A tras calcular: 0 consultas elegibles (ya liquidadas)', async ({ request }) => {
    const hoy = todayUTC();
    const res = await request.get(
      `/api/liquidaciones/preview?veterinario_id=${S.A.vet.id}&fecha_inicio=${hoy}&fecha_fin=${hoy}`,
      { headers: authHeaders(S.token) }
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // La consulta de A ya está en una LiquidacionDetalle -> nunca vuelve a ser elegible.
    expect(body.total_consultas).toBe(0);
    expect(Number(body.total)).toBe(0);
    expect(body.consultas).toEqual([]);
  });

  test('UI: recorrer la Liquidación de la cadena B (tarifa, preview y confirmar) como admin', async ({ page, request }) => {
    const hoy = todayUTC();

    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-reportes"]');
    // liqSeccion es admin-only: checkAdminAccess la muestra e initLiquidaciones la puebla.
    await expect(page.locator('#liqSeccion')).toBeVisible();

    // Tarifa configurada de B reflejada en su input.
    await expect(page.locator(`#liqTarifaInput${S.B.vet.id}`)).toHaveValue(/^7000(\.0+)?$/);

    // Preview por UI.
    await page.selectOption('#liqVetSelect', String(S.B.vet.id));
    await page.fill('#liqFechaInicio', hoy);
    await page.fill('#liqFechaFin', hoy);
    await page.click('#btnLiqPreview');

    const previewWrap = page.locator('#liqPreviewWrap');
    await expect(previewWrap).toContainText('consulta(s) elegibles');
    await expect(previewWrap).toContainText(`#${S.B.consulta.id}`);
    await expect(previewWrap).toContainText('Total:');

    // Confirmar cálculo (confirmarLiquidacion pide confirm()).
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#btnLiqConfirmar');

    // El historial se refresca y muestra la nueva liquidación.
    await expect(page.locator('#liqHistLista')).toContainText('Liquidación #');

    // Contraste API: existe una liquidación para el veterinario B con la
    // consulta sembrada y el total = tarifa × 1.
    const histRes = await request.get(`/api/liquidaciones/?veterinario_id=${S.B.vet.id}`, {
      headers: authHeaders(S.token),
    });
    const historial = await histRes.json();
    expect(historial.length).toBe(1);
    expect(Number(historial[0].total)).toBeCloseTo(TARIFA_B, 2);
    expect(historial[0].detalles.some((d) => d.consulta_id === S.B.consulta.id)).toBe(true);
  });
});
