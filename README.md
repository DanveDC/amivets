# 🐾 AmiVets - Sistema de Gestión Veterinaria

Sistema profesional de gestión veterinaria construido con **FastAPI**, **PostgreSQL**, **HTMX** y **Docker**.

## 🚀 Características

- ✅ **Gestión de Mascotas**: Registro completo de pacientes
- ✅ **Gestión de Propietarios**: Base de datos de clientes
- ✅ **Sistema de Consultas**: Historial médico detallado
- ✅ **Facturación**: Control de pagos y servicios
- ✅ **API RESTful**: Backend robusto con FastAPI
- ✅ **Interfaz Moderna**: UI responsive con animaciones suaves
- ✅ **Docker**: Despliegue fácil y consistente

## 📋 Requisitos Previos

- **Docker Desktop** instalado y corriendo
- **Git** (opcional, para clonar el repositorio)

## 🛠️ Instalación y Ejecución

### Paso 1: Iniciar Docker Desktop

**⚠️ IMPORTANTE**: Antes de ejecutar cualquier comando, asegúrate de que Docker Desktop esté corriendo.

En Windows:
1. Busca "Docker Desktop" en el menú de inicio
2. Ábrelo y espera a que el ícono de Docker en la barra de tareas deje de parpadear
3. Verifica que diga "Docker Desktop is running"

### Paso 2: Levantar los Servicios

Abre PowerShell o CMD en la carpeta del proyecto y ejecuta:

```bash
docker-compose up --build
```

Este comando:
- 🐘 Levanta PostgreSQL en el puerto 5432
- 🚀 Levanta FastAPI en el puerto 8000
- 🌐 Levanta Nginx en el puerto 80

### Paso 3: Acceder a la Aplicación

Una vez que veas el mensaje "Application startup complete", abre tu navegador en:

- **Aplicación Principal**: http://localhost
- **API Docs (Swagger)**: http://localhost/docs
- **API Redoc**: http://localhost/redoc
- **Health Check**: http://localhost/health

## 🎯 Uso de la Aplicación

### Registrar un Propietario
1. Haz clic en el botón **"+ Registrar Propietario"** en la esquina superior derecha
2. Llena el formulario con los datos del cliente
3. Haz clic en **"Guardar Propietario"**

> **Nota**: Actualmente el endpoint de propietarios está pendiente de implementación. Los datos se mostrarán en la consola del navegador.

### Registrar una Mascota
1. Haz clic en el botón **"+ Registrar mascota"**
2. Completa la información de la mascota
3. Ingresa el ID del propietario
4. Haz clic en **"Guardar Mascota"**

✅ Este endpoint **SÍ está funcional** y guardará los datos en la base de datos.

### Registrar una Consulta
1. Haz clic en **"+ Registrar consulta"**
2. Llena los detalles de la consulta médica
3. Haz clic en **"Guardar Consulta"**

> **Nota**: El endpoint de consultas está pendiente de implementación.

## 🔧 Solución de Problemas

### ❌ Error: "Docker Desktop is not running"

**Solución**: 
1. Abre Docker Desktop
2. Espera a que inicie completamente
3. Vuelve a ejecutar `docker-compose up`

### ❌ Error: "Port 80 is already in use"

**Solución**:
```bash
# Detén los contenedores
docker-compose down

# Verifica qué está usando el puerto 80
netstat -ano | findstr :80

# Mata el proceso o cambia el puerto en docker-compose.yml
```

### ❌ La interfaz aparece pero los botones no hacen nada

**Solución**:
1. Abre la consola del navegador (F12)
2. Verifica si hay errores de JavaScript
3. Asegúrate de que el backend esté corriendo:
   ```bash
   docker ps
   ```
4. Deberías ver 3 contenedores corriendo: `veterinaria_db`, `veterinaria_backend`, `veterinaria_nginx`

### ❌ Error 404 al hacer clic en los botones

**Solución**:
- Algunos endpoints aún no están implementados (propietarios, consultas)
- El endpoint de mascotas **SÍ funciona**
- Revisa la consola del navegador para ver qué endpoint está fallando

### ❌ Error de conexión a la base de datos

**Solución**:
```bash
# Reinicia los contenedores
docker-compose down
docker-compose up --build

# Si persiste, elimina los volúmenes
docker-compose down -v
docker-compose up --build
```

## 📁 Estructura del Proyecto

```
amivets/
├── backend/
│   ├── app/
│   │   ├── core/          # Configuración y DB
│   │   ├── models/        # Modelos SQLAlchemy
│   │   ├── routers/       # Endpoints de la API
│   │   ├── schemas/       # Esquemas Pydantic
│   │   ├── services/      # Lógica de negocio
│   │   └── main.py        # Aplicación principal
│   └── alembic/           # Migraciones de DB
├── static/
│   ├── css/               # Estilos
│   ├── js/                # JavaScript
│   └── templates/         # HTML
├── nginx/
│   └── nginx.conf         # Configuración Nginx
├── docker-compose.yml     # Orquestación Docker
├── Dockerfile             # Imagen del backend
└── .env                   # Variables de entorno
```

## 🔌 API Endpoints Disponibles

### Mascotas ✅ FUNCIONAL
- `POST /api/mascotas/` - Crear mascota
- `GET /api/mascotas/` - Listar mascotas
- `GET /api/mascotas/{id}` - Obtener mascota
- `PUT /api/mascotas/{id}` - Actualizar mascota
- `DELETE /api/mascotas/{id}` - Eliminar mascota

### Facturas ✅ FUNCIONAL
- `POST /api/facturas/` - Crear factura
- `GET /api/facturas/` - Listar facturas
- `GET /api/facturas/{id}` - Obtener factura
- `PUT /api/facturas/{id}` - Actualizar factura
- `POST /api/facturas/{id}/anular` - Anular factura

### Propietarios ⏳ PENDIENTE
- Necesita implementación en el backend

### Consultas ⏳ PENDIENTE
- Necesita implementación en el backend

## 🧪 Probar la API

### Usando Swagger UI
1. Ve a http://localhost/docs
2. Expande el endpoint que quieras probar
3. Haz clic en "Try it out"
4. Llena los datos y haz clic en "Execute"

### Usando cURL

```bash
# Crear una mascota
curl -X POST "http://localhost/api/mascotas/" \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Firulais",
    "especie": "Perro",
    "raza": "Labrador",
    "propietario_id": 1
  }'

# Listar mascotas
curl http://localhost/api/mascotas/
```

## 🛑 Detener la Aplicación

```bash
# Detener los contenedores
docker-compose down

# Detener y eliminar volúmenes (borra la base de datos)
docker-compose down -v
```

## 🔄 Reiniciar desde Cero

```bash
# Elimina todo y reconstruye
docker-compose down -v
docker-compose up --build
```

## 📝 Próximos Pasos para Completar la Aplicación

1. **Implementar endpoint de Propietarios**:
   - Crear modelo `Propietario` en `backend/app/models/`
   - Crear schema en `backend/app/schemas/`
   - Crear router en `backend/app/routers/propietarios.py`
   - Crear service en `backend/app/services/`

2. **Implementar endpoint de Consultas**:
   - Similar al proceso de Propietarios
   - Relacionar con Mascotas

3. **Mejorar la UI**:
   - Mostrar lista de mascotas en la interfaz
   - Agregar búsqueda y filtros
   - Implementar paginación

4. **Autenticación**:
   - Agregar login de usuarios
   - Proteger endpoints con JWT

## 💡 Consejos de Desarrollo

### Ver logs en tiempo real
```bash
# Todos los servicios
docker-compose logs -f

# Solo el backend
docker-compose logs -f backend

# Solo la base de datos
docker-compose logs -f db
```

### Acceder a la base de datos
```bash
# Conectarse al contenedor de PostgreSQL
docker exec -it veterinaria_db psql -U vetuser -d veterinaria_db

# Ver tablas
\dt

# Ver datos de mascotas
SELECT * FROM mascotas;

# Salir
\q
```

### Ejecutar migraciones
```bash
# Entrar al contenedor del backend
docker exec -it veterinaria_backend bash

# Crear migración
alembic revision --autogenerate -m "descripcion"

# Aplicar migraciones
alembic upgrade head
```

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.

## 👨‍💻 Autor

Desarrollado con ❤️ para la gestión veterinaria moderna.

---

**¿Necesitas ayuda?** Abre un issue en el repositorio o revisa la sección de solución de problemas arriba.
#   a m i v e t s  
 