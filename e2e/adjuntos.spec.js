// Unidad — Adjuntos (Tarea 06, FASE 2, etapa 6)
//
// docs/diseno/ordenes-de-servicio.md · decisiones 7, 8 y 9 (filas 16-18).
//
// Archivo separado de e2e/despacho.spec.js: esa unidad ya prueba las dos
// ramas del candado `requiere_adjunto` sobre la transición EN_PROCESO ->
// EJECUTADO (rechazo sin adjunto y éxito con uno real, reusando el mismo
// fixture `areaConAdjunto`); acá se prueba el contrato propio de los
// endpoints de adjuntos: validación de bytes y la matriz de permisos
// (subir/descargar/borrar), que es un concepto distinto del despacho.
//
// Contrato bajo prueba:
//   - POST   /api/servicios/{id}/adjuntos  → admin/veterinario siempre;
//     gestor SOLO el que tomó el servicio (fila 16). 415 si el contenido no
//     matchea ninguna firma de la lista blanca (o no coincide con el
//     content_type declarado); nunca escribe nada a disco en ese caso.
//   - GET    /api/adjuntos/{id}            → admin/recepción/veterinario
//     siempre; gestor SOLO si tomó ESE servicio puntual (fila 17). Nunca un
//     redirect a static/: el Content-Disposition/Content-Type salen de la
//     fila guardada (el tipo DETECTADO, no el declarado ni la extensión en
//     disco).
//   - DELETE /api/adjuntos/{id}            → admin/veterinario siempre;
//     gestor SOLO el que subió (fila 18). Soft delete: no aparece más en el
//     listado ni en la descarga, pero la fila (y el archivo físico) quedan.
//   - GET    /api/servicios/{id}/adjuntos  → mismo gate de lectura que la
//     descarga individual, a nivel de servicio.

const { test, expect } = require('@playwright/test');
const {
  getAdminToken,
  loginAs,
  TEST_USER_PASSWORD,
  testTag,
  createTestUser,
  deleteTestUser,
  createTestRecepcionista,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestOrden,
  anexarServicioOrden,
  confirmarServiciosOrden,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  createTestArea,
  desactivarTestArea,
  agregarGestorArea,
  createTestGestor,
  tomarServicio,
  subirAdjunto,
  descargarAdjunto,
  borrarAdjunto,
  listarAdjuntosServicio,
  pdfBufferValido,
  bufferNoReconocido,
} = require('./helpers');

