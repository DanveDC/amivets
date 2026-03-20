import sys
import os
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
print(f"Adding to path: {parent_dir}")
sys.path.insert(0, parent_dir)
try:
    from app.core.database import SessionLocal
    print("Import successful!")
except ImportError as e:
    print(f"Import failed: {e}")
    print(f"sys.path: {sys.path}")
