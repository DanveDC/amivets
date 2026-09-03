// Unidad — Reportes y analítica (backend/app/routers/reportes.py)
//
// Endpoints (todos de solo lectura, sin auth en este stack):
//   /kpi/servicios · /kpi/rendimiento · /kpi/consultas
//   /consultas-por-veterinario · /finanzas/ingresos · /finanzas/cuentas-por-cobrar
//
// Estrategia: se siembra por API un dataset mínimo conocido
//   propietario -> mascota -> consulta (hoy, con veterinario_id) -> factura
// reutilizando los helpers de helpers.js, y luego se afirma que cada endpoint
// (a) devuelve la forma coherente y (b) mueve los números sembrados en la
// dirección correcta. También se comprueba que los parámetros de rango de
// fechas se respetan (un rango antiguo excluye lo recién sembrado).
//
// La factura de la consulta se cobra en su totalidad (pagarFacturaCompleta)
// para que /finanzas/ingresos la sume; para /finanzas/cuentas-por-cobrar se
// emite además una factura suelta SIN pagar y se mide el delta exacto.
//
// UI: se verifica que el dashboard de KPIs de sec-reportes renderiza
// (loadReportes -> initKpiRango -> cargarKpisPeriodo) y que el rango "Hoy"
// escribe la fecha de hoy en el filtro.
//
// Nada se mockea: no interviene Supabase / QR.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  testTag,
  createTestVeterinario,
  deleteTestUser,
  createTestProduct,
  deleteTestProduct,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestConsulta,
  deleteTestConsulta,
  createTestFactura,
  anularTestFactura,
  pagarFacturaCompleta,
} = require('./helpers');

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

/** Today's date as YYYY-MM-DD in UTC — the same basis reportes.py uses. */
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
const ANCIENT_START = '2000-01-01';
const ANCIENT_END = '2000-01-02';

