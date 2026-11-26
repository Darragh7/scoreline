import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.schemas.user_schema import AuthResponse, UserCreate, UserLogin
from app.services.authentication_service import (
    AccountAlreadyExists,
    AccountCreationFailed,
    AccountServiceUnavailable,
    AuthenticationService,
)


router = APIRouter(prefix="/users", tags=["Users"])
logger = logging.getLogger(__name__)
authentication_service = AuthenticationService()


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def sign_up(user_data: UserCreate, db: Session = Depends(get_db)):
    try:
        user = authentication_service.create_account(db, user_data)
    except AccountAlreadyExists as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email or phone already exists",
        ) from exc
    except AccountServiceUnavailable as exc:
        logger.exception("Signup database operation failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account service temporarily unavailable",
        ) from exc
    except AccountCreationFailed as exc:
        logger.exception("Signup database integrity error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create account",
        ) from exc
    return {"user": user}


@router.post("/login", response_model=AuthResponse)
def log_in(credentials: UserLogin, db: Session = Depends(get_db)):
    user = authentication_service.authenticate(db, credentials)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email, phone, or password",
        )
    return {"user": user}
