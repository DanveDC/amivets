// @ts-check
// plantillas-paquete-catalogo — plantillas de paquete en el catálogo: un
// servicio marcado `es_paquete` agrupa componentes (otros servicios del
// catálogo, un nivel solo), expone la disponibilidad de insumos agregada (su
// receta propia + la de cada componente activo, sin multiplicar por
// cantidad — mismo criterio que consumo_service._necesidades) y se anexa a
// una orden en un solo paso como base + items (POST /api/ordenes/{id}/paquetes).
//
// Contrato bajo prueba (ver openspec/changes/plantillas-paquete-catalogo):
//   - PUT /api/catalogo/{id} admite `es_paquete` (admin-only, 422/409 cruzados).
//   - GET/POST /api/catalogo/{id}/componentes, PUT/DELETE /api/catalogo/componentes/{id}.
//   - GET /api/catalogo/{id}/disponibilidad (agregación, no toca stock).
//   - POST /api/ordenes/{id}/paquetes (base + items, advertencias, snapshot).
//   - POST /api/ordenes/{id}/servicios rechaza un catalogo_servicio_id de paquete.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  loginAs,
  authHeaders,
  createTestUser,
  createTestVeterinario,
  createTestRecepcionista,
  createTestPropietario,
  createTestMascota,
  createTestOrden,
  cerrarTestOrden,
  anexarServicioOrden,
  anexarPaqueteOrden,
  createTestProduct,
  deleteTestProduct,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  marcarPaquete,
  agregarComponentePaquete,
  listarComponentesPaquete,
  disponibilidadCatalogo,
  agregarRecetaCatalogo,
  createTestConsulta,
  deleteTestConsulta,
  anexarServicioConsulta,
  createTestServicioDirecto,
  deleteTestServicio,
  gotoSection,
  TEST_USER_PASSWORD,
} = require('./helpers');

