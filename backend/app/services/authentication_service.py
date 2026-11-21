from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.user import User, UserPassword


_password_hasher = PasswordHasher()


class AuthenticationService:

    def create_account(self, db: Session, user_data) -> User:
        contact_filters = self._contact_filters(user_data)
        try:
            if db.query(User.user_id).filter(or_(*contact_filters)).first():
                raise AccountAlreadyExists

            user = User(
                first_name=user_data.first_name,
                last_name=user_data.last_name,
                email=user_data.email,
                phone=user_data.phone,
            )
            db.add(user)
            db.flush()
            db.add(UserPassword(
                user_id=user.user_id,
                password_hash=self.hash_password(user_data.password),
            ))
            db.commit()
            db.refresh(user)
            return user
        except AccountAlreadyExists:
            db.rollback()
            raise
        except IntegrityError as exc:
            db.rollback()
            try:
                duplicate = db.query(User.user_id).filter(or_(*contact_filters)).first()
            except SQLAlchemyError as lookup_error:
                raise AccountServiceUnavailable from lookup_error
            if duplicate:
                raise AccountAlreadyExists from exc
            raise AccountCreationFailed from exc
        except SQLAlchemyError as exc:
            db.rollback()
            raise AccountServiceUnavailable from exc

    def authenticate(self, db: Session, credentials) -> User | None:
        identifier = credentials.identifier
        if "@" in identifier:
            identity_filter = func.lower(User.email) == identifier
        else:
            identity_filter = User.phone == identifier
        record = (
            db.query(User, UserPassword)
            .join(UserPassword, User.user_id == UserPassword.user_id)
            .filter(identity_filter)
            .first()
        )
        password_hash = record.UserPassword.password_hash if record else _DUMMY_PASSWORD_HASH
        if not self.verify_password(credentials.password, password_hash) or not record:
            return None
        return record.User

    @staticmethod
    def _contact_filters(user_data):
        filters = []
        if user_data.email:
            filters.append(func.lower(User.email) == user_data.email)
        if user_data.phone:
            filters.append(User.phone == user_data.phone)
        return filters

    def hash_password(self, password: str) -> str:
        return _password_hasher.hash(password)

    def verify_password(
        self,
        password: str,
        password_hash: str
    ) -> bool:

        try:
            return _password_hasher.verify(password_hash, password)
        except (InvalidHashError, VerificationError):
            return False


class AccountAlreadyExists(Exception):
    pass


class AccountCreationFailed(Exception):
    pass


class AccountServiceUnavailable(Exception):
    pass


_DUMMY_PASSWORD_HASH = _password_hasher.hash("timing-only")
