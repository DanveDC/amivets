// Unidad A — Panel de administración (static/js/app.js)
//
// "Editar usuario" (commit 40a0955) exercises the real local Postgres
// backend end to end. Citas QR + horarios are mocked at the network layer
// (page.route) for the same reason as qr-booking.spec.js: Supabase isn't
// configured in this docker-compose stack, so hitting the real endpoints
// would only prove infra, not code. Mocking lets us verify the frontend
// logic Daniel actually touched, deterministically, without ever calling
// a real Supabase project.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  createTestUser,
  deleteTestUser,
} = require('./helpers');

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Panel de administración — Usuarios', () => {
  let token;
  let testUser;

  test.beforeEach(async ({ request }) => {
    token = await getAdminToken(request);
    testUser = await createTestUser(request, token);
  });

  test.afterEach(async ({ request }) => {
    if (testUser?.id) await deleteTestUser(request, token, testUser.id);
  });

  test('editar usuario: cambiar nombre, correo y rol (commit 40a0955)', async ({ page, request }) => {
    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-usuarios"]');
    await expect(page.locator('#usuariosTableBody')).toContainText(testUser.username);

    const row = page.locator('#usuariosTableBody tr', { hasText: testUser.username });
    await row.getByRole('button', { name: 'Editar' }).click();

    await expect(page.locator('#modalEditarUsuario')).toBeVisible();
    const newUsername = `${testUser.username}_edit`;
    const newEmail = `edit_${testUser.email}`;

    await page.fill('#editUsername', newUsername);
    await page.fill('#editEmail', newEmail);
    await page.selectOption('#editRole', 'veterinario');
    await page.click('#formEditarUsuario button[type="submit"]');

    await expect(page.locator('#modalEditarUsuario')).toBeHidden();
    await expect(page.locator('#usuariosTableBody')).toContainText(newUsername);

    // Confirm against the API too — the UI could show stale/optimistic data.
    const res = await request.get('/api/usuarios/', { headers: authHeaders(token) });
    const usuarios = await res.json();
    const updated = usuarios.find((u) => u.id === testUser.id);
    expect(updated.username).toBe(newUsername);
    expect(updated.email).toBe(newEmail);
    expect(updated.role).toBe('veterinario');

    // Keep the id known so afterEach cleans up the RENAMED user correctly.
    testUser = updated;
  });
});

test.describe('Panel de administración — Citas QR (red mockeada)', () => {
  test('listar y filtrar citas QR por estado', async ({ page }) => {
    await loginAsAdmin(page);

    const citasPendientes = [
      {
        id: 'c1', estado: 'pendiente', fecha_cita: '2026-09-01', hora_cita: '09:00:00',
        nombre_cliente: 'Cliente Uno', telefono: '099111111', nombre_mascota: 'Rex',
        tipo_mascota: 'Perro', created_at: '2026-08-01T10:00:00Z', veterinarios: { nombre: 'Dra. Test' },
      },
    ];
    const citasCanceladas = [
      {
        id: 'c2', estado: 'cancelada', fecha_cita: '2026-09-02', hora_cita: '10:00:00',
        nombre_cliente: 'Cliente Dos', telefono: '099222222', nombre_mascota: 'Michi',
        tipo_mascota: 'Gato', created_at: '2026-08-02T10:00:00Z', veterinarios: { nombre: 'Dra. Test' },
      },
    ];

    let lastUrl = '';
    await page.route('**/api/admin/supabase/citas-qr*', (route) => {
      lastUrl = route.request().url();
      const estado = new URL(lastUrl).searchParams.get('estado');
      return route.fulfill({ json: estado === 'cancelada' ? citasCanceladas : citasPendientes });
    });

    await page.click('.menu-item[data-target="sec-citas-web"]');
    await expect(page.locator('#citasQRBody')).toContainText('Cliente Uno');
    await expect(page.locator('#citasQRBody')).toContainText('pendiente');

    await page.selectOption('#filtroCitasQR', 'cancelada');
    await expect(page.locator('#citasQRBody')).toContainText('Cliente Dos');
    expect(lastUrl).toContain('estado=cancelada');
  });

  test('cancelar una cita QR', async ({ page }) => {
    await loginAsAdmin(page);

    const cita = {
      id: 'c3', estado: 'pendiente', fecha_cita: '2026-09-01', hora_cita: '09:00:00',
      nombre_cliente: 'Cliente Cancelable', telefono: '099333333', nombre_mascota: 'Toby',
      tipo_mascota: 'Perro', created_at: '2026-08-01T10:00:00Z', veterinarios: { nombre: 'Dra. Test' },
    };
    let deleteRequested = false;
    await page.route('**/api/admin/supabase/citas-qr*', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [cita] });
      return route.fallback();
    });
    await page.route('**/api/admin/supabase/citas-qr/c3', (route) => {
      if (route.request().method() === 'DELETE') {
        deleteRequested = true;
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    });

    await page.click('.menu-item[data-target="sec-citas-web"]');
    await expect(page.locator('#citasQRBody')).toContainText('Cliente Cancelable');

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#citasQRBody button:has-text("Cancelar")');

    await expect.poll(() => deleteRequested).toBe(true);
  });
});

