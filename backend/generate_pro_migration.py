from sqlalchemy import inspect, text
from app.core.database import engine, Base
from app.models.models import *

def generate_migrations():
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    
    # List of tables we need to check (especially the ones we modified/added)
    tables_to_check = [
        'mascotas', 'facturas', 'hospitalizaciones', 'hojas_tratamiento', 
        'cirugias', 'protocolos_anestesicos', 'consentimientos', 'planes_salud'
    ]
    
    migration_commands = []
    
    # 1. First, SQLAlchemy will create NEW tables naturally if we run create_all,
    # but let's detect them anyway for visibility.
    # Base.metadata.create_all(bind=engine) # This creates tables that don't exist
    
    # 2. Check for missing columns in EXISTING tables
    for table_name in existing_tables:
        if table_name not in Base.metadata.tables:
            continue
            
        model_table = Base.metadata.tables[table_name]
        existing_columns = [col['name'] for col in inspector.get_columns(table_name)]
        
        for column in model_table.columns:
            if column.name not in existing_columns:
                # Basic type mapping for PostgreSQL
                col_type = str(column.type)
                if 'VARCHAR' in col_type:
                    pg_type = col_type
                elif 'FLOAT' in col_type:
                    pg_type = 'DOUBLE PRECISION'
                elif 'BOOLEAN' in col_type:
                    pg_type = 'BOOLEAN'
                elif 'INTEGER' in col_type:
                    pg_type = 'INTEGER'
                elif 'DATETIME' in col_type or 'DateTime' in col_type:
                    pg_type = 'TIMESTAMP WITH TIME ZONE'
                elif 'DATE' in col_type or 'Date' in col_type:
                    pg_type = 'DATE'
                elif 'TEXT' in col_type:
                    pg_type = 'TEXT'
                elif 'JSON' in col_type:
                    pg_type = 'JSON'
                else:
                    pg_type = col_type
                
                default_clause = ""
                if column.default is not None:
                    # Very simple default handling
                    if hasattr(column.default, 'arg'):
                        default_clause = f" DEFAULT {column.default.arg}"

                migration_commands.append(f"ALTER TABLE {table_name} ADD COLUMN {column.name} {pg_type}{default_clause};")
    
    if migration_commands:
        with open("migration_fix.sql", "w") as f:
            f.write("\n".join(migration_commands))
        print(f"Generated {len(migration_commands)} migration commands in migration_fix.sql")
    else:
        print("No missing columns found.")

if __name__ == "__main__":
    generate_migrations()
