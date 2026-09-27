// Unidad — Anexar la línea CONSULTA directo a la orden con el atajo sin
// despacho (openspec/changes/consulta-directa-atajo-sin-despacho).
//
// No hay infraestructura de tests unitarios de backend (sin pytest/conftest
// en este repo): toda la cobertura va acá, a nivel de API (fixture `request`
// + `e2e/helpers.js`), mismo criterio que
// e2e/asignacion-directa-servicio-gestor.spec.js.
//
// Contrato bajo prueba:
//   - POST /api/ordenes/{id}/servicios con tipo_servicio='CONSULTA' → 201,
//     EJECUTADO directo, area_id NULL, asignado a body.veterinario_id o, si
//     no viene, a orden.veterinario_id; la orden pasa a EN_ATENCION.
//     422 sin veterinario en ninguno de los dos, 400 si no es veterinario,
//     409 si la orden ya tiene su consulta (uq_orden_una_consulta).
//   - ServicioConsultaResponse.veterinario_nombre / area_nombre (schemas.py),
//     también para la línea que crea POST /api/consultas/.

const { test, expect } = require('@playwright/test');
const {
  getAdminToken,
  loginAs,
  TEST_USER_PASSWORD,
  createTestUser,
  deleteTestUser,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestOrden,
  createTestConsulta,
  createTestRecepcionista,
  limpiarReferenciasDeGestor,
  authHeaders,
} = require('./helpers');

/** POST /api/ordenes/{id}/servicios crudo -- los casos de error esperan 4xx. */
async function anexarConsulta(request, ordenId, token, extra = {}) {
  return request.post(`/api/ordenes/${ordenId}/servicios`, {
    headers: authHeaders(token),
    data: { tipo_servicio: 'CONSULTA', nombre_servicio: 'Honorario consulta', precio_unitario: 25000, ...extra },
  });
}