test.describe.serial('Reportes y analítica — dataset sembrado por API', () => {
  const S = {
    token: null,
    vet: null,
    producto: null,
    propietario: null,
    mascota: null,
    consulta: null,
    facturaPagada: null,
    facturaImpaga: null,
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.vet = await createTestVeterinario(request, S.token);
    S.producto = await createTestProduct(request, { stock_actual: 50, stock_minimo: 5, precio_unitario: 700 });
    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);
    // Consulta de hoy, con veterinario asignado (lo exige el schema y lo
    // necesitan /kpi/rendimiento y /consultas-por-veterinario).
    S.consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
      peso: 10.5,
    });
    // Factura de la consulta con una línea de PRODUCTO (producto_id): sin eso
    // /kpi/servicios no la puede contar (hace join DetalleFactura.producto_id).
    const factura = await createTestFactura(request, {
      propietarioId: S.propietario.id,
      consultaId: S.consulta.id,
      detalles: [
        { descripcion: 'PWTEST consulta', cantidad: 1, precio_unitario: 25000 },
        { descripcion: 'PWTEST insumo', cantidad: 3, precio_unitario: 700, producto_id: S.producto.id },
      ],
    });
    S.facturaPagada = await pagarFacturaCompleta(request, factura);
    expect(S.facturaPagada.estado).toBe('PAGADA');
  });

  test.afterAll(async ({ request }) => {
    // Limpieza best-effort en orden inverso a las dependencias.
    if (S.facturaImpaga?.id) await anularTestFactura(request, S.facturaImpaga.id);
    if (S.facturaPagada?.id) await anularTestFactura(request, S.facturaPagada.id);
    if (S.consulta?.id) await deleteTestConsulta(request, S.consulta.id);
    if (S.mascota?.id) await deleteTestMascota(request, S.mascota.id);
    if (S.propietario?.id) await deleteTestPropietario(request, S.propietario.id);
    if (S.producto?.id) await deleteTestProduct(request, S.producto.id);
    if (S.vet?.id) await deleteTestUser(request, S.token, S.vet.id);
  });

  test('/kpi/consultas: cuenta la consulta sembrada y respeta el rango de fechas', async ({ request }) => {
    const hoy = todayUTC();
    const res = await request.get(`/api/reportes/kpi/consultas?fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ fecha_inicio: hoy, fecha_fin: hoy });
    expect(typeof body.consultas_atendidas).toBe('number');
    expect(typeof body.pacientes_unicos).toBe('number');
    expect(body.consultas_atendidas).toBeGreaterThanOrEqual(1);
    expect(body.pacientes_unicos).toBeGreaterThanOrEqual(1);

    // Rango antiguo: la consulta de hoy queda fuera.
    const viejo = await request.get(`/api/reportes/kpi/consultas?fecha_inicio=${ANCIENT_START}&fecha_fin=${ANCIENT_END}`);
    expect((await viejo.json()).consultas_atendidas).toBe(0);

    // Fecha mal formada -> 400.
    const malformada = await request.get('/api/reportes/kpi/consultas?fecha_inicio=ayer&fecha_fin=hoy');
    expect(malformada.status()).toBe(400);
  });

  test('/kpi/rendimiento: el veterinario sembrado aparece con al menos 1 consulta', async ({ request }) => {
    const hoy = todayUTC();
    const res = await request.get(`/api/reportes/kpi/rendimiento?fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    expect(res.ok()).toBeTruthy();
    const filas = await res.json();
    expect(Array.isArray(filas)).toBe(true);
    const mia = filas.find((f) => f.veterinario_id === S.vet.id);
    expect(mia, 'el veterinario sembrado debe estar en el ranking de rendimiento').toBeTruthy();
    expect(mia.veterinario).toBe(S.vet.username);
    expect(mia.consultas_realizadas).toBeGreaterThanOrEqual(1);

    // Rango antiguo: el veterinario no aparece (no tiene consultas en el 2000).
    const viejo = await request.get(`/api/reportes/kpi/rendimiento?fecha_inicio=${ANCIENT_START}&fecha_fin=${ANCIENT_END}`);
    const viejas = await viejo.json();
    expect(viejas.some((f) => f.veterinario_id === S.vet.id)).toBe(false);
  });

  test('/kpi/servicios: el producto facturado aparece con las unidades vendidas', async ({ request }) => {
    const hoy = todayUTC();
    // limit alto para que el producto no quede truncado si hoy se vendieron muchos.
    const res = await request.get(`/api/reportes/kpi/servicios?limit=200&fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    expect(res.ok()).toBeTruthy();
    const filas = await res.json();
    expect(Array.isArray(filas)).toBe(true);
    const mia = filas.find((f) => f.servicio === S.producto.nombre);
    expect(mia, 'el producto facturado debe estar entre los más solicitados').toBeTruthy();
    expect(Number(mia.total_solicitudes)).toBeGreaterThanOrEqual(3); // cantidad de la línea

    const viejo = await request.get(`/api/reportes/kpi/servicios?limit=200&fecha_inicio=${ANCIENT_START}&fecha_fin=${ANCIENT_END}`);
    const viejas = await viejo.json();
    expect(viejas.some((f) => f.servicio === S.producto.nombre)).toBe(false);
  });

  test('/consultas-por-veterinario: detalle de la consulta sembrada + validaciones', async ({ request }) => {
    const hoy = todayUTC();
    const res = await request.get(`/api/reportes/consultas-por-veterinario?veterinario_id=${S.vet.id}&fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ veterinario_id: S.vet.id, veterinario: S.vet.username, fecha_inicio: hoy, fecha_fin: hoy });
    expect(body.total_consultas).toBeGreaterThanOrEqual(1);
    const fila = body.consultas.find((c) => c.id === S.consulta.id);
    expect(fila, 'la consulta sembrada debe estar en el detalle').toBeTruthy();
    expect(fila.mascota_id).toBe(S.mascota.id);
    expect(fila.mascota).toBeTruthy();
    expect(fila.propietario).toContain('Apellido'); // helper crea apellido "Apellido"

    // veterinario_id obligatorio.
    const sinVet = await request.get(`/api/reportes/consultas-por-veterinario?fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    expect(sinVet.status()).toBe(422);

    // Veterinario inexistente -> 404.
    const noVet = await request.get(`/api/reportes/consultas-por-veterinario?veterinario_id=99999999&fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    expect(noVet.status()).toBe(404);

    // Rango antiguo: 0 consultas.
    const viejo = await request.get(`/api/reportes/consultas-por-veterinario?veterinario_id=${S.vet.id}&fecha_inicio=${ANCIENT_START}&fecha_fin=${ANCIENT_END}`);
    expect((await viejo.json()).total_consultas).toBe(0);
  });

  test('/finanzas/ingresos: incluye la factura emitida y calcula el ticket promedio', async ({ request }) => {
    const hoy = todayUTC();
    const res = await request.get(`/api/reportes/finanzas/ingresos?fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ fecha_inicio: hoy, fecha_fin: hoy });
    expect(body.cantidad_facturas).toBeGreaterThanOrEqual(1);
    expect(body.total_ingresos).toBeGreaterThanOrEqual(S.facturaPagada.total);
    // ticket_promedio == total_ingresos / cantidad_facturas.
    expect(body.ticket_promedio).toBeCloseTo(body.total_ingresos / body.cantidad_facturas, 2);

    // Rango antiguo: sin ingresos.
    const viejo = await request.get(`/api/reportes/finanzas/ingresos?fecha_inicio=${ANCIENT_START}&fecha_fin=${ANCIENT_END}`);
    const viejas = await viejo.json();
    expect(viejas.total_ingresos).toBeNull();
    expect(viejas.cantidad_facturas).toBe(0);
    expect(viejas.ticket_promedio).toBeNull();
  });

  test('/finanzas/cuentas-por-cobrar: una factura impaga nueva mueve el total pendiente por su monto exacto', async ({ request }) => {
    const hoy = todayUTC();

    const antesRes = await request.get(`/api/reportes/finanzas/cuentas-por-cobrar?fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    const antes = await antesRes.json();
    const totalAntes = antes.total_pendiente || 0;
    const cantAntes = antes.cantidad_facturas;

    // Factura suelta (sin consulta), sin pagar -> estado PENDIENTE, saldo == total.
    S.facturaImpaga = await createTestFactura(request, {
      propietarioId: S.propietario.id,
      consultaId: null,
      detalles: [{ descripcion: testTag('deuda'), cantidad: 1, precio_unitario: 18000 }],
    });
    expect(S.facturaImpaga.estado).toBe('PENDIENTE');
    expect(S.facturaImpaga.saldo_pendiente).toBeCloseTo(S.facturaImpaga.total, 2);

    const despuesRes = await request.get(`/api/reportes/finanzas/cuentas-por-cobrar?fecha_inicio=${hoy}&fecha_fin=${hoy}`);
    const despues = await despuesRes.json();
    expect(despues.cantidad_facturas).toBe(cantAntes + 1);
    expect(despues.total_pendiente).toBeCloseTo(totalAntes + S.facturaImpaga.total, 2);

    // La factura impaga figura en el detalle con su saldo.
    const enDetalle = despues.detalle.find((d) => d.factura === S.facturaImpaga.numero_factura);
    expect(enDetalle, 'la factura impaga debe listarse en cuentas por cobrar').toBeTruthy();
    expect(Number(enDetalle.saldo_deudor)).toBeCloseTo(S.facturaImpaga.total, 2);
  });

  test('UI: el dashboard de KPIs de sec-reportes renderiza y el rango "Hoy" fija la fecha', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-reportes"]');
    await expect(page.locator('#sec-reportes')).toBeVisible();

    // initKpiRango aplica "este_mes" por defecto y cargarKpisPeriodo puebla las tarjetas.
    await expect(page.locator('#kpiRangoActual')).toContainText('Rango seleccionado');
    // Hay una consulta sembrada este mes: el contador es un número, no "Sin datos".
    await expect(page.locator('#kpiConsultasAtendidas')).not.toHaveText('-');
    await expect(page.locator('#kpiConsultasAtendidas')).not.toHaveText('Sin datos');
    await expect(page.locator('#kpiIngresosPeriodo')).toContainText('$');

    // Botón "Hoy": escribe la fecha de hoy (UTC) en el filtro de inicio.
    await page.click('.kpi-rango-btn[data-kpi-rango="hoy"]');
    await expect(page.locator('#kpiFechaInicio')).toHaveValue(todayUTC());
    await expect(page.locator('#kpiFechaFin')).toHaveValue(todayUTC());
    await expect(page.locator('#kpiRangoActual')).toContainText(
      `${todayUTC().slice(8, 10)}/${todayUTC().slice(5, 7)}/${todayUTC().slice(0, 4)}`
    );
  });
});
