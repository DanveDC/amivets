from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core import security
from app.models.models import Usuario
from app.schemas.schemas import UsuarioCreate, UsuarioResponse, PasswordUpdate, UsuarioUpdate
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from app.core.config import settings

router = APIRouter(prefix="/api/usuarios", tags=["Usuarios"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

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

async def get_current_admin(current_user: Usuario = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operación permitida solo para administradores"
        )
    return current_user


# Roles validos del backend. `recepcionista` se introduce con la Tarea 09
# (decision 7): puede abrir consultas y anexar servicios NO clinicos, pero no
# vacunar, operar, hospitalizar, pedir laboratorio ni recetar. `gestor` se
# introduce con la Tarea 06 (decision 9): recibe y ejecuta los servicios de su
# area. La relacion gestor <-> tipo de servicio (`gestor_area`) es de una
# etapa posterior; aca el rol solo existe como valor valido.
ROLES_VALIDOS = {"admin", "veterinario", "recepcionista", "gestor", "user"}


def require_roles(*roles: str):
    """Dependencia de autorizacion por rol para los routers clinicos.

    Requisito cero de la Tarea 06 (decision 9): exige sesion valida SIEMPRE.
    Antes dependia de `get_optional_current_user`, cuya condicion
    (`if current_user is not None and ...`) dejaba pasar sin chequear rol a
    cualquier peticion sin token -- una request anonima nunca entraba al
    `if` y quedaba 200 en vez de 401. Con `get_current_user` no hay forma de
    llegar a `_dep` sin un token valido: sin token o con token invalido es
    401 (lo levanta `get_current_user`); con token pero rol equivocado es 403.
    """

    async def _dep(
        current_user: Usuario = Depends(get_current_user),
    ) -> Usuario:
        if current_user.role not in roles:
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
    # is_active=True: un veterinario desactivado (ver PUT /{id}) no debe seguir
    # ofreciéndose para asignar consultas nuevas (revisión final Tarea 09 — el
    # filtro faltaba y la lista se llenaba de cuentas de baja).
    vets = db.query(Usuario).filter(Usuario.role == "veterinario", Usuario.is_active == True).all()  # noqa: E712
    if not vets: # Fallback just in case
        return db.query(Usuario).filter(Usuario.username != "admin", Usuario.is_active == True).all()  # noqa: E712
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