test.describe.serial('Adjuntos (Tarea 06, etapa 6)', () => {
  const S = {
    token: null,       // admin
    vet: null,
    vetToken: null,
    recepcion: null,
    propietario: null,
    mascota: null,
    area: null,
    catalogo: null,
    gestorA: null,      // toma los servicios de este describe
    gestorB: null,       // mismo área, nunca toma nada
    gestorAjeno: null,   // área distinta
  };

  /** Crea una orden, anexa un servicio despachado a S.area y lo confirma.
   * NO lo toma -- cada test decide quién lo toma, si corresponde. */
  async function crearServicioDespachado(request) {
    const orden = await createTestOrden(
      request,
      { propietarioId: S.propietario.id, mascotaId: S.mascota.id },
      S.vetToken,
    );
    const servicio = await anexarServicioOrden(
      request,
      orden.id,
      { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: S.catalogo.id },
      S.vetToken,
    );
    await confirmarServiciosOrden(request, orden.id, S.vetToken);
    return servicio;
  }

  async function crearServicioTomadoPorGestorA(request) {
    const servicio = await crearServicioDespachado(request);
    const tomado = await tomarServicio(request, servicio.id, S.gestorA.token);
    expect(tomado.ok()).toBe(true);
    return servicio;
  }

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    const vet = await createTestUser(request, S.token, { role: 'veterinario' });
    S.vet = vet;
    S.vetToken = await loginAs(request, vet.username, TEST_USER_PASSWORD);
    S.recepcion = await createTestRecepcionista(request, S.token);

    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);

    S.area = await createTestArea(request, S.token, { nombre: testTag('AreaAdjuntos') });
    S.catalogo = await createTestCatalogoServicio(request, {
      categoria: 'LABORATORIO',
      area_id: S.area.id,
    });

    S.areaAjena = await createTestArea(request, S.token, { nombre: testTag('AreaAdjuntosAjena') });
    S.gestorA = await createTestGestor(request, S.token);
    S.gestorB = await createTestGestor(request, S.token);
    S.gestorAjeno = await createTestGestor(request, S.token);
    await agregarGestorArea(request, S.token, S.area.id, S.gestorA.user.id);
    await agregarGestorArea(request, S.token, S.area.id, S.gestorB.user.id);
    await agregarGestorArea(request, S.token, S.areaAjena.id, S.gestorAjeno.user.id);
  });

  test.afterAll(async ({ request }) => {
    await desactivarTestArea(request, S.token, S.area.id);
    await desactivarTestArea(request, S.token, S.areaAjena.id);
    await deleteTestCatalogoServicio(request, S.catalogo.id);
    await deleteTestUser(request, S.token, S.gestorA.user.id);
    await deleteTestUser(request, S.token, S.gestorB.user.id);
    await deleteTestUser(request, S.token, S.gestorAjeno.user.id);
    await deleteTestUser(request, S.token, S.recepcion.user.id);
    await deleteTestUser(request, S.token, S.vet.id);
    await deleteTestMascota(request, S.mascota.id);
    await deleteTestPropietario(request, S.propietario.id);
  });

  test('un endpoint protegido nuevo rechaza sin token (401)', async ({ request }) => {
    const servicio = await crearServicioTomadoPorGestorA(request);
    const resSinToken = await request.post(`/api/servicios/${servicio.id}/adjuntos`, {
      multipart: { archivo: { name: 'x.pdf', mimeType: 'application/pdf', buffer: pdfBufferValido() } },
    });
    expect(resSinToken.status()).toBe(401);
  });

  test('gate de subida: gestor que no tomó el servicio no puede subir; el que sí lo tomó, puede', async ({ request }) => {
    const servicio = await crearServicioTomadoPorGestorA(request);

    const resB = await subirAdjunto(request, servicio.id, S.gestorB.token);
    expect(resB.status()).toBe(403);

    const resAjeno = await subirAdjunto(request, servicio.id, S.gestorAjeno.token);
    expect(resAjeno.status()).toBe(403);

    const resA = await subirAdjunto(request, servicio.id, S.gestorA.token);
    expect(resA.ok()).toBe(true);
    const body = await resA.json();
    expect(body.servicio_id).toBe(servicio.id);
    expect(body.content_type).toBe('application/pdf');
  });

  test('un archivo con extensión permitida pero contenido de otro tipo se rechaza con 415', async ({ request }) => {
    const servicio = await crearServicioTomadoPorGestorA(request);

    const res = await subirAdjunto(request, servicio.id, S.gestorA.token, {
      buffer: bufferNoReconocido(),
      filename: 'informe.pdf',
      mimeType: 'application/pdf',
    });
    expect(res.status()).toBe(415);

    // Nada se escribió: el listado del servicio sigue vacío.
    const listado = await listarAdjuntosServicio(request, servicio.id, S.vetToken);
    expect((await listado.json()).length).toBe(0);
  });

  test('recorrido feliz: subir, descargar (bytes + Content-Disposition + content_type) y borrar (soft)', async ({ request }) => {
    const servicio = await crearServicioTomadoPorGestorA(request);
    const buffer = pdfBufferValido();

    const subida = await subirAdjunto(request, servicio.id, S.gestorA.token, {
      buffer,
      filename: 'estudio-laboratorio.pdf',
    });
    expect(subida.ok()).toBe(true);
    const adjunto = await subida.json();
    expect(adjunto.tamano_bytes).toBe(buffer.length);

    const descarga = await descargarAdjunto(request, adjunto.id, S.vetToken);
    expect(descarga.ok()).toBe(true);
    expect(descarga.headers()['content-type']).toBe('application/pdf');
    expect(descarga.headers()['content-disposition']).toContain('attachment');
    expect(descarga.headers()['content-disposition']).toContain('estudio-laboratorio.pdf');
    expect(descarga.headers()['x-content-type-options']).toBe('nosniff');
    const bytes = await descarga.body();
    expect(Buffer.compare(bytes, buffer)).toBe(0);

    const borrado = await borrarAdjunto(request, adjunto.id, S.gestorA.token);
    expect(borrado.status()).toBe(204);

    // Soft delete: ya no aparece en el listado ni se puede descargar.
    const listadoTrasBorrar = await listarAdjuntosServicio(request, servicio.id, S.vetToken);
    expect((await listadoTrasBorrar.json()).some((a) => a.id === adjunto.id)).toBe(false);

    const descargaTrasBorrar = await descargarAdjunto(request, adjunto.id, S.vetToken);
    expect(descargaTrasBorrar.status()).toBe(404);
  });

  test('gate de borrado: solo quien subió (o admin/veterinario) puede borrar', async ({ request }) => {
    const servicio = await crearServicioTomadoPorGestorA(request);
    const subida = await subirAdjunto(request, servicio.id, S.gestorA.token);
    const adjunto = await subida.json();

    // gestorB no lo subió (aunque sea del mismo área) -> 403.
    const resB = await borrarAdjunto(request, adjunto.id, S.gestorB.token);
    expect(resB.status()).toBe(403);

    // El veterinario, que no lo subió, sí puede (fila 18: admin/veterinario siempre).
    const resVet = await borrarAdjunto(request, adjunto.id, S.vetToken);
    expect(resVet.status()).toBe(204);
  });

  test('un usuario sin permiso no puede descargar el adjunto de otra orden', async ({ request }) => {
    const servicio = await crearServicioTomadoPorGestorA(request);
    const subida = await subirAdjunto(request, servicio.id, S.gestorA.token);
    const adjunto = await subida.json();

    // Gestor de un área ajena: 403.
    const resAjeno = await descargarAdjunto(request, adjunto.id, S.gestorAjeno.token);
    expect(resAjeno.status()).toBe(403);

    // Gestor de la MISMA área, pero que no tomó este servicio puntual: 403
    // también (fila 17 -- "sus servicios" se resuelve por asignado_a_id, no
    // solo por membresía de área; ver header de adjuntos.py).
    const resB = await descargarAdjunto(request, adjunto.id, S.gestorB.token);
    expect(resB.status()).toBe(403);

    // Recepción sí puede (fila 17: admin/recepción/veterinario siempre),
    // aunque recepción NO pueda subir (fila 16).
    const resRecepcion = await descargarAdjunto(request, adjunto.id, S.recepcion.token);
    expect(resRecepcion.ok()).toBe(true);
    const resSubirRecepcion = await subirAdjunto(request, servicio.id, S.recepcion.token);
    expect(resSubirRecepcion.status()).toBe(403);
  });
});
