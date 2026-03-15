from app.core.database import SessionLocal, engine
from app.models.models import Usuario
from app.core import security
from sqlalchemy.orm import Session

def check_and_fix():
    db = Session(bind=engine)
    try:
        print("Checking users in DB...")
        users = db.query(Usuario).all()
        for u in users:
            print(f"Found user: {u.username}, active: {u.is_active}")
        
        # Always force reset admin
        hashed_password = security.get_password_hash("admin")
        admin = db.query(Usuario).filter(Usuario.username == "admin").first()
        if not admin:
            print("Creating admin...")
            admin = Usuario(
                username="admin",
                email="admin@amivets.com",
                hashed_password=hashed_password,
                role="admin",
                is_active=True
            )
            db.add(admin)
        else:
            print("Updating admin password...")
            admin.hashed_password = hashed_password
            admin.is_active = True
        
        db.commit()
        print("Done.")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    check_and_fix()
