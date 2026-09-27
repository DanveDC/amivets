// @ts-check
// Gestores externos (gestor-externo-crud): CRUD de proveedores/laboratorios
// de referencia sin login, asignación N:M a áreas de despacho, y su
// integración con `notificar_asignacion` (SERVICIO_ASIGNADO_EXTERNO).
//
// No hay infraestructura de tests unitarios de backend (sin pytest/conftest
// en este repo, ver e2e/asignacion-directa-servicio-gestor.spec.js): toda la
// cobertura va acá, a nivel de API (fixture `request` + `e2e/helpers.js`) y
// de UI, mismo criterio que el resto de la suite.
//
// Verificación de "notificación creada en BD" (tarea 7.1, último bullet): un
// gestor externo no tiene login ni bandeja propia (design.md, Non-Goals: "sin
// portal"), así que no hay ningún endpoint de la API que un test pueda
// consultar para leer SU notificación -- a diferencia de gestores internos,
// donde existe GET /api/notificaciones/ con el token del propio gestor (ver
// asignacion-directa-servicio-gestor.spec.js). Como tampoco existe ningún
// helper de acceso a BD en este repo de e2e, se agrega uno mínimo acá mismo
// (`consultarNotificacionExterna`) que corre `psql` DENTRO del contenedor
// `veterinaria_db` vía `docker exec` -- mismo host Docker local al que ya
// está atado este suite (helpers.js valida BASE_URL contra localhost/127.0.0.1
// arriba de todo). Las credenciales son las por defecto de
// docker-compose.yml (vetuser/veterinaria_db), overrideables por env var
// para quien corra un stack con otro POSTGRES_USER/POSTGRES_DB.

const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestArea,
  desactivarTestArea,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestOrden,
  anexarServicioOrden,
  confirmarServiciosOrden,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  gotoSection,
} = require('./helpers');

const DB_CONTAINER = process.env.PGDOCKER_CONTAINER || 'veterinaria_db';
const DB_USER = process.env.POSTGRES_USER || 'vetuser';
const DB_NAME = process.env.POSTGRES_DB || 'veterinaria_db';

/**
 * Corre una consulta de solo lectura contra la BD del stack local vía
 * `docker exec` + `psql`, y devuelve las filas como array de arrays de
 * strings (formato `-A` sin encabezados, separador `|`). Ver comentario de
 * cabecera: es el único acceso disponible a una notificación externa, que no
 * tiene ningún endpoint propio.
 */
function queryDb(sql) {
  const raw = execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tA', '-c', sql],
    { encoding: 'utf-8' }
  );
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|'));
}

// ── Helpers propios de gestores externos (mismo estilo que helpers.js: la
// creación throws en rechazo, la limpieza es best-effort) ──────────────────