async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe.serial('catálogo: plantillas de paquete (API)', () => {
  const S = { adminToken: null, vetToken: null };

  test.beforeAll(async ({ request }) => {
    S.adminToken = await getAdminToken(request);
    const vet = await createTestVeterinario(request, S.adminToken);
    S.vetToken = await loginAs(request, vet.username, TEST_USER_PASSWORD);
  });

  test('marcar un servicio como paquete: admin 200, veterinario 403', async ({ request }) => {
    const svc = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    const resVet = await marcarPaquete(request, svc.id, true, S.vetToken);
    expect(resVet.status()).toBe(403);

    const resAdmin = await marcarPaquete(request, svc.id, true, S.adminToken);
    expect(resAdmin.ok()).toBeTruthy();
    const body = await resAdmin.json();
    expect(body.es_paquete).toBe(true);
  });

  test('un servicio de categoría CONSULTA no puede ser paquete (422)', async ({ request }) => {
    const svc = await createTestCatalogoServicio(request, { categoria: 'CONSULTA' });
    const res = await marcarPaquete(request, svc.id, true, S.adminToken);
    expect(res.status()).toBe(422);
  });

  test('desmarcar un paquete con componentes da 409; sin componentes, 200', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO', precio_ref: 50000 });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const componente = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO', precio_ref: 1000 });
    await agregarComponentePaquete(request, paquete.id, { componenteId: componente.id, cantidad: 1 }, S.adminToken);

    const conComponentes = await marcarPaquete(request, paquete.id, false, S.adminToken);
    expect(conComponentes.status()).toBe(409);

    const fila = (await listarComponentesPaquete(request, paquete.id, S.adminToken)).componentes[0];
    await request.delete(`/api/catalogo/componentes/${fila.id}`, { headers: authHeaders(S.adminToken) });
    const sinComponentes = await marcarPaquete(request, paquete.id, false, S.adminToken);
    expect(sinComponentes.ok()).toBeTruthy();
  });

  test('armar una cirugía con sus servicios: orden, subtotales y total_paquete', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, {
      nombre: 'Cirugía de esterilización PWTEST', categoria: 'QUIROFANO', precio_ref: 50000,
    });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const anestesia = await createTestCatalogoServicio(request, {
      nombre: 'Anestesia general PWTEST', categoria: 'FARMACIA', precio_ref: 15000,
    });
    const monitoreo = await createTestCatalogoServicio(request, {
      nombre: 'Monitoreo PWTEST', categoria: 'HOSPITALIZACION', precio_ref: 5000,
    });

    await agregarComponentePaquete(request, paquete.id, { componenteId: anestesia.id, cantidad: 1 }, S.adminToken);
    await agregarComponentePaquete(request, paquete.id, { componenteId: monitoreo.id, cantidad: 2 }, S.adminToken);

    const listado = await listarComponentesPaquete(request, paquete.id, S.adminToken);
    expect(listado.componentes.map((c) => c.nombre)).toEqual(['Anestesia general PWTEST', 'Monitoreo PWTEST']);
    expect(listado.componentes[0].subtotal).toBe(15000);
    expect(listado.componentes[1].subtotal).toBe(10000);
    expect(listado.total_paquete).toBe(75000);
  });

  test('un paquete no puede tener otro paquete como componente (422)', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const otroPaquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, otroPaquete.id, true, S.adminToken);

    const res = await request.post(`/api/catalogo/${paquete.id}/componentes`, {
      headers: authHeaders(S.adminToken),
      data: { componente_id: otroPaquete.id, cantidad: 1 },
    });
    expect(res.status()).toBe(422);
  });

  test('el paquete no se contiene a sí mismo (422)', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const res = await request.post(`/api/catalogo/${paquete.id}/componentes`, {
      headers: authHeaders(S.adminToken),
      data: { componente_id: paquete.id, cantidad: 1 },
    });
    expect(res.status()).toBe(422);
  });

  test('un componente de categoría CONSULTA es rechazado (422)', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const consulta = await createTestCatalogoServicio(request, { categoria: 'CONSULTA' });
    const res = await request.post(`/api/catalogo/${paquete.id}/componentes`, {
      headers: authHeaders(S.adminToken),
      data: { componente_id: consulta.id, cantidad: 1 },
    });
    expect(res.status()).toBe(422);
  });

  test('componente repetido da 409', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const componente = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    await agregarComponentePaquete(request, paquete.id, { componenteId: componente.id, cantidad: 1 }, S.adminToken);
    const res = await request.post(`/api/catalogo/${paquete.id}/componentes`, {
      headers: authHeaders(S.adminToken),
      data: { componente_id: componente.id, cantidad: 1 },
    });
    expect(res.status()).toBe(409);
  });

  test('un componente no puede convertirse en paquete mientras integra otro (422)', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const componente = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    await agregarComponentePaquete(request, paquete.id, { componenteId: componente.id, cantidad: 1 }, S.adminToken);

    const res = await marcarPaquete(request, componente.id, true, S.adminToken);
    expect(res.status()).toBe(422);
  });

  test('reordenar componentes por posición', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const anestesia = await createTestCatalogoServicio(request, { nombre: 'Anestesia reorder PWTEST', categoria: 'FARMACIA' });
    const monitoreo = await createTestCatalogoServicio(request, { nombre: 'Monitoreo reorder PWTEST', categoria: 'HOSPITALIZACION' });
    await agregarComponentePaquete(request, paquete.id, { componenteId: anestesia.id, cantidad: 1 }, S.adminToken);
    const filaMonitoreo = await agregarComponentePaquete(request, paquete.id, { componenteId: monitoreo.id, cantidad: 1 }, S.adminToken);

    await request.put(`/api/catalogo/componentes/${filaMonitoreo.id}`, {
      headers: authHeaders(S.adminToken),
      data: { posicion: 0 },
    });

    const listado = await listarComponentesPaquete(request, paquete.id, S.adminToken);
    expect(listado.componentes[0].nombre).toBe('Monitoreo reorder PWTEST');
  });

  test('componente desactivado después: sigue en el listado, no suma al total', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO', precio_ref: 10000 });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const componente = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO', precio_ref: 2000 });
    await agregarComponentePaquete(request, paquete.id, { componenteId: componente.id, cantidad: 1 }, S.adminToken);

    let listado = await listarComponentesPaquete(request, paquete.id, S.adminToken);
    expect(listado.total_paquete).toBe(12000);

    await deleteTestCatalogoServicio(request, componente.id, S.adminToken);

    listado = await listarComponentesPaquete(request, paquete.id, S.adminToken);
    expect(listado.componentes[0].activo).toBe(false);
    expect(listado.total_paquete).toBe(10000);
  });

  test('disponibilidad: suma receta propia + de componentes activos, sin tocar stock', async ({ request }) => {
    const material = await createTestProduct(request, { unidad_medida: 'ml', stock_actual: 100, nombre: 'Isoflurano PWTEST' }, S.adminToken);
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const anestesia = await createTestCatalogoServicio(request, { nombre: 'Anestesia disponibilidad PWTEST', categoria: 'FARMACIA' });
    await agregarComponentePaquete(request, paquete.id, { componenteId: anestesia.id, cantidad: 1 }, S.adminToken);

    await agregarRecetaCatalogo(request, paquete.id, { inventarioId: material.id, cantidad: 50, unidadMedida: 'ml' }, S.adminToken);
    await agregarRecetaCatalogo(request, anestesia.id, { inventarioId: material.id, cantidad: 20, unidadMedida: 'ml' }, S.adminToken);

    const disp = await disponibilidadCatalogo(request, paquete.id, S.adminToken);
    expect(disp.suficiente).toBe(true);
    expect(disp.insumos).toHaveLength(1);
    expect(disp.insumos[0].requerido).toBe(70);
    expect(disp.insumos[0].disponible).toBe(100);
    expect(disp.insumos[0].faltante).toBe(0);

    const stockAntes = (await (await request.get(`/api/inventario/${material.id}`, { headers: authHeaders(S.adminToken) })).json()).stock_actual;
    expect(stockAntes).toBe(100);

    await deleteTestProduct(request, material.id, S.adminToken);
  });

  test('disponibilidad: stock insuficiente reporta faltante y suficiente=false', async ({ request }) => {
    const material = await createTestProduct(request, { unidad_medida: 'ml', stock_actual: 30, nombre: 'Isoflurano escaso PWTEST' }, S.adminToken);
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    await agregarRecetaCatalogo(request, paquete.id, { inventarioId: material.id, cantidad: 70, unidadMedida: 'ml' }, S.adminToken);

    const disp = await disponibilidadCatalogo(request, paquete.id, S.adminToken);
    expect(disp.suficiente).toBe(false);
    expect(disp.insumos[0].faltante).toBe(40);

    await deleteTestProduct(request, material.id, S.adminToken);
  });

  // Hallazgo de revisión: `_validar_cambio_es_paquete` solo corre si el PUT
  // trae "es_paquete", y ese chequeo además devuelve temprano si el valor no
  // cambia -- un PUT que solo toca `categoria` se colaba sin validar nada,
  // tanto para un paquete como para un componente.
  test('cambiar la categoría de un paquete a CONSULTA da 422', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);

    const res = await request.put(`/api/catalogo/${paquete.id}`, {
      headers: authHeaders(S.adminToken),
      data: { categoria: 'CONSULTA' },
    });
    expect(res.status()).toBe(422);
  });

  test('cambiar la categoría de un componente de paquete a CONSULTA da 422', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const componente = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    await agregarComponentePaquete(request, paquete.id, { componenteId: componente.id, cantidad: 1 }, S.adminToken);

    const res = await request.put(`/api/catalogo/${componente.id}`, {
      headers: authHeaders(S.adminToken),
      data: { categoria: 'CONSULTA' },
    });
    expect(res.status()).toBe(422);
  });

  test('un servicio que no es paquete ni componente puede seguir cambiando de categoría, incluso a CONSULTA', async ({ request }) => {
    const suelto = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });

    const cambio = await request.put(`/api/catalogo/${suelto.id}`, {
      headers: authHeaders(S.adminToken),
      data: { categoria: 'PELUQUERIA' },
    });
    expect(cambio.ok()).toBeTruthy();
    expect((await cambio.json()).categoria).toBe('PELUQUERIA');

    const aConsulta = await request.put(`/api/catalogo/${suelto.id}`, {
      headers: authHeaders(S.adminToken),
      data: { categoria: 'CONSULTA' },
    });
    expect(aConsulta.ok()).toBeTruthy();
  });
});

