from sqlalchemy import inspect, text
from app.core.database import engine, Base
from app.models.models import *

def check_schema():
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    
    missing_columns = []
    
    for table_name in existing_tables:
        # Get columns from DB
        db_cols = {c['name'].lower() for c in inspector.get_columns(table_name)}
        
        # Find corresponding model
        model = None
        for m in Base.registry.mappers:
            if m.class_.__tablename__ == table_name:
                model = m.class_
                break
        
        if model:
            # Get columns from Model
            model_cols = {c.name.lower(): c for c in model.__table__.columns}
            
            for col_name, col_obj in model_cols.items():
                if col_name not in db_cols:
                    type_str = str(col_obj.type).split('(')[0] # Simple type
                    if type_str == 'VARCHAR':
                        type_str = f"VARCHAR({col_obj.type.length})"
                    
                    nullable = "NULL" if col_obj.nullable else "NOT NULL"
                    default = ""
                    if col_obj.server_default:
                        default = f" DEFAULT {col_obj.server_default.arg}"
                    
                    missing_columns.append(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {type_str};")

    if missing_columns:
        with open("missing_cols.sql", "w") as f:
            f.write("\n".join(missing_columns))
        print(f"Generated {len(missing_columns)} migration commands in missing_cols.sql")
    else:
        print("No missing columns found.")

if __name__ == "__main__":
    check_schema()