async function crearGestorExterno(request, adminToken, overrides = {}) {
  const payload = {
    nombre: testTag('GestorExt'),
    rif: `J-${Math.floor(10000000 + Math.random() * 89999999)}-${Math.floor(Math.random() * 9)}`,
    telefono: '04121234567',
    metodo_pago: 'TRANSFERENCIA',
    ...overrides,
  };
  const res = await request.post('/api/gestores-externos/', { headers: authHeaders(adminToken), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create gestor externo: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function eliminarGestorExterno(request, adminToken, id) {
  try {
    await request.delete(`/api/gestores-externos/${id}`, { headers: authHeaders(adminToken) });
  } catch (_) {
    // best-effort cleanup
  }
}

/**
 * Borra en BD, scoped por ID, las notificaciones de un gestor externo.
 * `notificaciones.gestor_externo_id` es ON DELETE RESTRICT (spec, "Integridad
 * del destinatario"): protege el historial real en producción, pero implica
 * que un gestor de fixture que recibió una notificación no se puede
 * hard-deletear vía la API sin este paso previo. Sin esto, cada corrida del
 * suite dejaría 1+ filas de `gestores_externos` (y sus notificaciones)
 * acumulándose en la BD persistente. Mismo estilo que
 * `limpiarReferenciasDeGestor` en helpers.js: best-effort (try/catch) para no
 * romper el resto de la limpieza si Docker no está disponible.
 */
function limpiarNotificacionesDeGestorExterno(...gestorIds) {
  const ids = gestorIds.filter(Boolean);
  if (!ids.length) return;
  try {
    execFileSync(
      'docker',
      [
        'exec', DB_CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-c',
        `DELETE FROM notificaciones WHERE gestor_externo_id IN (${ids.join(',')});`,
      ],
      { stdio: 'ignore' },
    );
  } catch (_) {
    // best-effort cleanup, ver comentario de arriba.
  }
}

async function asignarAreaGestorExterno(request, adminToken, gestorId, areaId) {
  return request.post(`/api/gestores-externos/${gestorId}/areas/`, {
    headers: authHeaders(adminToken),
    data: { area_id: areaId },
  });
}

async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Gestores externos (gestor-externo-crud)', () => {
  test.describe('API', () => {
    let admin;
    let area;

    test.beforeAll(async ({ request }) => {
      admin = await getAdminToken(request);
      area = await createTestArea(request, admin, { nombre: testTag('AreaGestorExt') });
    });

    test.afterAll(async ({ request }) => {
      if (area) {
        await desactivarTestArea(request, admin, area.id);
      }
    });

    test('crear gestor externo completo -> 201, aparece en la lista', async ({ request }) => {
      const gestor = await crearGestorExterno(request, admin, { nombre: testTag('GestorCompleto') });
      expect(gestor.activo).toBe(true);
      expect(gestor.created_at).toBeTruthy();
      expect(gestor.rif).toBe(gestor.rif.toUpperCase());

      const lista = await (await request.get('/api/gestores-externos/?limit=500', { headers: authHeaders(admin) })).json();
      expect(lista.some((g) => g.id === gestor.id)).toBe(true);

      await eliminarGestorExterno(request, admin, gestor.id);
    });

    test('RIF duplicado -> 409', async ({ request }) => {
      const rif = `J-${Math.floor(10000000 + Math.random() * 89999999)}-1`;
      const gestor = await crearGestorExterno(request, admin, { rif });
      const res = await request.post('/api/gestores-externos/', {
        headers: authHeaders(admin),
        data: { nombre: testTag('Dup'), rif, telefono: '04129999999', metodo_pago: 'EFECTIVO' },
      });
      expect(res.status()).toBe(409);

      await eliminarGestorExterno(request, admin, gestor.id);
    });

    test('asignar y desasignar área: ok, y duplicado -> 409', async ({ request }) => {
      const gestor = await crearGestorExterno(request, admin);

      const resAsignar = await asignarAreaGestorExterno(request, admin, gestor.id, area.id);
      expect(resAsignar.ok()).toBe(true);

      const resDup = await asignarAreaGestorExterno(request, admin, gestor.id, area.id);
      expect(resDup.status()).toBe(409);

      const detalle = await (await request.get(`/api/gestores-externos/${gestor.id}`, { headers: authHeaders(admin) })).json();
      expect(detalle.areas.map((a) => a.id)).toContain(area.id);

      const resDesasignar = await request.delete(`/api/gestores-externos/${gestor.id}/areas/${area.id}`, {
        headers: authHeaders(admin),
      });
      expect(resDesasignar.status()).toBe(204);

      const detalleLuego = await (await request.get(`/api/gestores-externos/${gestor.id}`, { headers: authHeaders(admin) })).json();
      expect(detalleLuego.areas.map((a) => a.id)).not.toContain(area.id);

      await eliminarGestorExterno(request, admin, gestor.id);
    });

    test('RIF inmutable con áreas asignadas -> 422; sin áreas se actualiza normalizado', async ({ request }) => {
      const gestor = await crearGestorExterno(request, admin);
      await asignarAreaGestorExterno(request, admin, gestor.id, area.id);

      const resConAreas = await request.patch(`/api/gestores-externos/${gestor.id}`, {
        headers: authHeaders(admin),
        data: { rif: `J-${Math.floor(10000000 + Math.random() * 89999999)}-2` },
      });
      expect(resConAreas.status()).toBe(422);

      await request.delete(`/api/gestores-externos/${gestor.id}/areas/${area.id}`, { headers: authHeaders(admin) });

      const nuevoRif = `  j-${Math.floor(10000000 + Math.random() * 89999999)}-3  `;
      const resSinAreas = await request.patch(`/api/gestores-externos/${gestor.id}`, {
        headers: authHeaders(admin),
        data: { rif: nuevoRif },
      });
      expect(resSinAreas.ok()).toBe(true);
      const actualizado = await resSinAreas.json();
      expect(actualizado.rif).toBe(nuevoRif.trim().toUpperCase());

      await eliminarGestorExterno(request, admin, gestor.id);
    });

    test('desactivar (soft delete) con áreas asignadas conserva la asignación', async ({ request }) => {
      const gestor = await crearGestorExterno(request, admin);
      await asignarAreaGestorExterno(request, admin, gestor.id, area.id);

      const resPatch = await request.patch(`/api/gestores-externos/${gestor.id}`, {
        headers: authHeaders(admin),
        data: { activo: false },
      });
      expect(resPatch.ok()).toBe(true);
      const desactivado = await resPatch.json();
      expect(desactivado.activo).toBe(false);
      expect(desactivado.areas.map((a) => a.id)).toContain(area.id);

      await request.delete(`/api/gestores-externos/${gestor.id}/areas/${area.id}`, { headers: authHeaders(admin) });
      await eliminarGestorExterno(request, admin, gestor.id);
    });

    test('DELETE con áreas asignadas -> 409; sin áreas -> 204', async ({ request }) => {
      const gestor = await crearGestorExterno(request, admin);
      await asignarAreaGestorExterno(request, admin, gestor.id, area.id);

      const resBloqueado = await request.delete(`/api/gestores-externos/${gestor.id}`, { headers: authHeaders(admin) });
      expect(resBloqueado.status()).toBe(409);
      const bodyBloqueado = await resBloqueado.json();
      expect(bodyBloqueado.detail).toContain('desactive el gestor');

      await request.delete(`/api/gestores-externos/${gestor.id}/areas/${area.id}`, { headers: authHeaders(admin) });

      const resHard = await request.delete(`/api/gestores-externos/${gestor.id}`, { headers: authHeaders(admin) });
      expect(resHard.status()).toBe(204);

      const resGet = await request.get(`/api/gestores-externos/${gestor.id}`, { headers: authHeaders(admin) });
      expect(resGet.status()).toBe(404);
    });

    test('usuario_id inexistente -> 404 al crear', async ({ request }) => {
      const res = await request.post('/api/gestores-externos/', {
        headers: authHeaders(admin),
        data: {
          nombre: testTag('GestorUsuarioFalso'),
          rif: `J-${Math.floor(10000000 + Math.random() * 89999999)}-4`,
          telefono: '04120000000',
          metodo_pago: 'OTRO',
          usuario_id: 999999,
        },
      });
      expect(res.status()).toBe(404);
    });

    test('no-admin no puede listar ni crear gestores externos', async ({ request }) => {
      // Un usuario común (role default 'user') no tiene ninguno de los roles
      // que exige require_roles("admin").
      const tag = testTag('userGE');
      const nuevo = await request.post('/api/usuarios/', {
        headers: authHeaders(admin),
        data: { username: tag, email: `${tag}@example.com`, password: 'Password123!', role: 'user' },
      });
      const usuario = await nuevo.json();
      const loginRes = await request.post('/token', { form: { username: tag, password: 'Password123!' } });
      const { access_token: token } = await loginRes.json();

      const resListar = await request.get('/api/gestores-externos/', { headers: authHeaders(token) });
      expect(resListar.status()).toBe(403);

      const resCrear = await request.post('/api/gestores-externos/', {
        headers: authHeaders(token),
        data: {
          nombre: testTag('GestorNoAdmin'),
          rif: `J-${Math.floor(10000000 + Math.random() * 89999999)}-6`,
          telefono: '04125551234',
          metodo_pago: 'EFECTIVO',
        },
      });
      expect(resCrear.status()).toBe(403);

      await request.delete(`/api/usuarios/${usuario.id}`, { headers: authHeaders(admin) });
    });

    test('PATCH con nombre null -> 422 (columna NOT NULL)', async ({ request }) => {
      const gestor = await crearGestorExterno(request, admin);

      const res = await request.patch(`/api/gestores-externos/${gestor.id}`, {
        headers: authHeaders(admin),
        data: { nombre: null },
      });
      expect(res.status()).toBe(422);

      await eliminarGestorExterno(request, admin, gestor.id);
    });

    test('RIF en blanco (solo espacios) -> 422 al crear', async ({ request }) => {
      const res = await request.post('/api/gestores-externos/', {
        headers: authHeaders(admin),
        data: {
          nombre: testTag('GestorRifBlanco'),
          rif: '   ',
          telefono: '04120001111',
          metodo_pago: 'EFECTIVO',
        },
      });
      expect(res.status()).toBe(422);
    });
  });

  test.describe('Integración con notificaciones', () => {
    let admin;
    let area;
    let catalogo;
    let propietario;
    let mascota;
    let gestorExterno;

    test.beforeAll(async ({ request }) => {
      admin = await getAdminToken(request);
      area = await createTestArea(request, admin, { nombre: testTag('AreaNotifExt') });
      catalogo = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO', area_id: area.id });
      gestorExterno = await crearGestorExterno(request, admin, { nombre: testTag('GestorNotifExt') });
      await asignarAreaGestorExterno(request, admin, gestorExterno.id, area.id);
      propietario = await createTestPropietario(request, {}, admin);
      mascota = await createTestMascota(request, propietario.id, {}, admin);
    });

    test.afterAll(async ({ request }) => {
      // Cada paso se guarda contra su propio fixture: si el `beforeAll` falló
      // a mitad de camino, alguna de estas variables queda `undefined` y no
      // debe abortar el resto de la limpieza (mismo criterio que el `finally`
      // de la suite UI en este archivo, con `if (gestorId) { ... }`).
      if (gestorExterno && area) {
        await request.delete(`/api/gestores-externos/${gestorExterno.id}/areas/${area.id}`, { headers: authHeaders(admin) }).catch(() => {});
      }
      if (gestorExterno) {
        // `gestorExterno` recibió una notificación real en el primer test de este
        // describe: la FK `notificaciones.gestor_externo_id` es ON DELETE RESTRICT
        // (spec, "Integridad del destinatario"), así que un hard delete directo
        // devolvería 409 "historial de notificaciones" y no borraría nada. RESTRICT
        // protege el historial en producción, pero un fixture de test no debe
        // acumular gestores no borrables en cada corrida: se borra su notificación
        // en BD (scoped por su ID) y recién ahí se hace hard delete real.
        limpiarNotificacionesDeGestorExterno(gestorExterno.id);
        await request.delete(`/api/gestores-externos/${gestorExterno.id}`, { headers: authHeaders(admin) }).catch(() => {});
      }
      if (catalogo) {
        await deleteTestCatalogoServicio(request, catalogo.id, admin);
      }
      if (area) {
        await desactivarTestArea(request, admin, area.id);
      }
      if (mascota) {
        await deleteTestMascota(request, mascota.id, admin);
      }
      if (propietario) {
        await deleteTestPropietario(request, propietario.id, admin);
      }
    });

    test('confirmar orden con área que tiene gestor externo asignado crea SERVICIO_ASIGNADO_EXTERNO en BD', async ({ request }) => {
      const orden = await createTestOrden(request, { propietarioId: propietario.id, mascotaId: mascota.id }, admin);
      const servicio = await anexarServicioOrden(
        request, orden.id,
        { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: catalogo.id, nombre_servicio: testTag('svcNotifExt') },
        admin,
      );
      await confirmarServiciosOrden(request, orden.id, admin);

      const filas = queryDb(
        `SELECT gestor_externo_id, tipo, destinatario_id, canal FROM notificaciones ` +
        `WHERE servicio_id = ${servicio.id} AND gestor_externo_id IS NOT NULL`
      );
      expect(filas.length).toBe(1);
      const [gestorExternoId, tipo, destinatarioId, canal] = filas[0];
      expect(Number(gestorExternoId)).toBe(gestorExterno.id);
      expect(tipo).toBe('SERVICIO_ASIGNADO_EXTERNO');
      expect(destinatarioId).toBe(''); // NULL en psql -tA se imprime vacío
      expect(canal).toBe('APP');
    });

    test('asignación directa a un gestor interno NO notifica externos', async ({ request }) => {
      const vet = await request.post('/api/usuarios/', {
        headers: authHeaders(admin),
        data: { username: testTag('vetDirNotif'), email: `${testTag('vd')}@example.com`, password: 'Password123!', role: 'veterinario' },
      }).then((r) => r.json());
      const gestorInterno = await request.post('/api/usuarios/', {
        headers: authHeaders(admin),
        data: { username: testTag('gestorDirNotif'), email: `${testTag('gd')}@example.com`, password: 'Password123!', role: 'gestor' },
      }).then((r) => r.json());
      await request.post(`/api/areas/${area.id}/gestores`, {
        headers: authHeaders(admin),
        data: { usuario_id: gestorInterno.id },
      });

      const orden = await createTestOrden(request, { propietarioId: propietario.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
      const servicio = await anexarServicioOrden(
        request, orden.id,
        { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: catalogo.id, nombre_servicio: testTag('svcDirNotif') },
        admin,
      );
      await confirmarServiciosOrden(request, orden.id, admin, [{ servicio_id: servicio.id, gestor_id: gestorInterno.id }]);

      const filas = queryDb(
        `SELECT id FROM notificaciones WHERE servicio_id = ${servicio.id} AND gestor_externo_id IS NOT NULL`
      );
      expect(filas.length).toBe(0);

      await request.delete(`/api/areas/${area.id}/gestores/${gestorInterno.id}`, { headers: authHeaders(admin) });
      await request.delete(`/api/usuarios/${gestorInterno.id}`, { headers: authHeaders(admin) });
      await request.delete(`/api/usuarios/${vet.id}`, { headers: authHeaders(admin) });
    });

    test('gestor sin áreas pero con historial de notificaciones -> DELETE 409, la notificación persiste (tarea 7.2)', async ({ request, page }) => {
      const gestorConHistorial = await crearGestorExterno(request, admin, { nombre: testTag('GestorHistNotif') });
      try {
        await asignarAreaGestorExterno(request, admin, gestorConHistorial.id, area.id);

        const orden = await createTestOrden(request, { propietarioId: propietario.id, mascotaId: mascota.id }, admin);
        const servicio = await anexarServicioOrden(
          request, orden.id,
          { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: catalogo.id, nombre_servicio: testTag('svcHistNotif') },
          admin,
        );
        await confirmarServiciosOrden(request, orden.id, admin);

        const filasAntes = queryDb(
          `SELECT id FROM notificaciones WHERE servicio_id = ${servicio.id} AND gestor_externo_id = ${gestorConHistorial.id}`
        );
        expect(filasAntes.length).toBe(1);

        // Sin áreas asignadas -- el único bloqueo restante para el hard delete
        // es el historial de notificaciones.
        const resDesasignar = await request.delete(`/api/gestores-externos/${gestorConHistorial.id}/areas/${area.id}`, {
          headers: authHeaders(admin),
        });
        expect(resDesasignar.status()).toBe(204);

        const resDelete = await request.delete(`/api/gestores-externos/${gestorConHistorial.id}`, { headers: authHeaders(admin) });
        expect(resDelete.status()).toBe(409);
        const bodyDelete = await resDelete.json();
        expect(bodyDelete.detail).toContain('historial de notificaciones');

        // El registro y la notificación no cambiaron.
        const filasLuego = queryDb(
          `SELECT id FROM notificaciones WHERE servicio_id = ${servicio.id} AND gestor_externo_id = ${gestorConHistorial.id}`
        );
        expect(filasLuego.length).toBe(1);
        expect(filasLuego[0][0]).toBe(filasAntes[0][0]);

        const resGet = await request.get(`/api/gestores-externos/${gestorConHistorial.id}`, { headers: authHeaders(admin) });
        expect(resGet.status()).toBe(200);

        // Frontend: el mismo 409 se ve como toast de error al intentar borrar
        // desde la pantalla (confirmarEliminarGestorExterno muestra `err.message`,
        // que fetchAPI arma con el `detail` del backend).
        await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
        await gotoSection(page, 'sec-areas');
        await page.click('#arTabBtnExternos');
        await expect(page.locator('#tab-gestores-externos')).toBeVisible();
        const fila = page.locator('#gestoresExternosBody tr', { hasText: gestorConHistorial.rif });
        await expect(fila).toBeVisible({ timeout: 15000 });
        page.on('dialog', (d) => d.accept());
        await fila.locator('[data-ge-eliminar]').click();
        await expect(
          page.locator('.notification-toast', { hasText: /historial de notificaciones/ }).first()
        ).toBeVisible({ timeout: 10000 });
      } finally {
        // Limpieza (corre incluso si una assertion de arriba falla): la FK
        // ON DELETE RESTRICT bloquea el hard delete mientras la notificación
        // exista, y RESTRICT existe justamente para proteger ese historial en
        // producción -- pero este gestor es un fixture de test, no debe
        // acumularse en cada corrida del suite. Se desasigna el área (por si
        // la assertion falló antes de llegar a ese paso), se borra su
        // notificación en BD (scoped por su ID) y recién ahí se hace hard
        // delete real.
        await request.delete(`/api/gestores-externos/${gestorConHistorial.id}/areas/${area.id}`, {
          headers: authHeaders(admin),
        }).catch(() => {});
        limpiarNotificacionesDeGestorExterno(gestorConHistorial.id);
        await request.delete(`/api/gestores-externos/${gestorConHistorial.id}`, { headers: authHeaders(admin) }).catch(() => {});
      }
    });
  });

  test.describe('UI', () => {
    test('admin crea, edita, asigna área y desactiva un gestor externo desde la pantalla', async ({ page, request }) => {
      const admin = await getAdminToken(request);
      const area = await createTestArea(request, admin, { nombre: testTag('AreaUiGestorExt') });
      const nombre = testTag('GestorExtUI');
      const rif = `J-${Math.floor(10000000 + Math.random() * 89999999)}-5`;
      let gestorId = null;

      try {
        await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
        await gotoSection(page, 'sec-areas');
        await page.click('#arTabBtnExternos');
        await expect(page.locator('#tab-gestores-externos')).toBeVisible();

        // Alta.
        await page.click('#btnGestorExternoNuevo');
        await expect(page.locator('#modalGestorExterno')).toBeVisible();
        await page.fill('#geNombre', nombre);
        await page.fill('#geRif', rif);
        await page.fill('#geTelefono', '04121112233');
        await page.selectOption('#geMetodoPago', 'ZELLE');
        await page.fill('#geZelle', 'proveedor@example.com');
        await page.click('#formGestorExterno button[type="submit"]');
        await expect(page.locator('#modalGestorExterno')).not.toBeVisible();

        const fila = page.locator('#gestoresExternosBody tr', { hasText: rif.toUpperCase() });
        await expect(fila).toBeVisible({ timeout: 15000 });
        await expect(fila).toContainText(nombre);

        const gestores = await (await request.get('/api/gestores-externos/?limit=500', { headers: authHeaders(admin) })).json();
        const gestor = gestores.find((g) => g.rif === rif.toUpperCase());
        expect(gestor).toBeTruthy();
        gestorId = gestor.id;

        // Edición.
        await fila.locator('[data-ge-editar]').click();
        await expect(page.locator('#modalGestorExterno')).toBeVisible();
        await expect(page.locator('#geNombre')).toHaveValue(nombre);
        const nombreEditado = `${nombre}_ed`;
        await page.fill('#geNombre', nombreEditado);
        await page.click('#formGestorExterno button[type="submit"]');
        await expect(page.locator('#gestoresExternosBody tr', { hasText: nombreEditado })).toBeVisible({ timeout: 15000 });

        // Asignar área vía el modal de checklist.
        const filaEditada = page.locator('#gestoresExternosBody tr', { hasText: nombreEditado });
        await filaEditada.locator('[data-ge-areas]').click();
        await expect(page.locator('#modalGestorExternoAreas')).toBeVisible();
        await page.locator(`#geAreasChecklist [data-ge-area-id="${area.id}"]`).check();
        await expect.poll(async () => {
          const detalle = await (await request.get(`/api/gestores-externos/${gestorId}`, { headers: authHeaders(admin) })).json();
          return detalle.areas.map((a) => a.id);
        }, { timeout: 15000 }).toContain(area.id);
        await page.click('#modalGestorExternoAreas [data-close="modalGestorExternoAreas"]');
        await expect(page.locator('#modalGestorExternoAreas')).not.toBeVisible();

        await expect(filaEditada).toContainText(area.nombre);

        // Desactivar (RIF ahora inmutable porque tiene un área asignada).
        await filaEditada.locator('[data-ge-editar]').click();
        await expect(page.locator('#geRif')).toBeDisabled();
        await page.click('#formGestorExterno [data-close="modalGestorExterno"]');

        await filaEditada.locator('[data-ge-toggle-activo]').click();
        await expect(page.locator('#gestoresExternosBody tr', { hasText: nombreEditado })).toContainText('Inactivo', { timeout: 15000 });
      } finally {
        if (gestorId) {
          await request.delete(`/api/gestores-externos/${gestorId}/areas/${area.id}`, { headers: authHeaders(admin) }).catch(() => {});
          await eliminarGestorExterno(request, admin, gestorId);
        }
        await desactivarTestArea(request, admin, area.id);
      }
    });
  });
});
