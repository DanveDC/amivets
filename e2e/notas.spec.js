// Unidad B (tarea 05) — Notas clínicas (backend/app/routers/notas.py)
//
// Endpoints: POST / · GET /mascota/{mascota_id} · PUT /{id} · DELETE /{id}
// Todos exigen sesión activa (get_current_user); el token de admin sirve.
//
// UI: las notas viven en las pestañas clínicas del paciente
// (switchPetTab('notas') -> cargarNotasPet -> buildNotaForm/submitNota, más
// editarNota/borrarNota). Se alcanzan como admin desde el buscador lateral
// (#sidebarSearch), así que el alta se hace por UI y se contrasta con la API;
// la edición, el listado cronológico y el borrado lógico se ejercen por API.
//
// Dictado por voz (dictadoBotonHTML / iniciarDictado): la Web Speech API no
// está disponible de forma fiable en Chromium headless, así que se inyecta un
// stub MÍNIMO de `window.SpeechRecognition` (un objeto del navegador, NO la
// red — el criterio de mockeo del repo sólo prohíbe mockear la red salvo
// Supabase/QR). Con eso el botón se renderiza y se comprueba que está
// cableado (un click alterna aria-pressed vía el listener global). No se
// prueba reconocimiento real.

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
  createTestNota,
  deleteTestNota,
} = require('./helpers');

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

/**
 * Selects a patient in Consultorio via its search box (setupConsultorioSearch)
 * and waits for the patient tabs layout to open. The lateral #sidebarSearch is
 * CSS-hidden unless the sidebar is hovered, so the in-section search is the
 * stable path.
 */
async function seleccionarPacientePorUI(page, mascota) {
  const nombreBase = mascota.nombre.split(' ')[0]; // el apellido va pegado en las respuestas
  await page.click('.menu-item[data-target="sec-consultorio"]');
  await page.fill('#consultorioSearchMascota', nombreBase);
  const item = page.locator('#consultorioMascotasList .pet-list-item', { hasText: nombreBase }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator('#patientWrapper')).toBeVisible();
}

// Stub de la Web Speech API para que dictadoBotonHTML() genere el botón y
// iniciarDictado()/detenerDictado() no exploten en headless.
// Se sobrescriben AMBOS nombres sin condición: Chromium headless expone
// webkitSpeechRecognition pero su .start() falla en background (network /
// not-allowed), así que dejarlo pasar haría el test no determinista. El stub
// corre en addInitScript, antes de que app.js capture SpeechRecognitionAPI.
const SPEECH_STUB = `
  (function () {
    function FakeRecognition() {}
    FakeRecognition.prototype.start = function () { if (this.onstart) this.onstart(); };
    FakeRecognition.prototype.stop = function () { if (this.onend) this.onend(); };
    FakeRecognition.prototype.abort = function () { if (this.onend) this.onend(); };
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
  })();
`;

test.describe.serial('Notas clínicas — /api/notas', () => {
  const S = { token: null, propietario: null, mascota: null, vet: null, consulta: null, notasApi: [] };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);
    S.vet = await createTestVeterinario(request, S.token);
    S.consulta = await createTestConsulta(request, { mascotaId: S.mascota.id, veterinarioId: S.vet.id });
  });

  test.afterAll(async ({ request }) => {
    for (const n of S.notasApi) if (n?.id) await deleteTestNota(request, S.token, n.id);
    if (S.consulta?.id) await deleteTestConsulta(request, S.consulta.id);
    if (S.vet?.id) await deleteTestUser(request, S.token, S.vet.id);
    if (S.mascota?.id) await deleteTestMascota(request, S.mascota.id);
    if (S.propietario?.id) await deleteTestPropietario(request, S.propietario.id);
  });

  test('alta por UI en la pestaña Notas + botón de dictado renderizado y cableado', async ({ page, request }) => {
    await page.addInitScript(SPEECH_STUB);
    const texto = testTag('notaUI');

    await loginAsAdmin(page);
    await seleccionarPacientePorUI(page, S.mascota);

    // Ir a la pestaña Notas y abrir el formulario.
    await page.click('.pet-nav-item[data-tab="notas"]');
    await expect(page.locator('#petTabContent')).toContainText('Todavía no hay notas');
    await page.click('button:has-text("+ Nueva Nota")');
    await expect(page.locator('#formNota')).toBeVisible();

    // Botón de dictado: presente, apuntando al textarea y en estado inicial.
    const dictado = page.locator('#formNota .btn-dictado[data-target="notaTextoInput"]');
    await expect(dictado).toBeVisible();
    await expect(dictado).toHaveAttribute('aria-pressed', 'false');
    // Está cableado: el listener global (iniciarDictado) lo pone en "listening".
    await dictado.click();
    await expect(dictado).toHaveAttribute('aria-pressed', 'true');
    await dictado.click(); // detener, para no dejar el stub "activo"
    await expect(dictado).toHaveAttribute('aria-pressed', 'false');

    // Cargar y guardar la nota.
    await page.selectOption('#formNota select[name="categoria"]', 'seguimiento');
    await page.fill('#notaTextoInput', texto);
    await page.click('#formNota button[type="submit"]');

    // submitNota() recarga la lista: la nota ya está en pantalla.
    await expect(page.locator('#notasList')).toContainText(texto);

    // Contraste API.
    const res = await request.get(`/api/notas/mascota/${S.mascota.id}`, { headers: authHeaders(S.token) });
    const notas = await res.json();
    const creada = notas.find((n) => n.texto === texto);
    expect(creada, 'la nota creada por UI debe aparecer en la API').toBeTruthy();
    expect(creada.categoria).toBe('seguimiento');
    expect(creada.autor).toBe('admin');
    expect(creada.is_deleted).toBe(false);
    S.notasApi.push(creada);
  });

  test('PUT /{id}: editar deja marca de edición; el listado es cronológico y excluye borradas', async ({ request }) => {
    // Dos notas más por API, en orden.
    const n1 = await createTestNota(request, S.token, { mascotaId: S.mascota.id, categoria: 'general', texto: testTag('nota1') });
    const n2 = await createTestNota(request, S.token, { mascotaId: S.mascota.id, categoria: 'incidencia', texto: testTag('nota2') });
    S.notasApi.push(n1, n2);

    // Editar n1.
    const nuevoTexto = testTag('nota1edit');
    const putRes = await request.put(`/api/notas/${n1.id}`, {
      headers: authHeaders(S.token),
      data: { texto: nuevoTexto, categoria: 'llamada' },
    });
    expect(putRes.ok(), await putRes.text()).toBeTruthy();
    const editada = await putRes.json();
    expect(editada.texto).toBe(nuevoTexto);
    expect(editada.categoria).toBe('llamada');
    expect(editada.fecha_edicion, 'editar sella fecha_edicion').toBeTruthy();
    expect(editada.editado_por_username).toBe('admin');

    // Listado: orden cronológico ascendente y sin borradas.
    const listRes = await request.get(`/api/notas/mascota/${S.mascota.id}`, { headers: authHeaders(S.token) });
    const notas = await listRes.json();
    const fechas = notas.map((n) => new Date(n.fecha_creacion).getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
    for (const n of notas) expect(n.is_deleted).toBe(false);
    expect(notas.find((n) => n.id === n1.id).texto).toBe(nuevoTexto);

    // Categoría inválida en PUT -> 422.
    const badCat = await request.put(`/api/notas/${n1.id}`, {
      headers: authHeaders(S.token),
      data: { categoria: 'no-existe' },
    });
    expect(badCat.status()).toBe(422);
  });

  test('DELETE /{id}: borrado lógico (204) + validaciones de alta', async ({ request }) => {
    const n = await createTestNota(request, S.token, { mascotaId: S.mascota.id, texto: testTag('notaDel') });

    const delRes = await request.delete(`/api/notas/${n.id}`, { headers: authHeaders(S.token) });
    expect(delRes.status()).toBe(204);

    // Ya no aparece en el listado del paciente.
    const listRes = await request.get(`/api/notas/mascota/${S.mascota.id}`, { headers: authHeaders(S.token) });
    const notas = await listRes.json();
    expect(notas.some((x) => x.id === n.id)).toBe(false);

    // Volver a borrarla -> 404 (ya está is_deleted).
    const again = await request.delete(`/api/notas/${n.id}`, { headers: authHeaders(S.token) });
    expect(again.status()).toBe(404);

    // Alta con categoría inválida -> 422.
    const badCat = await request.post('/api/notas/', {
      headers: authHeaders(S.token),
      data: { mascota_id: S.mascota.id, texto: 'x', categoria: 'urgente' },
    });
    expect(badCat.status()).toBe(422);

    // Alta contra una mascota inexistente -> 404.
    const noMascota = await request.post('/api/notas/', {
      headers: authHeaders(S.token),
      data: { mascota_id: 99999999, texto: 'x', categoria: 'general' },
    });
    expect(noMascota.status()).toBe(404);

    // Alta sin sesión -> 401.
    const anon = await request.post('/api/notas/', {
      data: { mascota_id: S.mascota.id, texto: 'x', categoria: 'general' },
    });
    expect(anon.status()).toBe(401);
  });

  test('POST /: el ancla consulta_id se valida contra la mascota', async ({ request }) => {
    // consulta_id válido (pertenece a la mascota).
    const ok = await request.post('/api/notas/', {
      headers: authHeaders(S.token),
      data: { mascota_id: S.mascota.id, texto: testTag('notaAnclada'), categoria: 'seguimiento', consulta_id: S.consulta.id },
    });
    expect(ok.status(), await ok.text()).toBe(201);
    const nota = await ok.json();
    expect(nota.consulta_id).toBe(S.consulta.id);
    S.notasApi.push(nota);

    // consulta_id de otra mascota -> 400.
    const otraMascota = await createTestMascota(request, S.propietario.id);
    const otraConsulta = await createTestConsulta(request, { mascotaId: otraMascota.id, veterinarioId: S.vet.id });
    const mismatch = await request.post('/api/notas/', {
      headers: authHeaders(S.token),
      data: { mascota_id: S.mascota.id, texto: 'x', categoria: 'general', consulta_id: otraConsulta.id },
    });
    expect(mismatch.status()).toBe(400);

    await deleteTestConsulta(request, otraConsulta.id);
    await deleteTestMascota(request, otraMascota.id);
  });
});
