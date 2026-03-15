from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core import security
from app.models.models import Usuario
from app.schemas.schemas import Token

router = APIRouter(tags=["Autenticacion"])

@router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """Endpoint para obtener el token de acceso (Login)"""
    print(f"DEBUG: Login attempt for user: {form_data.username}")
    user = db.query(Usuario).filter(Usuario.username == form_data.username).first()
    
    if not user:
        print(f"DEBUG: User not found: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    print(f"DEBUG: User found, verifying password for: {form_data.username}")
    is_valid = security.verify_password(form_data.password, user.hashed_password)
    print(f"DEBUG: Password valid: {is_valid}")
    
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=security.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}
