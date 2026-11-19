
import pandas as pd
import json
from pathlib import Path

base_path = Path(__file__).parent

dataset_path = (
    base_path / "data" /
    "smartmart_synthetic_sales_12_months.csv"
)

output_path = base_path / "data" / "product_catalog.json"

# Load historical sales dataset
df = pd.read_csv(dataset_path)

# Convert date column
df["date"] = pd.to_datetime(df["date"])

# Select latest inventory record for each product
latest = (
    df.sort_values("date")
    .groupby("product_id")
    .tail(1)
    .sort_values("product_id")
)

# Create products using SmartMart's data structure
products = []

for _, row in latest.iterrows():
    products.append({
        "id": int(row["product_id"]),
        "name": str(row["product_name"]),
        "category": str(row["category"]),
        "price": float(row["unit_price_inr"]),
        "stock": int(row["closing_stock"])
    })

# Validate product IDs
ids = [product["id"] for product in products]

if len(products) != 15 or len(set(ids)) != 15:
    raise ValueError("Expected 15 unique products.")

# Save catalog
with open(output_path, "w", encoding="utf-8") as file:
    json.dump(products, file, indent=4)

print("SmartMart Product Catalog Generated!")
print("Total products:", len(products))
print("Saved to:", output_path)

for product in products:
    print(product["id"], "-", product["name"])
