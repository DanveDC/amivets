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
const { isSupabaseAvailable } = require('./helpers');

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

  test('BUG: si el backend de horarios falla, el error queda oculto (sin chequeo de response.ok)', async ({ page }) => {
    // static/agendar.html:cargarHorarios() does:
    //   const horarios = await fetch(url).then(r => r.json());
    // It never checks `r.ok`, so a 500 with a JSON body parses fine and
    // `Array.isArray(horarios)` is false → horariosVet = [] silently.
    // The user sees "sin horarios disponibles" instead of a real error.
    // This test documents the CURRENT (buggy) behavior; it will need to be
    // updated once cargarHorarios() checks response.ok and calls showAlert().
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: FAKE_VETS })
    );
    await page.goto('/agendar');
    await page.route('**/api/admin/supabase/horarios*', (route) =>
      route.fulfill({ status: 500, json: { detail: 'Error Supabase en horarios: boom' } })
    );

    await page.selectOption('#selectVet', '101');

    // What actually happens today: cargarHorarios() never checks response.ok,
    // so `horariosVet` silently becomes [] and renderSlots() just hides the
    // slots section — no feedback of any kind is shown to the user.
    await expect(page.locator('#slotsGroup')).toBeHidden();
    // Ideally a failed fetch should surface a visible error instead of silence.
    await expect(page.locator('#alertBox')).toBeVisible();
  });
});

test.describe('Agendamiento QR — contra el backend real (revela bugs de entorno/datos)', () => {
  test('BUG: cargar la página debería listar veterinarios reales, pero la lista viene vacía', async ({ page, request }) => {
    // Root cause (confirmed against the local DB): backend/app/routers/supabase_admin.py
    // listar_veterinarios() filters Usuario.role == "veterinario", but
    // backend/scripts/seed_data.py creates every dr_* user with role="user".
    // No row in `usuarios` currently has role='veterinario', so this is 100%
    // reproducible in this environment, independent of Supabase.
    await page.goto('/agendar');

    // Fails today: the dropdown only ever gets the "Sin veterinarios
    // disponibles" placeholder option (see listar_veterinarios() /
    // seed_data.py mismatch documented above).
    const select = page.locator('#selectVet');
    const optionCount = await select.locator('option').count();
    expect(optionCount, 'esperaba al menos un veterinario real listado').toBeGreaterThan(1);
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