test.describe.serial('orden: anexar paquete del catálogo (API)', () => {
  const S = { adminToken: null, propietario: null, mascota: null };

  test.beforeAll(async ({ request }) => {
    S.adminToken = await getAdminToken(request);
    S.propietario = await createTestPropietario(request, {}, S.adminToken);
    S.mascota = await createTestMascota(request, S.propietario.id, {}, S.adminToken);
  });

  async function crearPaqueteConComponentes(request, overridesPaquete = {}, componentesOverrides = []) {
    const paquete = await createTestCatalogoServicio(request, {
      nombre: 'Cirugía de esterilización orden PWTEST', categoria: 'QUIROFANO', precio_ref: 50000,
      ...overridesPaquete,
    });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const defaults = [
      { nombre: 'Anestesia general orden PWTEST', categoria: 'FARMACIA', precio_ref: 15000, cantidad: 1 },
      { nombre: 'Monitoreo orden PWTEST', categoria: 'HOSPITALIZACION', precio_ref: 5000, cantidad: 2 },
    ];
    const specs = componentesOverrides.length ? componentesOverrides : defaults;
    const componentes = [];
    for (const spec of specs) {
      const comp = await createTestCatalogoServicio(request, { nombre: spec.nombre, categoria: spec.categoria, precio_ref: spec.precio_ref });
      await agregarComponentePaquete(request, paquete.id, { componenteId: comp.id, cantidad: spec.cantidad }, S.adminToken);
      componentes.push(comp);
    }
    return { paquete, componentes };
  }

  test('agregar la cirugía como paquete: base + items, SOLICITADO, total de la orden sube', async ({ request }) => {
    const { paquete } = await crearPaqueteConComponentes(request);
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);

    const resp = await anexarPaqueteOrden(request, orden.id, paquete.id, S.adminToken);
    expect(resp.base.es_base).toBe(true);
    expect(resp.base.precio_unitario).toBe(50000);
    expect(resp.items).toHaveLength(2);
    expect(resp.items.every((it) => it.servicio_padre_id === resp.base.id)).toBe(true);
    expect(resp.base.estado).toBe('SOLICITADO');
    expect(resp.items.every((it) => it.estado === 'SOLICITADO')).toBe(true);

    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(S.adminToken) })).json();
    expect(detalle.total).toBe(75000);
    const baseEnDetalle = detalle.servicios.find((s) => s.id === resp.base.id);
    expect(baseEnDetalle.subtotal_paquete).toBe(75000);
  });

  test('stock insuficiente no bloquea: 201, advertencia nombra el material, stock no cambia', async ({ request }) => {
    const material = await createTestProduct(request, { unidad_medida: 'ml', stock_actual: 30, nombre: 'Isoflurano orden PWTEST' }, S.adminToken);
    const { paquete } = await crearPaqueteConComponentes(request, {}, [
      { nombre: 'Anestesia stock PWTEST', categoria: 'FARMACIA', precio_ref: 1000, cantidad: 1 },
    ]);
    await agregarRecetaCatalogo(request, paquete.id, { inventarioId: material.id, cantidad: 70, unidadMedida: 'ml' }, S.adminToken);

    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);
    const resp = await anexarPaqueteOrden(request, orden.id, paquete.id, S.adminToken);
    expect(resp.advertencias.some((a) => a.mensaje.includes('Isoflurano orden PWTEST'))).toBe(true);

    const stockDespues = (await (await request.get(`/api/inventario/${material.id}`, { headers: authHeaders(S.adminToken) })).json()).stock_actual;
    expect(stockDespues).toBe(30);

    await deleteTestProduct(request, material.id, S.adminToken);
  });

  test('componente inactivo se omite, con advertencia, y el resto se crea', async ({ request }) => {
    const { paquete, componentes } = await crearPaqueteConComponentes(request);
    await deleteTestCatalogoServicio(request, componentes[0].id, S.adminToken);

    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);
    const resp = await anexarPaqueteOrden(request, orden.id, paquete.id, S.adminToken);
    expect(resp.items).toHaveLength(1);
    expect(resp.advertencias.some((a) => a.mensaje.includes(componentes[0].nombre))).toBe(true);
  });

  test('un servicio que no es paquete da 422 y la orden no cambia', async ({ request }) => {
    const suelto = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);
    const res = await request.post(`/api/ordenes/${orden.id}/paquetes`, {
      headers: authHeaders(S.adminToken),
      data: { catalogo_servicio_id: suelto.id },
    });
    expect(res.status()).toBe(422);
    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(S.adminToken) })).json();
    expect(detalle.servicios).toHaveLength(0);
  });

  test('un paquete sin componentes activos da 422', async ({ request }) => {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO' });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);
    const res = await request.post(`/api/ordenes/${orden.id}/paquetes`, {
      headers: authHeaders(S.adminToken),
      data: { catalogo_servicio_id: paquete.id },
    });
    expect(res.status()).toBe(422);
  });

  test('orden CERRADA da 409 y no crea ninguna línea', async ({ request }) => {
    const { paquete } = await crearPaqueteConComponentes(request);
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);
    await cerrarTestOrden(request, orden.id, S.adminToken);

    const res = await request.post(`/api/ordenes/${orden.id}/paquetes`, {
      headers: authHeaders(S.adminToken),
      data: { catalogo_servicio_id: paquete.id },
    });
    expect(res.status()).toBe(409);
    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(S.adminToken) })).json();
    expect(detalle.servicios).toHaveLength(0);
  });

  test('recepcionista agregando un paquete QUIROFANO da 403 y no crea líneas', async ({ request }) => {
    const { paquete } = await crearPaqueteConComponentes(request);
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);
    const recepcionista = await createTestRecepcionista(request, S.adminToken);

    const res = await request.post(`/api/ordenes/${orden.id}/paquetes`, {
      headers: authHeaders(recepcionista.token),
      data: { catalogo_servicio_id: paquete.id },
    });
    expect(res.status()).toBe(403);
    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(S.adminToken) })).json();
    expect(detalle.servicios).toHaveLength(0);
  });

  test('cambiar la plantilla o el precio después no cambia las líneas ya creadas', async ({ request }) => {
    const { paquete, componentes } = await crearPaqueteConComponentes(request);
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);
    const resp = await anexarPaqueteOrden(request, orden.id, paquete.id, S.adminToken);
    const itemOriginal = resp.items[0];

    const listado = await listarComponentesPaquete(request, paquete.id, S.adminToken);
    const filaComponente = listado.componentes.find((c) => c.componente_id === componentes[0].id);
    await request.put(`/api/catalogo/componentes/${filaComponente.id}`, {
      headers: authHeaders(S.adminToken),
      data: { cantidad: 99 },
    });
    await request.put(`/api/catalogo/${componentes[0].id}`, {
      headers: authHeaders(S.adminToken),
      data: { precio_ref: 999999 },
    });

    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(S.adminToken) })).json();
    const itemEnOrden = detalle.servicios.find((s) => s.id === itemOriginal.id);
    expect(itemEnOrden.cantidad).toBe(itemOriginal.cantidad);
    expect(itemEnOrden.precio_unitario).toBe(itemOriginal.precio_unitario);
  });

  test('POST /api/ordenes/{id}/servicios con el catalogo_servicio_id de un paquete da 422; armado a mano sigue funcionando', async ({ request }) => {
    const { paquete } = await crearPaqueteConComponentes(request);
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);

    const res = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.adminToken),
      data: { tipo_servicio: 'CIRUGIA', catalogo_servicio_id: paquete.id, precio_unitario: paquete.precio_ref },
    });
    expect(res.status()).toBe(422);

    const suelto1 = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    const suelto2 = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    const base = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'LABORATORIO', catalogo_servicio_id: suelto1.id, precio_unitario: suelto1.precio_ref, es_base: true,
    }, S.adminToken);
    const item = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'LABORATORIO', catalogo_servicio_id: suelto2.id, precio_unitario: suelto2.precio_ref, servicio_padre_id: base.id,
    }, S.adminToken);
    expect(item.servicio_padre_id).toBe(base.id);
  });
});

