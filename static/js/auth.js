const API_URL = ''; // Relative path for deployment

// Función para manejar el login
async function login(username, password) {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);

    try {
        const response = await fetch(`${API_URL}/token`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Credenciales inválidas');
        }

        const data = await response.json();
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('token_type', data.token_type);

        // EXTRA: Fetch user details to store role
        const userRes = await fetch(`${API_URL}/api/usuarios/me`, {
            headers: { 'Authorization': `Bearer ${data.access_token}` }
        });
        if (userRes.ok) {
            const userData = await userRes.json();
            localStorage.setItem('role', userData.role);
            localStorage.setItem('username', userData.username);
            localStorage.setItem('user_id', userData.id);
        }

        // Redirigir al dashboard
        window.location.href = '/';
        return true;
    } catch (error) {
        console.error('Error de login:', error);
        const errorDiv = document.getElementById('loginError');
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = 'Usuario o contraseña incorrectos';
        }
        return false;
    }
}
function logout() {
    localStorage.clear(); 
    window.location.href = '/login.html'; 
}
window.logout = logout;

// Verificar token al cargar la página (solo si no estamos en login)
function checkAuth() {
    const token = localStorage.getItem('token');
    const path = window.location.pathname;

    if (!token && !path.includes('login.html')) {
        // Redirigir inmediatamente
        window.location.href = '/login.html';
    } else {
        // Si hay token o estamos en login, mostrar contenido
        if (!path.includes('login.html')) {
            document.body.style.display = 'block';
        }
    }
}

// Manejador del formulario de login
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = loginForm.username.value;
            const password = loginForm.password.value;
            await login(username, password);
        });
    } else {
        // Si no hay formulario de login, verificar auth
        checkAuth();
    }
});

// Helper para headers con token
function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}
