from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.core import security
from app.models.models import Usuario
from app.schemas.schemas import UsuarioCreate, UsuarioResponse, PasswordUpdate, UsuarioUpdate
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from app.core.config import settings

router = APIRouter(prefix="/api/usuarios", tags=["Usuarios"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
# Variante que NO fuerza 401 cuando falta / es invalido el token: los routers
# clinicos de este stack no exigen login (ver e2e/helpers.js), pero cuando SI
# llega una sesion valida queremos registrar usuario_responsable_id en el ledger
# de inventario (Tarea 07, decision 8). Si no hay usuario, queda nullable.
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(Usuario).filter(Usuario.username == username).first()
    if user is None:
        raise credentials_exception
    return user

async def get_optional_current_user(
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
) -> Optional[Usuario]:
    """Devuelve el Usuario de la sesion si el token es valido; None si no hay
    token o no valida. Nunca levanta 401."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        username = payload.get("sub")
    except JWTError:
        return None
    if not username:
        return None
    return db.query(Usuario).filter(Usuario.username == username).first()

async def get_current_admin(current_user: Usuario = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operación permitida solo para administradores"
        )
    return current_user


# Roles validos del backend. `recepcionista` se introduce con la Tarea 09
# (decision 7): puede abrir consultas y anexar servicios NO clinicos, pero no
# vacunar, operar, hospitalizar, pedir laboratorio ni recetar.
ROLES_VALIDOS = {"admin", "veterinario", "recepcionista", "user"}


def require_roles(*roles: str):
    """Dependencia de autorizacion por rol para los routers clinicos.

    LIMITACION CONOCIDA Y DELIBERADA (Tarea 09, decision 7): los routers
    clinicos de este stack NO exigen login -- la suite e2e (ver e2e/helpers.js)
    llama sin token y varios flujos internos tambien. Para no romper ese
    contrato, si NO hay usuario autenticado se DEJA PASAR. El gate solo aplica
    cuando SI hay sesion: en ese caso el rol debe estar en `roles`, si no -> 403.
    Cuando el stack pase a exigir login, cambiar `get_optional_current_user` por
    `get_current_user` aca y desaparece el agujero.
    """

    async def _dep(
        current_user: Optional[Usuario] = Depends(get_optional_current_user),
    ) -> Optional[Usuario]:
        if current_user is not None and current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Tu rol no tiene permiso para esta acción. "
                    f"Roles habilitados: {', '.join(sorted(roles))}."
                ),
            )
        return current_user

    return _dep

@router.post("/", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def crear_usuario(
    usuario: UsuarioCreate,
    db: Session = Depends(get_db),
    # Solo permitimos crear usuarios si eres admin, o si no hay usuarios en la base (primer setup)
    current_user: Usuario = Depends(get_current_user)
):
    """Crea un nuevo usuario (Solo Admin)"""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="No tienes permisos para crear usuarios")
        
    # Verificar si usuario o email ya existen
    if db.query(Usuario).filter(Usuario.username == usuario.username).first():
        raise HTTPException(status_code=400, detail="El nombre de usuario ya existe")
    if db.query(Usuario).filter(Usuario.email == usuario.email).first():
        raise HTTPException(status_code=400, detail="El email ya esta registrado")
        
    hashed_password = security.get_password_hash(usuario.password)
    nuevo_usuario = Usuario(
        username=usuario.username,
        email=usuario.email,
        hashed_password=hashed_password,
        role=usuario.role
    )
    
    db.add(nuevo_usuario)
    db.commit()
    db.refresh(nuevo_usuario)
    return nuevo_usuario

@router.get("/", response_model=List[UsuarioResponse])
def listar_usuarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin)
):
    """Lista todos los usuarios (Solo Admin)"""
    return db.query(Usuario).all()

@router.get("/veterinarios", response_model=List[UsuarioResponse])
def listar_veterinarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Lista doctores/veterinarios habilitados"""
    vets = db.query(Usuario).filter(Usuario.role == "veterinario").all()
    if not vets: # Fallback just in case
        return db.query(Usuario).filter(Usuario.username != "admin").all()
    return vets

@router.get("/me", response_model=UsuarioResponse)
async def read_users_me(current_user: Usuario = Depends(get_current_user)):
    """Obtiene la informacion del usuario actual autenticado"""
    return current_user

@router.put("/{usuario_id}", response_model=UsuarioResponse)
def actualizar_usuario(
    usuario_id: int,
    data: UsuarioUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin)
):
    """Actualiza username, email, rol y/o estado activo de un usuario (Solo Admin)"""
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if data.username is not None:
        conflict = db.query(Usuario).filter(
            Usuario.username == data.username, Usuario.id != usuario_id
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail="El nombre de usuario ya existe")
        usuario.username = data.username
    if data.email is not None:
        conflict = db.query(Usuario).filter(
            Usuario.email == data.email, Usuario.id != usuario_id
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail="El email ya está registrado")
        usuario.email = data.email
    if data.role is not None:
        usuario.role = data.role
    if data.is_active is not None:
        usuario.is_active = data.is_active
    db.commit()
    db.refresh(usuario)
    return usuario


@router.delete("/{usuario_id}")
def eliminar_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin)
):
    """Elimina un usuario (Solo Admin). No puede eliminarse a sí mismo ni al último admin."""
    if current_user.id == usuario_id:
        raise HTTPException(status_code=400, detail="No podés eliminarte a vos mismo")
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    remaining_admins = db.query(Usuario).filter(
        Usuario.role == "admin", Usuario.id != usuario_id
    ).count()
    if usuario.role == "admin" and remaining_admins == 0:
        raise HTTPException(status_code=400, detail="No se puede eliminar el último administrador")
    try:
        db.delete(usuario)
        db.commit()
    except IntegrityError:
        # FKs a consultas/citas/cirugías/notas son NO ACTION: borrar un usuario
        # con historial asociado tiraba 500 sin controlar (revisión final T09).
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar: el usuario tiene consultas, citas u otros registros asociados.",
        )
    return {"message": "Usuario eliminado"}


@router.put("/me/password", status_code=status.HTTP_200_OK)
def update_password(
    password_data: PasswordUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Actualiza la contraseña del usuario actual"""
    if not security.verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual es incorrecta"
        )
    
    current_user.hashed_password = security.get_password_hash(password_data.new_password)
    db.commit()
    return {"message": "Contraseña actualizada exitosamente"}