test.describe('Panel de administración — Horarios de veterinario (red mockeada)', () => {
  test('crear un bloque de horario', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: [{ id: 201, nombre: 'Dra. Horario Test', activo: true }] })
    );
    let createdPayload = null;
    await page.route('**/api/admin/supabase/horarios', (route) => {
      if (route.request().method() === 'POST') {
        createdPayload = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: { id: 99, ...createdPayload } });
      }
      return route.fallback();
    });
    await page.route('**/api/admin/supabase/horarios*', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [] });
      return route.fallback();
    });

    await page.click('.menu-item[data-target="sec-citas-web"]');
    await page.click('.qr-tab-btn[data-tab="tab-horarios"]');
    await page.selectOption('#selectVetHorario', '201');
    await page.click('button:has-text("+ Agregar Bloque")');

    await expect(page.locator('#modalNuevoHorario')).toBeVisible();
    await page.selectOption('#horarioDia', '0'); // Lunes
    await page.fill('#horarioInicio', '09:00');
    await page.fill('#horarioFin', '12:00');
    await page.selectOption('#horarioDuracion', { index: 0 });
    await page.click('#formNuevoHorario button[type="submit"]');

    await expect.poll(() => createdPayload).not.toBeNull();
    expect(createdPayload.amivets_usuario_id).toBe(201);
    expect(createdPayload.dia_semana).toBe(0);
  });

  test('eliminar un bloque de horario', async ({ page }) => {
    await loginAsAdmin(page);
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: [{ id: 202, nombre: 'Dra. Horario Test 2', activo: true }] })
    );
    await page.route('**/api/admin/supabase/horarios*', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          json: [{ id: 55, veterinario_id: 202, dia_semana: 0, hora_inicio: '09:00:00', hora_fin: '10:00:00', duracion_consulta_minutos: 30, activo: true }],
        });
      }
      return route.fallback();
    });
    let deleteRequested = false;
    await page.route('**/api/admin/supabase/horarios/55', (route) => {
      if (route.request().method() === 'DELETE') {
        deleteRequested = true;
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    });

    await page.click('.menu-item[data-target="sec-citas-web"]');
    await page.click('.qr-tab-btn[data-tab="tab-horarios"]');
    await page.selectOption('#selectVetHorario', '202');
    // NOTE: selecting a vet does not auto-load its schedule — the grid only
    // refreshes via the explicit "Ver Horarios" button (see GAP test below
    // for the related missing edit affordance).
    await page.click('button:has-text("Ver Horarios")');

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#horariosGrid button:has-text("Eliminar")');

    await expect.poll(() => deleteRequested).toBe(true);
  });

  test('GAP: no existe forma de editar un bloque de horario ya creado', async ({ page }) => {
    // static/js/app.js:cargarHorariosVet() only renders a "✕ Eliminar" button
    // per block; guardarHorario() supports edit mode via #horarioEditId, but
    // nothing in the UI ever sets that field to an existing block's id —
    // abrirModalNuevoHorario() always resets it to ''. "Editar horarios" from
    // the admin panel is listed as required coverage but isn't implemented.
    await loginAsAdmin(page);
    await page.route('**/api/admin/supabase/veterinarios', (route) =>
      route.fulfill({ json: [{ id: 203, nombre: 'Dra. Horario Test 3', activo: true }] })
    );
    await page.route('**/api/admin/supabase/horarios*', (route) =>
      route.fulfill({
        json: [{ id: 56, veterinario_id: 203, dia_semana: 0, hora_inicio: '09:00:00', hora_fin: '10:00:00', duracion_consulta_minutos: 30, activo: true }],
      })
    );

    await page.click('.menu-item[data-target="sec-citas-web"]');
    await page.click('.qr-tab-btn[data-tab="tab-horarios"]');
    await page.selectOption('#selectVetHorario', '203');
    await page.click('button:has-text("Ver Horarios")');

    await expect(page.locator('#horariosGrid button:has-text("Eliminar")')).toBeVisible();
    await expect(page.locator('#horariosGrid button:has-text("Editar")')).toHaveCount(0);
  });
});
