"""Validacion y escritura de bytes de adjuntos (Tarea 06, decision 8).

Sin dependencia nueva: python-multipart ya esta en requirements.txt (da
`UploadFile`) y una lista blanca de cuatro firmas no necesita python-magic
(que exigiria libmagic en la imagen). Los cuatro requisitos del enunciado,
resueltos aca:

  1. Ruta no adivinable / sin salir del directorio: el nombre en disco es
     siempre generado (`<raiz>/<YYYY>/<MM>/<uuid4hex>.<ext>`), nunca el que
     manda el cliente. Defensa en profundidad: se resuelve la ruta final y se
     verifica que siga bajo la raiz antes de escribir, aunque el traversal ya
     sea estructuralmente imposible (ningun string del usuario entra en la
     ruta).
  2. Tipo real, no la extension: se lee la cabecera (primeros 512 bytes) y se
     compara contra una lista blanca de firmas de bytes.
  3. Tamano real: se escribe en streaming con un contador propio, nunca se
     confia en `Content-Length`. Techo alineado con `client_max_body_size 20M`
     de nginx.conf.
  4. Integridad: sha256 calculado en el mismo streaming (no se relee el
     archivo despues de escribirlo).
"""
from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

# Cuanto leemos antes de decidir el tipo. Alcanza para las cuatro firmas (la
# mas profunda, DICOM, vive en el offset 128-132).
TAMANO_CABECERA = 512
TAMANO_CHUNK = 64 * 1024

# Lista blanca de firmas de bytes (decision 8, "los cuatro requisitos").
# Cada entrada: (content_type canonico, extension en disco, aliases que el
# cliente puede declarar y que consideramos compatibles con este tipo).
_FIRMAS = {
    "pdf": {
        "content_type": "application/pdf",
        "ext": "pdf",
        "aliases": {"application/pdf"},
    },
    "jpeg": {
        "content_type": "image/jpeg",
        "ext": "jpg",
        "aliases": {"image/jpeg", "image/jpg"},
    },
    "png": {
        "content_type": "image/png",
        "ext": "png",
        "aliases": {"image/png"},
    },
    "dicom": {
        "content_type": "application/dicom",
        "ext": "dcm",
        "aliases": {"application/dicom", "application/octet-stream"},
    },
}


def _detectar_tipo(cabecera: bytes) -> Optional[str]:
    """Devuelve la clave de `_FIRMAS` que matchea, o None si ninguna."""
    if cabecera.startswith(b"%PDF-"):
        return "pdf"
    if cabecera.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if cabecera.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(cabecera) >= 132 and cabecera[128:132] == b"DICM":
        return "dicom"
    return None


@dataclass
class AdjuntoGuardado:
    ruta_relativa: str
    content_type: str
    tamano_bytes: int
    sha256: str


def _raiz_adjuntos() -> Path:
    raiz = Path(settings.ADJUNTOS_ROOT)
    raiz.mkdir(parents=True, exist_ok=True)
    return raiz


async def guardar_bytes_adjunto(upload: UploadFile) -> AdjuntoGuardado:
    """Valida y escribe el contenido de `upload` bajo la raiz de adjuntos.

    Lanza 415 (tipo no reconocido o no coincide con el declarado) o 413
    (supera el techo) SIN escribir nada a disco en ambos casos. El
    `content_type` devuelto es el DETECTADO, nunca `upload.content_type`.
    """
    raiz = _raiz_adjuntos()

    cabecera = b""
    while len(cabecera) < TAMANO_CABECERA:
        chunk = await upload.read(TAMANO_CABECERA - len(cabecera))
        if not chunk:
            break
        cabecera += chunk

    clave = _detectar_tipo(cabecera)
    if clave is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="El archivo no coincide con ningún tipo permitido (PDF, JPEG, PNG o DICOM).",
        )

    firma = _FIRMAS[clave]
    declarado = (upload.content_type or "").split(";")[0].strip().lower()
    if declarado and declarado not in firma["aliases"]:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"El contenido detectado ({firma['content_type']}) no coincide "
                f"con el tipo declarado ({upload.content_type})."
            ),
        )

    ahora = datetime.now(timezone.utc)
    subcarpeta = raiz / f"{ahora:%Y}" / f"{ahora:%m}"
    subcarpeta.mkdir(parents=True, exist_ok=True)

    nombre_disco = f"{uuid.uuid4().hex}.{firma['ext']}"
    destino = subcarpeta / nombre_disco

    # Defensa en profundidad (requisito 1): el traversal ya es estructuralmente
    # imposible (ningún string del cliente entra en `destino`), pero se
    # verifica igual que la ruta final resuelta siga bajo la raíz antes de abrir.
    raiz_resuelta = raiz.resolve()
    destino_resuelto = destino.resolve()
    if raiz_resuelta not in destino_resuelto.parents:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ruta de destino inválida para el adjunto.",
        )

    sha = hashlib.sha256()
    total = len(cabecera)
    sha.update(cabecera)

    if total > settings.ADJUNTOS_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"El archivo supera el tamaño máximo permitido ({settings.ADJUNTOS_MAX_BYTES // (1024 * 1024)} MB).",
        )

    try:
        with open(destino_resuelto, "wb") as f:
            f.write(cabecera)
            while True:
                chunk = await upload.read(TAMANO_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > settings.ADJUNTOS_MAX_BYTES:
                    # Nunca confiar en Content-Length (requisito 3): el corte
                    # real pasa acá, contando bytes escritos, no el header.
                    f.close()
                    destino_resuelto.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            "El archivo supera el tamaño máximo permitido "
                            f"({settings.ADJUNTOS_MAX_BYTES // (1024 * 1024)} MB)."
                        ),
                    )
                sha.update(chunk)
                f.write(chunk)
    except HTTPException:
        raise
    except OSError:
        destino_resuelto.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo guardar el adjunto.",
        )

    ruta_relativa = str(destino_resuelto.relative_to(raiz_resuelta))
    return AdjuntoGuardado(
        ruta_relativa=ruta_relativa,
        content_type=firma["content_type"],
        tamano_bytes=total,
        sha256=sha.hexdigest(),
    )


def ruta_absoluta(ruta_relativa: str) -> Path:
    """Reconstruye la ruta absoluta de un adjunto ya guardado, con la misma
    defensa en profundidad que al escribir: verifica que siga bajo la raíz."""
    raiz_resuelta = _raiz_adjuntos().resolve()
    absoluta = (raiz_resuelta / ruta_relativa).resolve()
    if raiz_resuelta not in absoluta.parents:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ruta de adjunto inválida.",
        )
    return absoluta
