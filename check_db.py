import sqlite3
import json

conn = sqlite3.connect('catalogo.db')
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()
print("Tables:", tables)

for table in tables:
    tname = table[0]
    cursor.execute(f"SELECT * FROM {tname} LIMIT 1;")
    row = cursor.fetchone()
    if row:
        cursor.execute(f"PRAGMA table_info({tname});")
        cols = cursor.fetchall()
        print(f"Table {tname}:")
        for i, col in enumerate(cols):
            print(f"  {col[1]}: {row[i]}")
