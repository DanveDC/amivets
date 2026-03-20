from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
import os
from app.core.config import settings
from app.core.database import engine, Base
from app.routers import mascotas, facturas, propietarios, consultas, citas, pruebas, inventario, reportes, auth, usuarios, hospitalizaciones, cirugias, clinico
from app.models.models import Usuario
from app.core import security
from sqlalchemy.orm import Session
import time
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Crear las tablas en la base de datos
Base.metadata.create_all(bind=engine)

# Crear la aplicación FastAPI
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Sistema profesional de gestión veterinaria con FastAPI y PostgreSQL",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Evento de inicio para crear usuario admin por defecto
@app.on_event("startup")
def create_default_admin():
    db = Session(bind=engine)
    try:
        admin_user = db.query(Usuario).filter(Usuario.username == "admin").first()
        if not admin_user:
            logger.info("Creating default admin user...")
            hashed_password = security.get_password_hash("admin")
            admin = Usuario(
                username="admin",
                email="admin@amivets.com",
                hashed_password=hashed_password,
                role="admin",
                is_active=True
            )
            db.add(admin)
            db.commit()
            logger.info("Default admin user created: admin / admin")
        else:
            logger.info("Default admin user already exists.")
    except Exception as e:
        logger.error(f"Error creating default admin: {e}")
    finally:
        db.close()

# Middleware de logging y manejo de errores
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        logger.info(f"Request: {request.method} {request.url.path} - Status: {response.status_code} - Duration: {process_time:.4f}s")
        return response
    except Exception as e:
        logger.error(f"Error processing request: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal Server Error"}
        )

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuración de rutas
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(BASE_DIR)

# Montar archivos estáticos
# Intentar primero la ruta de Docker, luego la ruta local relativa al root
static_dirs_to_try = [
    "/app/static",
    os.path.join(ROOT_DIR, "static"),
    "static"
]

static_dir = None
for s_dir in static_dirs_to_try:
    if os.path.exists(s_dir):
        static_dir = s_dir
        logger.info(f"Static directory found at: {static_dir}")
        break

if static_dir:
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Configurar templates
templates = None
if static_dir:
    templates_dir = os.path.join(static_dir, "templates")
    if os.path.exists(templates_dir):
        templates = Jinja2Templates(directory=templates_dir)
        logger.info(f"Templates directory found at: {templates_dir}")

# Incluir routers
app.include_router(mascotas.router)
app.include_router(facturas.router)
app.include_router(propietarios.router)
app.include_router(consultas.router)
app.include_router(citas.router)
app.include_router(pruebas.router)
app.include_router(inventario.router)
app.include_router(reportes.router)
app.include_router(auth.router)
app.include_router(usuarios.router)
app.include_router(hospitalizaciones.router)
app.include_router(cirugias.router)
app.include_router(clinico.router)


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """Página principal de la aplicación"""
    if templates and os.path.exists(f"{templates_dir}/index.html"):
        return templates.TemplateResponse("index.html", {"request": request})
    else:
        # Si no hay templates, devolver información de la API
        return JSONResponse({
            "message": "AmiVets - Sistema de Gestión Veterinaria API",
            "version": settings.APP_VERSION,
            "docs": "/docs",
            "redoc": "/redoc",
            "endpoints": {
                "mascotas": "/api/mascotas",
                "facturas": "/api/facturas",
                "propietarios": "/api/propietarios",
                "consultas": "/api/consultas",
                "citas": "/api/citas",
                "pruebas": "/api/pruebas",
                "inventario": "/api/inventario",
                "reportes": "/api/reportes",
                "auth": "/token",
                "usuarios": "/api/usuarios",
                "hospitalizaciones": "/api/hospitalizaciones",
                "cirugias": "/api/cirugias",
                "health": "/health",
                "info": "/api/info"
            }
        })


@app.get("/login", response_class=HTMLResponse)
@app.get("/login.html", response_class=HTMLResponse)
async def login_page(request: Request):
    """Página de inicio de sesión"""
    if templates:
        try:
            return templates.TemplateResponse("login.html", {"request": request})
        except Exception as e:
            logger.error(f"Error serving login template: {e}")
    
    return JSONResponse({
        "detail": "Login template not found",
        "debug_info": {
            "static_dir": static_dir,
            "exists": os.path.exists(os.path.join(static_dir, "templates", "login.html")) if static_dir else False
        }
    }, status_code=404)


@app.get("/health")
async def health_check():
    """Endpoint de verificación de salud"""
    return {
        "status": "healthy",
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT
    }


@app.get("/api/info")
async def api_info():
    """Información de la API"""
    return {
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "redoc": "/redoc"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )
