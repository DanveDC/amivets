// Unidad A — Flujo público de agendamiento por QR (static/agendar.html)
//
// Strategy: this flow is split across two data sources —
//   - GET /api/admin/supabase/veterinarios reads the LOCAL Postgres `usuarios`
//     table (role = 'veterinario'). No Supabase involved.
//   - GET/POST horarios and citas-qr talk to a REAL Supabase project.
//     docker-compose.yml does not pass SUPABASE_URL/SUPABASE_SECRET_KEY into
//     the backend container in this environment, so those endpoints return
//     500 here (see docs/pruebas.md).
//
// To keep this suite (a) deterministic and (b) compliant with "never touch
// real Supabase", most scenarios mock the network response for horarios/
// citas-qr with page.route() and assert on the frontend logic Daniel
// actually changed. A couple of scenarios hit the real local backend on
// purpose, to prove/disprove the current state of this environment — those
// are the ones that surface real bugs.

const { test, expect } = require('@playwright/test');
const { isSupabaseAvailable, getAdminToken, createTestUser, deleteTestUser } = require('./helpers');

/** Mirrors the Mon=0..Sun=6 conversion done in agendar.html's renderSlots(). */
function dayIndexMondayFirst(dateStr) {
  const jsDow = new Date(`${dateStr}T00:00:00`).getDay(); // 0=Sun..6=Sat
  return jsDow === 0 ? 6 : jsDow - 1;
}

const FAKE_VETS = [
  { id: 101, nombre: 'Dra. Playwright Uno', activo: true, amivets_usuario_id: 101 },
  { id: 102, nombre: 'Dr. Playwright Dos', activo: true, amivets_usuario_id: 102 },
];

test.describe('Agendamiento QR — con red mockeada (independiente del backend real)', () => {
  test('cargar la página muestra "Cualquier veterinario disponible" cuando hay veterinarios', async ({ page }) => {
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: FAKE_VETS })
    );

    await page.goto('/agendar');

    const select = page.locator('#selectVet');
    await expect(select.locator('option[value="0"]')).toHaveText('Cualquier veterinario disponible');
    await expect(select.locator('option[value="101"]')).toHaveText('Dra. Playwright Uno');
  });

  test('elegir un veterinario carga sus horarios y arma los turnos del día', async ({ page }) => {
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: FAKE_VETS })
    );
    await page.goto('/agendar');

    const fecha = await page.locator('#selectFecha').inputValue();
    const dayIndex = dayIndexMondayFirst(fecha);

    await page.route('**/api/admin/supabase/horarios*', (route) =>
      route.fulfill({
        json: [
          {
            id: 1,
            veterinario_id: 101,
            dia_semana: dayIndex,
            hora_inicio: '09:00',
            hora_fin: '10:00',
            duracion_consulta_minutos: 30,
            activo: true,
          },
        ],
      })
    );

    await page.selectOption('#selectVet', '101');
    await expect(page.locator('#slotsGroup')).toBeVisible();
    await expect(page.locator('.slot-btn')).toHaveText(['09:00', '09:30']);
  });

  test('elegir "cualquier veterinario" también carga horarios (commit 442c73d)', async ({ page }) => {
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: FAKE_VETS })
    );
    await page.goto('/agendar');
    const fecha = await page.locator('#selectFecha').inputValue();
    const dayIndex = dayIndexMondayFirst(fecha);

    let requestedUrl = '';
    await page.route('**/api/admin/supabase/horarios*', (route) => {
      requestedUrl = route.request().url();
      return route.fulfill({
        json: [
          { id: 2, veterinario_id: null, dia_semana: dayIndex, hora_inicio: '14:00', hora_fin: '15:00', duracion_consulta_minutos: 60, activo: true },
        ],
      });
    });

    await page.selectOption('#selectVet', '0');
    await expect(page.locator('#slotsGroup')).toBeVisible();
    await expect(page.locator('.slot-btn')).toHaveText(['14:00']);
    // "any vet" must hit the plain /horarios endpoint, without a vet filter.
    expect(requestedUrl).not.toContain('amivets_usuario_id');
  });

  test('enviar el formulario crea la cita y muestra confirmación visible', async ({ page }) => {
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: FAKE_VETS })
    );
    await page.goto('/agendar');
    const fecha = await page.locator('#selectFecha').inputValue();
    const dayIndex = dayIndexMondayFirst(fecha);
    await page.route('**/api/admin/supabase/horarios*', (route) =>
      route.fulfill({
        json: [{ id: 3, veterinario_id: 101, dia_semana: dayIndex, hora_inicio: '09:00', hora_fin: '10:00', duracion_consulta_minutos: 30, activo: true }],
      })
    );
    await page.route('**/api/admin/supabase/citas-qr', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 201,
        json: { id: 'fake-cita-id', estado: 'pendiente' },
      });
    });

    await page.selectOption('#selectVet', '101');
    await page.click('.slot-btn:has-text("09:00")');
    await page.fill('#nombreCliente', 'Cliente Playwright');
    await page.fill('#telefono', '099123456');
    await page.fill('#nombreMascota', 'Firulais');
    await page.click('#btnSubmit');

    await expect(page.locator('#successView')).toBeVisible();
    await expect(page.locator('#formView')).toBeHidden();
    await expect(page.locator('#successDetail')).toContainText('fue registrado con éxito');
    await expect(page.locator('#successDetail')).toContainText('Dra. Playwright Uno');
  });

  test('enviar con campos incompletos muestra un error entendible, no un 500', async ({ page }) => {
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: FAKE_VETS })
    );
    await page.goto('/agendar');

    // Click submit with the form completely empty — pure client-side validation,
    // no network call should even happen.
    let apiCalled = false;
    await page.route('**/api/admin/supabase/citas-qr', (route) => {
      apiCalled = true;
      return route.fulfill({ status: 500, json: { detail: 'no debería llegar acá' } });
    });

    await page.click('#btnSubmit');

    const alert = page.locator('#alertBox');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/seleccioná un veterinario/i);
    expect(apiCalled).toBe(false);
    await expect(page.locator('#successView')).toBeHidden();
  });

  test('si el backend de horarios falla, se ve un error con opción de reintentar (antes quedaba oculto)', async ({ page }) => {
    // Regresión de la tarea 02, unidad B2: cargarHorarios() ahora chequea
    // response.ok en vez de tragarse el fallo. Antes, un 500 con cuerpo JSON
    // parseaba bien, Array.isArray(horarios) daba false, horariosVet quedaba
    // en [] y la interfaz se comportaba como si el veterinario no tuviera
    // horarios cargados — indistinguible de "agenda llena".
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: FAKE_VETS })
    );
    await page.goto('/agendar');

    let horariosRequests = 0;
    await page.route('**/api/admin/supabase/horarios*', (route) => {
      horariosRequests++;
      if (horariosRequests === 1) {
        return route.fulfill({ status: 500, json: { detail: 'Error Supabase en horarios: boom' } });
      }
      // El reintento sí funciona.
      return route.fulfill({ json: [] });
    });

    await page.selectOption('#selectVet', '101');

    await expect(page.locator('#slotsGroup')).toBeHidden();
    const alert = page.locator('#alertBox');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/no se pudieron cargar los horarios/i);

    // El botón de reintentar dispara un nuevo fetch.
    await page.click('.alert-retry-btn');
    expect(horariosRequests).toBe(2);
  });

  test('sin veterinarios disponibles, la página lo dice en vez de quedarse en blanco', async ({ page }) => {
    // Regresión de la tarea 02, unidad B1: el desplegable no debe quedarse
    // vacío/en blanco cuando no hay veterinarios — debe mostrar un mensaje
    // explícito. (La UI ya lo hacía; esta prueba lo deja cubierto en vez de
    // depender de que la base de datos de prueba esté vacía por accidente.)
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: [] })
    );
    await page.goto('/agendar');

    const select = page.locator('#selectVet');
    await expect(select.locator('option')).toHaveCount(1);
    await expect(select.locator('option')).toHaveText('Sin veterinarios disponibles');
    await expect(page.locator('#alertBox')).toBeVisible();
    await expect(page.locator('#alertBox')).toContainText(/no hay veterinarios disponibles/i);
  });

  test('si el backend de veterinarios falla, se ve un error con opción de reintentar', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/admin/supabase/veterinarios', (route) => {
      requests++;
      if (requests === 1) return route.fulfill({ status: 500, json: { detail: 'boom' } });
      return route.fulfill({ json: FAKE_VETS });
    });
    await page.goto('/agendar');

    const alert = page.locator('#alertBox');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/no se pudo cargar la lista de veterinarios/i);

    await page.click('.alert-retry-btn');
    await expect(page.locator('#selectVet option[value="101"]')).toHaveText('Dra. Playwright Uno');
    expect(requests).toBe(2);
  });
});

