from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List, Union


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://vetuser:vetpass123@localhost:5432/veterinaria_db"
    
    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def assemble_db_connection(cls, v: str) -> str:
        if isinstance(v, str) and v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v
    
    # Application
    APP_NAME: str = "AmiVets - Sistema de Gestión Veterinaria"
    APP_VERSION: str = "1.0.0"
    SECRET_KEY: str
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Local timezone of the clinic. The server may run in UTC (e.g. on Render),
    # but appointment date checks must use the clinic's civil date.
    CLINIC_TIMEZONE: str = "America/Argentina/Buenos_Aires"
    
    # CORS
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:8080",
    ]
    
    @field_validator('CORS_ORIGINS', mode='before')
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(',')]
        return v
    
    # JWT
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Inventario fraccionado (Tarea 07, decision 4). Cuando es True, aplicar un
    # servicio con stock insuficiente vuelve a bloquear con HTTP 400. Por
    # defecto False: se permite, se avisa y se registra el faltante en el ledger.
    STRICT_INVENTORY: bool = False

    # Adjuntos (Tarea 06, decision 8). Raiz DENTRO del volumen nombrado
    # `adjuntos_data` (docker-compose.yml) -- nunca bajo static/, que nginx
    # sirve sin pasar por FastAPI. Techo alineado a proposito con
    # `client_max_body_size 20M` de nginx.conf: pedir mas generaria un 413 de
    # nginx que la app jamas veria.
    ADJUNTOS_ROOT: str = "/app/data/adjuntos"
    ADJUNTOS_MAX_BYTES: int = 20 * 1024 * 1024

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