/** GET /api/ordenes/{id}. Throws on rejection. */
async function obtenerOrden(request, ordenId, token) {
  const res = await request.get(`/api/ordenes/${ordenId}`, { headers: authHeaders(token) });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to get orden ${ordenId}: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

test.describe.serial('Consulta directa con atajo sin despacho (consulta-directa-atajo-sin-despacho)', () => {
  const S = {
    token: null, // admin
    vet: null,
    vetToken: null,
    vetOtro: null,
    recep: null,
    propietario: null,
    mascota: null,
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.vet = await createTestUser(request, S.token, { role: 'veterinario' });
    S.vetToken = await loginAs(request, S.vet.username, TEST_USER_PASSWORD);
    S.vetOtro = await createTestUser(request, S.token, { role: 'veterinario' });
    S.recep = await createTestRecepcionista(request, S.token);
    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);
  });

  test.afterAll(async ({ request }) => {
    limpiarReferenciasDeGestor(S.vet.id, S.vetOtro.id);
    await deleteTestUser(request, S.token, S.vet.id);
    await deleteTestUser(request, S.token, S.vetOtro.id);
    await deleteTestUser(request, S.token, S.recep.user.id);
    await deleteTestMascota(request, S.mascota.id);
    await deleteTestPropietario(request, S.propietario.id);
  });

  function abrirOrden(request, veterinarioId = null) {
    return createTestOrden(
      request,
      { propietarioId: S.propietario.id, mascotaId: S.mascota.id, veterinarioId },
      S.token,
    );
  }

  test('sin veterinario_id en el body hereda el de la orden: EJECUTADO, sin área, orden EN_ATENCION', async ({ request }) => {
    const orden = await abrirOrden(request, S.vet.id);
    expect(orden.estado).toBe('ABIERTA');

    const res = await anexarConsulta(request, orden.id, S.vetToken);
    expect(res.status()).toBe(201);
    const linea = await res.json();
    expect(linea.tipo_servicio).toBe('CONSULTA');
    expect(linea.estado).toBe('EJECUTADO');
    expect(linea.area_id).toBeNull();
    expect(linea.asignado_a_id).toBe(S.vet.id);
    expect(linea.consulta_id).toBeNull();
    expect(linea.estado_toma).toBe('completada');
    expect(linea.area_nombre).toBe('NINGUNO');

    const detalle = await obtenerOrden(request, orden.id, S.token);
    expect(detalle.estado).toBe('EN_ATENCION');
    const enOrden = detalle.servicios.find((s) => s.id === linea.id);
    expect(enOrden.veterinario_nombre).toBe(S.vet.username);
    expect(enOrden.area_nombre).toBe('NINGUNO');
    expect(enOrden.estado_toma).toBe('completada');
  });

  test('veterinario_id explícito en el body tiene prioridad sobre el de la orden', async ({ request }) => {
    const orden = await abrirOrden(request, S.vet.id);
    const res = await anexarConsulta(request, orden.id, S.token, { veterinario_id: S.vetOtro.id });
    expect(res.status()).toBe(201);
    expect((await res.json()).asignado_a_id).toBe(S.vetOtro.id);

    const detalle = await obtenerOrden(request, orden.id, S.token);
    const consulta = detalle.servicios.find((s) => s.tipo_servicio === 'CONSULTA');
    expect(consulta.veterinario_nombre).toBe(S.vetOtro.username);
  });

  test('orden sin veterinario: con veterinario_id en el body anda, sin él es 422', async ({ request }) => {
    const sinVet = await abrirOrden(request, null);
    const rechazada = await anexarConsulta(request, sinVet.id, S.token);
    expect(rechazada.status()).toBe(422);
    expect((await rechazada.json()).detail).toContain('no tiene veterinario asignado');

    // Nada quedó a medias: la orden sigue ABIERTA y sin líneas.
    const intacta = await obtenerOrden(request, sinVet.id, S.token);
    expect(intacta.estado).toBe('ABIERTA');
    expect(intacta.servicios).toHaveLength(0);

    const ok = await anexarConsulta(request, sinVet.id, S.token, { veterinario_id: S.vet.id });
    expect(ok.status()).toBe(201);
    expect((await ok.json()).asignado_a_id).toBe(S.vet.id);
  });

  test('veterinario_id que no es veterinario (o no existe) es 400', async ({ request }) => {
    const orden = await abrirOrden(request, S.vet.id);

    const noVet = await anexarConsulta(request, orden.id, S.token, { veterinario_id: S.recep.user.id });
    expect(noVet.status()).toBe(400);
    expect((await noVet.json()).detail).toContain('rol veterinario');

    const inexistente = await anexarConsulta(request, orden.id, S.token, { veterinario_id: 99999999 });
    expect(inexistente.status()).toBe(400);
  });

  test('una segunda CONSULTA en la misma orden es 409 (uq_orden_una_consulta)', async ({ request }) => {
    const orden = await abrirOrden(request, S.vet.id);
    expect((await anexarConsulta(request, orden.id, S.vetToken)).status()).toBe(201);

    const segunda = await anexarConsulta(request, orden.id, S.vetToken);
    expect(segunda.status()).toBe(409);
    expect((await segunda.json()).detail).toContain('ya tiene una consulta');
  });

  test('GET /api/ordenes/{id} expone veterinario_nombre y area_nombre en todas las líneas, también la de POST /api/consultas/', async ({ request }) => {
    const consulta = await createTestConsulta(
      request,
      { mascotaId: S.mascota.id, veterinarioId: S.vet.id },
      S.vetToken,
    );
    // La orden la abrió createTestConsulta: se la encuentra por el listado del tutor.
    const ordenes = await (await request.get(
      `/api/ordenes/?propietario_id=${S.propietario.id}&limit=500`,
      { headers: authHeaders(S.token) },
    )).json();
    let linea = null;
    for (const o of ordenes) {
      const detalle = await obtenerOrden(request, o.id, S.token);
      linea = detalle.servicios.find((s) => s.consulta_id === consulta.id);
      if (linea) {
        for (const s of detalle.servicios) {
          expect(s).toHaveProperty('veterinario_nombre');
          expect(s).toHaveProperty('area_nombre');
        }
        break;
      }
    }
    expect(linea).not.toBeNull();
    expect(linea.veterinario_nombre).toBe(S.vet.username);
    expect(linea.area_nombre).toBe('NINGUNO');
    expect(linea.estado_toma).toBe('completada');
  });
});