// Hallazgo de revisión: el guard "un paquete no se anexa suelto" vivía SOLO
// en anexar_servicio_orden -- POST /consultas/{id}/servicios,
// POST /servicios/ y PATCH /servicios/{id} (re-apuntando catalogo_servicio_id)
// lo podían saltear y dejar una línea a medio construir (precio de paquete,
// sin componentes). Los cuatro comparten ahora
// paquete_service.rechazar_si_es_paquete.
test.describe.serial('paquete: el guard "no se anexa suelto" cubre los otros entry points (API)', () => {
  const S = { adminToken: null, propietario: null, mascota: null, veterinario: null };

  test.beforeAll(async ({ request }) => {
    S.adminToken = await getAdminToken(request);
    S.propietario = await createTestPropietario(request, {}, S.adminToken);
    S.mascota = await createTestMascota(request, S.propietario.id, {}, S.adminToken);
    S.veterinario = await createTestVeterinario(request, S.adminToken);
  });

  async function crearPaqueteSimple(request) {
    const paquete = await createTestCatalogoServicio(request, { categoria: 'QUIROFANO', precio_ref: 30000 });
    await marcarPaquete(request, paquete.id, true, S.adminToken);
    const componente = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO', precio_ref: 5000 });
    await agregarComponentePaquete(request, paquete.id, { componenteId: componente.id, cantidad: 1 }, S.adminToken);
    return paquete;
  }

  test('POST /api/consultas/{id}/servicios con el catalogo_servicio_id de un paquete da 422; un suelto sigue funcionando', async ({ request }) => {
    const paquete = await crearPaqueteSimple(request);
    const consulta = await createTestConsulta(request, { mascotaId: S.mascota.id, veterinarioId: S.veterinario.id }, S.adminToken);

    const res = await request.post(`/api/consultas/${consulta.id}/servicios`, {
      headers: authHeaders(S.adminToken),
      data: {
        tipo_servicio: 'PROCEDIMIENTO',
        catalogo_servicio_id: paquete.id,
        nombre_servicio: paquete.nombre,
        precio_unitario: paquete.precio_ref,
      },
    });
    expect(res.status()).toBe(422);

    const suelto = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    const servicio = await anexarServicioConsulta(request, consulta.id, {
      catalogo_servicio_id: suelto.id,
      nombre_servicio: suelto.nombre,
      precio_unitario: suelto.precio_ref,
    }, S.adminToken);
    expect(servicio.catalogo_servicio_id).toBe(suelto.id);

    await deleteTestConsulta(request, consulta.id);
  });

  test('POST /api/servicios/ con el catalogo_servicio_id de un paquete da 422; un suelto sigue funcionando', async ({ request }) => {
    const paquete = await crearPaqueteSimple(request);
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);

    const res = await request.post('/api/servicios/', {
      headers: authHeaders(S.adminToken),
      data: {
        mascota_id: S.mascota.id,
        orden_id: orden.id,
        tipo_servicio: 'ESTETICA',
        catalogo_servicio_id: paquete.id,
        nombre_servicio: paquete.nombre,
        precio_unitario: paquete.precio_ref,
        estado: 'SOLICITADO',
      },
    });
    expect(res.status()).toBe(422);

    const suelto = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    const servicio = await createTestServicioDirecto(request, S.mascota.id, {
      orden_id: orden.id,
      catalogo_servicio_id: suelto.id,
      nombre_servicio: suelto.nombre,
      precio_unitario: suelto.precio_ref,
    }, S.adminToken);
    expect(servicio.catalogo_servicio_id).toBe(suelto.id);

    await deleteTestServicio(request, servicio.id, S.adminToken);
  });

  test('PATCH /api/servicios/{id} re-apuntando catalogo_servicio_id a un paquete da 422; a un suelto sigue funcionando', async ({ request }) => {
    const paquete = await crearPaqueteSimple(request);
    const suelto1 = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    const suelto2 = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO' });
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.adminToken);
    const servicio = await createTestServicioDirecto(request, S.mascota.id, {
      orden_id: orden.id,
      catalogo_servicio_id: suelto1.id,
      nombre_servicio: suelto1.nombre,
      precio_unitario: suelto1.precio_ref,
    }, S.adminToken);

    const res = await request.patch(`/api/servicios/${servicio.id}`, {
      headers: authHeaders(S.adminToken),
      data: { catalogo_servicio_id: paquete.id },
    });
    expect(res.status()).toBe(422);

    const resOk = await request.patch(`/api/servicios/${servicio.id}`, {
      headers: authHeaders(S.adminToken),
      data: { catalogo_servicio_id: suelto2.id },
    });
    expect(resOk.ok()).toBeTruthy();
    expect((await resOk.json()).catalogo_servicio_id).toBe(suelto2.id);

    await deleteTestServicio(request, servicio.id, S.adminToken);
  });
});

