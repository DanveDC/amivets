// Unidad A — Gestión de usuarios (static/js/app.js + backend/app/routers/usuarios.py)
//
// admin-panel.spec.js ya cubre "editar usuario". Acá se llenan los huecos:
//   - alta por UI            (handleNuevoUsuarioSubmit -> POST /api/usuarios/)
//   - activar/desactivar     (toggleUsuarioActivo -> PUT /api/usuarios/{id})
//   - eliminar por UI        (deleteUsuario -> DELETE /api/usuarios/{id})
//   - cambio de contraseña   (PUT /api/usuarios/me/password)
//
// Para el cambio de contraseña se usa un usuario descartable: se cambia la
// clave por API, se confirma que la vieja ya no autentica en /token y que la
// nueva sí, y luego se elimina.
//
// Toda mutación por UI se contrasta con un GET a la API. Nada se mockea.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
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

/** POSTs to /token with form creds; returns the Response so status can be asserted. */
function tokenRequest(request, username, password) {
  return request.post('/token', { form: { username, password } });
}

test.describe.serial('Gestión de usuarios — huecos no cubiertos por "editar usuario"', () => {
  const S = { token: null, uiUser: null };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
  });

  test.afterAll(async ({ request }) => {
    if (S.uiUser?.id) await deleteTestUser(request, S.token, S.uiUser.id);
  });

  test('alta por UI: el modal "Nuevo Usuario" crea el usuario y aparece en la API', async ({ page, request }) => {
    page.on('dialog', (d) => d.accept()); // handleNuevoUsuarioSubmit hace alert()
    const username = testTag('userUI');
    const email = `${username}@example.com`;

    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-usuarios"]');
    await page.click('#btnShowModalUser');
    await expect(page.locator('#modalNuevoUsuario')).toBeVisible();

    await page.fill('#userUsername', username);
    await page.fill('#userEmail', email);
    await page.fill('#userPassword', 'Password123!');
    await page.selectOption('#userRole', 'veterinario');
    await page.click('#formNuevoUsuario button[type="submit"]');

    await expect(page.locator('#modalNuevoUsuario')).toBeHidden();
    await expect(page.locator('#usuariosTableBody')).toContainText(username);

    // Contraste API.
    const usuarios = await (await request.get('/api/usuarios/', { headers: authHeaders(S.token) })).json();
    const creado = usuarios.find((u) => u.username === username);
    expect(creado, 'el usuario creado por UI debe existir en la API').toBeTruthy();
    expect(creado.email).toBe(email);
    expect(creado.role).toBe('veterinario');
    expect(creado.is_active).toBe(true);
    S.uiUser = creado;
  });

  test('activar/desactivar por UI: el botón alterna is_active, contrastado por API', async ({ page, request }) => {
    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-usuarios"]');
    const row = page.locator('#usuariosTableBody tr', { hasText: S.uiUser.username });
    await expect(row).toContainText('Activo');

    // Desactivar.
    await row.getByRole('button', { name: 'Desactivar' }).click();
    await expect(row).toContainText('Inactivo');
    let apiUser = (await (await request.get('/api/usuarios/', { headers: authHeaders(S.token) })).json())
      .find((u) => u.id === S.uiUser.id);
    expect(apiUser.is_active).toBe(false);

    // Reactivar.
    await row.getByRole('button', { name: 'Activar' }).click();
    await expect(row).toContainText('Activo');
    apiUser = (await (await request.get('/api/usuarios/', { headers: authHeaders(S.token) })).json())
      .find((u) => u.id === S.uiUser.id);
    expect(apiUser.is_active).toBe(true);
  });

  test('eliminar por UI: deleteUsuario borra el usuario y desaparece de la API', async ({ page, request }) => {
    page.on('dialog', (d) => d.accept()); // deleteUsuario pide confirm()
    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-usuarios"]');
    const row = page.locator('#usuariosTableBody tr', { hasText: S.uiUser.username });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Eliminar' }).click();

    await expect(page.locator('#usuariosTableBody')).not.toContainText(S.uiUser.username);

    const usuarios = await (await request.get('/api/usuarios/', { headers: authHeaders(S.token) })).json();
    expect(usuarios.some((u) => u.id === S.uiUser.id)).toBe(false);
    S.uiUser = null; // ya no hay nada que limpiar en afterAll
  });

  test('PUT /me/password: cambia la clave; la vieja deja de autenticar y la nueva funciona', async ({ request }) => {
    const throwaway = await createTestUser(request, S.token, { password: 'OldPass123!' });
    try {
      // Login inicial con la clave vieja -> OK.
      const before = await tokenRequest(request, throwaway.username, 'OldPass123!');
      expect(before.ok()).toBeTruthy();
      const userToken = (await before.json()).access_token;

      // current_password incorrecta -> 400.
      const wrong = await request.put('/api/usuarios/me/password', {
        headers: authHeaders(userToken),
        data: { current_password: 'NoEsLaClave', new_password: 'NewPass456!' },
      });
      expect(wrong.status()).toBe(400);

      // Cambio correcto -> 200.
      const ok = await request.put('/api/usuarios/me/password', {
        headers: authHeaders(userToken),
        data: { current_password: 'OldPass123!', new_password: 'NewPass456!' },
      });
      expect(ok.status()).toBe(200);

      // La clave vieja ya no autentica.
      const oldTry = await tokenRequest(request, throwaway.username, 'OldPass123!');
      expect(oldTry.ok()).toBeFalsy();
      expect(oldTry.status()).toBe(401);

      // La clave nueva sí.
      const newTry = await tokenRequest(request, throwaway.username, 'NewPass456!');
      expect(newTry.ok()).toBeTruthy();
    } finally {
      await deleteTestUser(request, S.token, throwaway.id);
    }
  });
});