test.describe('Agendamiento QR — contra el backend real (revela bugs de entorno/datos)', () => {
  // listar_veterinarios() (backend/app/routers/supabase_admin.py) filtra
  // Usuario.role == "veterinario". Ningún seed de este entorno crea ese rol
  // (backend/scripts/seed_data.py hardcodea role="user" para los dr_*), así
  // que sin este setup la lista real siempre viene vacía — no es un problema
  // de la UI, es falta de dato. Confirmado además que un deploy nuevo en
  // producción arranca en el mismo estado: nada en el pipeline de seed crea
  // un usuario role='veterinario'. Sembramos uno acá para que la suite cubra
  // el camino real con datos reales, y lo limpiamos al terminar.
  let adminToken;
  let testVet;

  test.beforeAll(async ({ request }) => {
    adminToken = await getAdminToken(request);
    testVet = await createTestUser(request, adminToken, { role: 'veterinario' });
  });

  test.afterAll(async ({ request }) => {
    if (testVet) await deleteTestUser(request, adminToken, testVet.id);
  });

  test('cargar la página lista veterinarios reales desde el backend', async ({ page }) => {
    await page.goto('/agendar');

    const select = page.locator('#selectVet');
    const optionCount = await select.locator('option').count();
    // "Seleccioná un veterinario...", "Cualquier veterinario disponible", + el sembrado.
    expect(optionCount, 'esperaba al menos un veterinario real listado').toBeGreaterThan(1);
    await expect(select.locator(`option[value="${testVet.id}"]`)).toHaveText(testVet.username);
  });

  test('citas-qr / horarios reales — se salta si Supabase no está configurado en este entorno', async ({ request, page }) => {
    test.skip(
      !(await isSupabaseAvailable(request)),
      'SUPABASE_URL/SUPABASE_SECRET_KEY no están declaradas en docker-compose.yml para el servicio backend ' +
      '(GET /api/admin/supabase/health devuelve 500 "Supabase no configurado"). Ver docs/pruebas.md.'
    );

    // If this ever runs (Supabase wired up), do a real, cleaned-up smoke check.
    const res = await request.get('/api/admin/supabase/horarios');
    expect(res.ok()).toBe(true);
  });
});
