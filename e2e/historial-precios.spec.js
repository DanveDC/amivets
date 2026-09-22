// Tarea 08 — Historial de precios de materiales y servicios
// (backend/app/services/precio_service.py + PUT /api/inventario|catalogo/{id}
//  + GET /api/{inventario|catalogo}/{id}/historial-precios)
//
// Estilo "API pura", igual que inventario.spec.js: se pega directo a la API con
// el fixture `request` de Playwright, sin browser. La regla de negocio que se
// prueba (un cambio de precio => exactamente una fila de historial, encadenada
// y firmada) vive entera en el backend; forzarla por UI probaría el panel, no
// la regla.
//
// Base fáctica del contrato bajo prueba (verificada contra el código):
//   - PUT /api/inventario/{id} y PUT /api/catalogo/{id} exigen Bearer token
//     (Depends(get_current_user)). Cambiar el precio (precio_unitario /
//     precio_ref) exige además current_user.role == "admin"; si no => 403 y
//     TODO el PUT se rechaza. Guardar el MISMO precio es no-op seguro para
//     cualquier usuario autenticado.
//   - GET .../historial-precios?desde=&hasta= => array, más nuevo primero.
//     Campos de dinero (precio_nuevo, precio_anterior) llegan como string JSON
//     (Decimal serializado) => se parsean con Number.
//     desde/hasta son fechas YYYY-MM-DD, inclusivas del día límite (el backend
//     filtra fecha_cambio < hasta + 1 día).
//   - Los endpoints CREATE (POST /api/inventario/, POST /api/catalogo/) NO
//     escriben fila ancla: sólo el backfill de arranque y los cambios de precio
//     la escriben. Un producto recién creado por createTestProduct arranca con
//     CERO filas de historial. Por eso cada test lee una línea base (B) al
//     empezar y afirma sobre B+1 / B+2, nunca sobre un valor absoluto.

const { test, expect } = require('@playwright/test');
const {
  getAdminToken,
  authHeaders,
  testTag,
  createTestProduct,
  deleteTestProduct,
  createTestVeterinario,
  deleteTestUser,
  createTestPropietario,
  deleteTestPropietario,
  createTestFactura,
  anularTestFactura,
} = require('./helpers');

// --- helpers locales -------------------------------------------------------