test.describe('UI catálogo: plantillas de paquete', () => {
  test('admin crea un servicio con "Es paquete" tildado y queda es_paquete=true', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-catalogo');

    const nombre = `Paquete UI crear PWTEST ${Date.now()}`;
    await page.click('button[onclick="abrirModalServicio()"]');
    await expect(page.locator('#modalCatalogoServicio')).toBeVisible();
    await page.fill('#catalogoNombre', nombre);
    await page.selectOption('#catalogoCategoria', 'QUIROFANO');
    await page.fill('#catalogoPrecioRef', '10000');
    await expect(page.locator('#catalogoEsPaqueteGroup')).toBeVisible();
    await page.check('#catalogoEsPaquete');
    await page.click('#formCatalogoServicio button[type="submit"]');
    await expect(page.locator('#modalCatalogoServicio')).toBeHidden();

    // Filtra por nombre (`q`) en vez de traer las primeras 500 filas: la DB de
    // dev acumula catálogo de corridas anteriores y el nuevo servicio podía
    // no entrar en esa página si hay más de 500 activos (hallazgo de esta
    // corrida, ver evidencia de la tarea 6.3 en tasks.md).
    const lista = await (await request.get(`/api/catalogo?solo_activos=true&limit=10&q=${encodeURIComponent(nombre)}`, { headers: authHeaders(admin) })).json();
    const creado = lista.find((s) => s.nombre === nombre);
    expect(creado).toBeTruthy();
    expect(creado.es_paquete).toBe(true);
  });

  test('admin arma el paquete en pantalla: agrega dos componentes, ve subtotales, total y el faltante de stock resaltado', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const material = await createTestProduct(request, { unidad_medida: 'ml', stock_actual: 30, nombre: 'Isoflurano UI PWTEST' }, admin);
    const paquete = await createTestCatalogoServicio(request, { nombre: 'Cirugía UI PWTEST', categoria: 'QUIROFANO', precio_ref: 50000 });
    await marcarPaquete(request, paquete.id, true, admin);
    const anestesia = await createTestCatalogoServicio(request, { nombre: 'Anestesia UI comp PWTEST', categoria: 'FARMACIA', precio_ref: 15000 });
    const monitoreo = await createTestCatalogoServicio(request, { nombre: 'Monitoreo UI comp PWTEST', categoria: 'HOSPITALIZACION', precio_ref: 5000 });
    await agregarRecetaCatalogo(request, paquete.id, { inventarioId: material.id, cantidad: 70, unidadMedida: 'ml' }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-catalogo');
    await page.fill('#catalogoSearch', 'Cirugía UI PWTEST');
    await page.click(`.cat-item[data-id="${paquete.id}"]`);
    await expect(page.locator('.cat-detail-pills')).toContainText('PAQUETE');

    await page.click('#btnCatAgregarComponente');
    await page.selectOption('#catComponenteSelect', String(anestesia.id));
    await page.fill('#catComponenteCantidad', '1');
    await page.click('#btnCatConfirmarComponente');
    await expect(page.locator('#catPaqueteComponentesBody')).toContainText('Anestesia UI comp PWTEST');

    await page.click('#btnCatAgregarComponente');
    await page.selectOption('#catComponenteSelect', String(monitoreo.id));
    await page.fill('#catComponenteCantidad', '2');
    await page.click('#btnCatConfirmarComponente');
    await expect(page.locator('#catPaqueteComponentesBody')).toContainText('Monitoreo UI comp PWTEST');

    // formatMoney usa locale es-AR: "15.000,00" (punto de miles, coma decimal).
    const filaAnestesia = page.locator('#catPaqueteComponentesBody tr', { hasText: 'Anestesia UI comp PWTEST' });
    await expect(filaAnestesia).toContainText('15.000,00');
    const filaMonitoreo = page.locator('#catPaqueteComponentesBody tr', { hasText: 'Monitoreo UI comp PWTEST' });
    await expect(filaMonitoreo).toContainText('10.000,00');
    await expect(page.locator('.cat-detail-section-head', { hasText: 'Componentes del paquete' })).toContainText('75.000,00');

    const filaInsumo = page.locator('.cat-detail-section', { hasText: 'Insumos y stock' }).locator('tbody tr', { hasText: 'Isoflurano UI PWTEST' });
    await expect(filaInsumo.locator('.av-text-danger')).toBeVisible();

    await deleteTestProduct(request, material.id, admin);
  });

  test('un veterinario ve el paquete sin controles de edición', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const vet = await createTestVeterinario(request, admin);
    const vetToken = await loginAs(request, vet.username, TEST_USER_PASSWORD);
    const paquete = await createTestCatalogoServicio(request, { nombre: 'Paquete solo lectura PWTEST', categoria: 'QUIROFANO', precio_ref: 20000 });
    await marcarPaquete(request, paquete.id, true, admin);
    const componente = await createTestCatalogoServicio(request, { nombre: 'Componente solo lectura PWTEST', categoria: 'LABORATORIO', precio_ref: 4000 });
    await agregarComponentePaquete(request, paquete.id, { componenteId: componente.id, cantidad: 1 }, admin);

    await loginUI(page, vet.username, TEST_USER_PASSWORD);
    await gotoSection(page, 'sec-catalogo');
    await page.fill('#catalogoSearch', 'Paquete solo lectura PWTEST');
    await page.click(`.cat-item[data-id="${paquete.id}"]`);
    await expect(page.locator('#catPaqueteComponentesBody')).toContainText('Componente solo lectura PWTEST');
    await expect(page.locator('#btnCatAgregarComponente')).toHaveCount(0);
    await expect(page.locator('.paquete-quitar')).toHaveCount(0);
    await expect(page.locator('.paquete-subir')).toHaveCount(0);
  });
});