/** GET del historial de precios de un material. Devuelve el array parseado. */
async function historialInventario(request, token, id, params = {}) {
  const res = await request.get(`/api/inventario/${id}/historial-precios`, {
    headers: authHeaders(token),
    params,
  });
  if (!res.ok()) {
    throw new Error(`[historial-precios] GET historial ${id} -> ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** PUT de un cambio de precio de material. Devuelve la Response cruda. */
function putPrecioInventario(request, token, id, precio_unitario, extra = {}) {
  return request.put(`/api/inventario/${id}`, {
    headers: authHeaders(token),
    data: { precio_unitario, ...extra },
  });
}

/** Parsea un campo de dinero que el backend serializa como string Decimal. */
const money = (v) => Number(v);

/** YYYY-MM-DD (UTC) desde un Date. El backend compara contra medianoche UTC. */
const ymd = (d) => d.toISOString().slice(0, 10);

/**
 * Precio vigente en el instante `t` a partir del historial (más nuevo primero,
 * tal cual lo devuelve la API): la primera fila con fecha_cambio <= t es la que
 * estaba en efecto en t. Sin fila aplicable => null (el caller decide el
 * fallback: el precio_anterior de la fila más vieja).
 */
function precioVigente(rowsNewestFirst, t) {
  const fila = rowsNewestFirst.find((r) => new Date(r.fecha_cambio).getTime() <= t.getTime());
  return fila ? money(fila.precio_nuevo) : null;
}

// =========================================================================
// Casos 1-4: encadenan sobre un mismo material (serial), igual que
// gestion-inventario.spec.js. Con workers:1 esto ya es determinista; el
// `.serial` sólo hace explícito que un fallo temprano corta la cadena.
// =========================================================================
test.describe.serial('Historial de precios — cambios sobre un material', () => {
  const S = { token: null, producto: null, B: 0 };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.producto = await createTestProduct(request, {
      nombre: testTag('histMat'),
      precio_unitario: 100,
      stock_actual: 50,
    });
    // Línea base: un producto recién creado NO tiene fila ancla (los CREATE no
    // la escriben). Se lee igual en vez de asumir 0.
    S.B = (await historialInventario(request, S.token, S.producto.id)).length;
  });

  test.afterAll(async ({ request }) => {
    if (S.producto?.id) await deleteTestProduct(request, S.producto.id);
  });

  test('un cambio de precio crea exactamente una fila, firmada y reciente', async ({ request }) => {
    const motivo = testTag('motivo');
    const res = await putPrecioInventario(request, S.token, S.producto.id, 150, { motivo });
    expect(res.status(), await res.text()).toBe(200);

    const rows = await historialInventario(request, S.token, S.producto.id);
    expect(rows.length).toBe(S.B + 1);

    const nueva = rows[0]; // más nuevo primero
    expect(money(nueva.precio_nuevo)).toBe(150);
    expect(money(nueva.precio_anterior)).toBe(100);
    expect(nueva.usuario_id, 'la fila queda firmada por el admin que la hizo').toBeTruthy();
    expect(nueva.motivo).toBe(motivo);

    const edad = Date.now() - new Date(nueva.fecha_cambio).getTime();
    expect(edad).toBeGreaterThan(-60_000); // sin viajar al futuro (skew tolerable)
    expect(edad).toBeLessThan(15 * 60_000); // recién escrita
  });

  test('dos cambios el mismo día => dos filas distintas y encadenadas, ninguna perdida', async ({ request }) => {
    // El material está en 150 (test anterior). Un segundo cambio: 150 -> 175.
    const res = await putPrecioInventario(request, S.token, S.producto.id, 175);
    expect(res.status(), await res.text()).toBe(200);

    const rows = await historialInventario(request, S.token, S.producto.id);
    expect(rows.length).toBe(S.B + 2);

    const [ultima, previa] = rows; // más nuevo primero
    // Filas distintas: id propio y precio_nuevo propio.
    expect(ultima.id).not.toBe(previa.id);
    expect(money(previa.precio_nuevo)).toBe(150);
    expect(money(ultima.precio_nuevo)).toBe(175);
    // Encadenadas: el precio_anterior de cada fila == el precio_nuevo de la previa.
    expect(money(ultima.precio_anterior)).toBe(150);
    expect(money(previa.precio_anterior)).toBe(100);
  });

  test('guardar el mismo precio actual no crea fila (no es un cambio) y responde 200', async ({ request }) => {
    // El material está en 175. Re-PUT del mismo precio: no-op seguro.
    const res = await putPrecioInventario(request, S.token, S.producto.id, 175);
    expect(res.status(), await res.text()).toBe(200); // 200, no error

    const rows = await historialInventario(request, S.token, S.producto.id);
    expect(rows.length).toBe(S.B + 2); // sin cambios respecto al test anterior
  });

  test('precio vigente en una fecha pasada: la fila con mayor fecha_cambio <= T', async ({ request }) => {
    const rows = await historialInventario(request, S.token, S.producto.id);
    expect(rows.length).toBe(S.B + 2);

    // Regla derivable en el cliente: precio vigente hoy == la fila más nueva.
    expect(precioVigente(rows, new Date())).toBe(175);

    // T entre el primer y el segundo cambio: justo antes de la fila más nueva
    // => la vigente es la anterior (150).
    const ascendente = [...rows].reverse(); // más vieja primero
    const masVieja = ascendente[0];
    const masNueva = ascendente[ascendente.length - 1];
    const entreCambios = new Date(new Date(masNueva.fecha_cambio).getTime() - 1);
    expect(precioVigente(rows, entreCambios)).toBe(150);

    // T anterior a la primera fila: ninguna fila aplica => fallback al
    // precio_anterior de la más vieja (o null si ese fuese null).
    const antesDeTodo = new Date(new Date(masVieja.fecha_cambio).getTime() - 1);
    expect(precioVigente(rows, antesDeTodo)).toBeNull();
    const fallback = masVieja.precio_anterior === null ? null : money(masVieja.precio_anterior);
    expect(fallback).toBe(100);

    // Filtro ?hasta=<día pasado>: excluye las filas de hoy.
    // Nota: todas las filas de este test se escribieron hoy; cerca de medianoche
    // UTC el borde de "hoy" puede correrse un día, igual que en createTestCita.
    const hoy = ymd(new Date());
    const ayer = ymd(new Date(Date.now() - 864e5));
    const mañana = ymd(new Date(Date.now() + 864e5));

    const hastaAyer = await historialInventario(request, S.token, S.producto.id, { hasta: ayer });
    expect(hastaAyer.length, 'hasta=ayer excluye lo escrito hoy').toBe(0);

    // Inclusivo del día límite: hasta=hoy SÍ trae las filas de hoy.
    const hastaHoy = await historialInventario(request, S.token, S.producto.id, { hasta: hoy });
    expect(hastaHoy.length, 'hasta=hoy es inclusivo del día').toBe(S.B + 2);

    // Simétrico por el otro extremo: desde=mañana no trae nada.
    const desdeMañana = await historialInventario(request, S.token, S.producto.id, { desde: mañana });
    expect(desdeMañana.length).toBe(0);
  });
});

// =========================================================================
// Caso 5: un precio ya congelado en un documento NO se reescribe cuando el
// precio de lista cambia después.
//
// Documento elegido: DetalleFactura.precio_unitario (models.py:393) — el más
// liviano que congela un precio *tomándolo del producto*. facturacion_service
// (facturacion_service.py:104-146), cuando el detalle trae `producto_id`,
// IGNORA el precio_unitario del payload y lo sobrescribe con
// producto.precio_unitario vigente al emitir. Eso hace el test significativo:
// se prueba la captura real, no un passthrough del literal enviado.
// (Un ServicioConsulta necesitaría propietario+mascota+consulta+veterinario;
//  esto sólo necesita propietario + factura.)
// =========================================================================
test.describe('Historial de precios — precio congelado en un documento', () => {
  const S = { token: null, producto: null, propietario: null, factura: null };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
  });

  test.afterAll(async ({ request }) => {
    if (S.factura?.id) await anularTestFactura(request, S.factura.id);
    if (S.propietario?.id) await deleteTestPropietario(request, S.propietario.id);
    if (S.producto?.id) await deleteTestProduct(request, S.producto.id);
  });

  test('una factura emitida antes de un cambio de precio sigue mostrando el precio viejo', async ({ request }) => {
    // P1 = 100
    S.producto = await createTestProduct(request, {
      nombre: testTag('histFrozen'),
      precio_unitario: 100,
      stock_actual: 50,
    });
    S.propietario = await createTestPropietario(request);

    // El detalle trae producto_id => el service congela producto.precio_unitario
    // (100) e ignora el precio_unitario:0 del payload.
    S.factura = await createTestFactura(request, {
      propietarioId: S.propietario.id,
      detalles: [
        { descripcion: testTag('lineaFrozen'), cantidad: 1, precio_unitario: 0, producto_id: S.producto.id },
      ],
    });
    expect(S.factura.detalles.length).toBe(1);
    expect(S.factura.detalles[0].precio_unitario, 'la línea capturó el precio del producto (P1)').toBeCloseTo(100, 2);

    // Cambio de precio de lista: P1 -> P2 = 250 (admin).
    const putRes = await putPrecioInventario(request, S.token, S.producto.id, 250);
    expect(putRes.status(), await putRes.text()).toBe(200);
    // Sanity: el cambio ocurrió de verdad (columna viva + fila de historial).
    const prodAhora = await (await request.get(`/api/inventario/${S.producto.id}`)).json();
    expect(prodAhora.precio_unitario).toBeCloseTo(250, 2);
    const hist = await historialInventario(request, S.token, S.producto.id);
    expect(money(hist[0].precio_nuevo)).toBe(250);
    expect(money(hist[0].precio_anterior)).toBe(100);

    // La factura ya emitida NO se recalcula: su línea sigue en P1.
    const facturaAhora = await (await request.get(`/api/facturas/${S.factura.id}`, { headers: authHeaders(S.token) })).json();
    expect(facturaAhora.detalles[0].precio_unitario, 'el detalle NO se reescribió con P2').toBeCloseTo(100, 2);
    expect(facturaAhora.detalles[0].precio_unitario).not.toBeCloseTo(250, 2);
  });
});

// =========================================================================
// Caso 6: un usuario no-admin no puede cambiar precios por API directa.
//
// Usuario no-admin: NO se depende de un seed. seed_data.py crea usuarios
// `dr_<apellido>` / `doctor123` con role "veterinario", pero ese script "nunca
// se llama solo" (sólo desde populate_demo) y no está garantizado en el stack
// e2e. El test crea su propio veterinario vía createTestVeterinario (POST
// /api/usuarios/ con token admin, role "veterinario") y saca su token por
// /token con la contraseña por defecto del helper.
// =========================================================================
test.describe.serial('Historial de precios — permisos de cambio de precio', () => {
  const S = { adminToken: null, vet: null, vetToken: null, producto: null, B: 0 };

  test.beforeAll(async ({ request }) => {
    S.adminToken = await getAdminToken(request);
    S.vet = await createTestVeterinario(request, S.adminToken); // password: 'Password123!'
    const tokenRes = await request.post('/token', {
      form: { username: S.vet.username, password: 'Password123!' },
    });
    expect(tokenRes.ok(), 'el veterinario recién creado autentica en /token').toBeTruthy();
    S.vetToken = (await tokenRes.json()).access_token;

    S.producto = await createTestProduct(request, {
      nombre: testTag('histPerm'),
      precio_unitario: 100,
      stock_actual: 50,
    });
    S.B = (await historialInventario(request, S.adminToken, S.producto.id)).length;
  });

  test.afterAll(async ({ request }) => {
    if (S.producto?.id) await deleteTestProduct(request, S.producto.id);
    if (S.vet?.id) await deleteTestUser(request, S.adminToken, S.vet.id);
  });

  test('un veterinario que intenta cambiar el precio recibe 403 y no escribe historial', async ({ request }) => {
    const res = await putPrecioInventario(request, S.vetToken, S.producto.id, 999);
    expect(res.status()).toBe(403);

    // No se escribió ninguna fila.
    const rows = await historialInventario(request, S.adminToken, S.producto.id);
    expect(rows.length).toBe(S.B);

    // Y la columna viva quedó intacta.
    const prod = await (await request.get(`/api/inventario/${S.producto.id}`)).json();
    expect(prod.precio_unitario).toBeCloseTo(100, 2);
  });

  test('un veterinario SÍ puede editar un campo no-precio (200) — no se regresiona la edición no-precio', async ({ request }) => {
    const descripcion = testTag('descVet');
    const res = await request.put(`/api/inventario/${S.producto.id}`, {
      headers: authHeaders(S.vetToken),
      data: { descripcion },
    });
    expect(res.status(), await res.text()).toBe(200);

    const prod = await (await request.get(`/api/inventario/${S.producto.id}`)).json();
    expect(prod.descripcion).toBe(descripcion);

    // El historial sigue sin filas: editar la descripción no toca el precio.
    const rows = await historialInventario(request, S.adminToken, S.producto.id);
    expect(rows.length).toBe(S.B);
  });

  test('un veterinario puede re-enviar el MISMO precio junto a otro campo (no-op seguro, 200)', async ({ request }) => {
    // El precio actual es 100 (nunca cambió). Reenviarlo cuantizado igual no es
    // un cambio => no exige admin y no escribe historial.
    const res = await request.put(`/api/inventario/${S.producto.id}`, {
      headers: authHeaders(S.vetToken),
      data: { precio_unitario: 100, proveedor: testTag('provVet') },
    });
    expect(res.status(), await res.text()).toBe(200);

    const rows = await historialInventario(request, S.adminToken, S.producto.id);
    expect(rows.length).toBe(S.B);
  });
});