test.describe('UI orden: anexar paquete del catálogo', () => {
  test('elegir un paquete con faltante lo muestra antes de confirmar; "Agregar paquete" arma base + items en la orden', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const suf = Date.now();
    const material = await createTestProduct(request, { unidad_medida: 'ml', stock_actual: 30, nombre: `Isoflurano orden UI PWTEST ${suf}` }, admin);
    const paquete = await createTestCatalogoServicio(request, {
      nombre: `Cirugía orden UI PWTEST ${suf}`, categoria: 'QUIROFANO', precio_ref: 50000,
    });
    await marcarPaquete(request, paquete.id, true, admin);
    const anestesia = await createTestCatalogoServicio(request, { nombre: `Anestesia orden UI PWTEST ${suf}`, categoria: 'FARMACIA', precio_ref: 15000 });
    await agregarComponentePaquete(request, paquete.id, { componenteId: anestesia.id, cantidad: 1 }, admin);
    await agregarRecetaCatalogo(request, paquete.id, { inventarioId: material.id, cantidad: 70, unidadMedida: 'ml' }, admin);

    const propietario = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, propietario.id, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: propietario.id, mascotaId: mascota.id }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await page.evaluate((id) => window.abrirOrden(id), orden.id);
    await page.click('#btnOaAnexarInline');
    await expect(page.locator('#oaAnexarPanel')).toBeVisible();
    await page.fill('#oaAnexarSearch', `Cirugía orden UI PWTEST ${suf}`);

    const itemPaquete = page.locator('.oa-svc-item', { hasText: `Cirugía orden UI PWTEST ${suf}` });
    await expect(itemPaquete).toContainText('PAQUETE');
    await itemPaquete.click();

    await expect(page.locator('#oaPaqueteWrap')).toBeVisible();
    await expect(page.locator('#oaConsumosWrap')).toBeHidden();
    await expect(page.locator('#oaBasePadreGroup')).toBeHidden();
    await expect(page.locator('#oaPaqueteComponentes')).toContainText(`Anestesia orden UI PWTEST ${suf}`);
    await expect(page.locator('#oaPaqueteDisponibilidad')).toContainText(`Isoflurano orden UI PWTEST ${suf}`);
    await expect(page.locator('#oaPaqueteDisponibilidad .av-text-danger')).toBeVisible();

    const btnConfirmar = page.locator('#btnOaAnexarConfirmar');
    await expect(btnConfirmar).toContainText('Agregar paquete');
    await expect(btnConfirmar).toBeEnabled();
    await btnConfirmar.click();

    await expect(page.locator('#oaAnexarPanel')).toBeHidden();
    const filaBase = page.locator('tr.oa-paquete-base', { hasText: `Cirugía orden UI PWTEST ${suf}` });
    await expect(filaBase).toBeVisible();
    await expect(filaBase).toContainText('PAQUETE');
    const filaItem = page.locator('tr.oa-paquete-item', { hasText: `Anestesia orden UI PWTEST ${suf}` });
    await expect(filaItem).toBeVisible();
    await expect(page.locator('#oaTotal')).toContainText('65000.00');

    await deleteTestProduct(request, material.id, admin);
  });
});
