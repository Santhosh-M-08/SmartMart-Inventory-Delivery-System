
import pandas as pd
import json
from pathlib import Path

# Step 1: Locate the prediction file
base_path = Path(__file__).parent

input_path = base_path / "data" / "predictions.csv"
output_path = base_path / "data" / "forecasts.json"

# Step 2: Read ML predictions
df = pd.read_csv(input_path)

required_columns = [
    "product_id",
    "product_name",
    "prediction_date",
    "predicted_demand"
]

# Step 3: Validate the columns
missing = set(required_columns) - set(df.columns)

if missing:
    raise ValueError(f"Missing columns: {missing}")

if df.empty:
    raise ValueError("No forecasts available.")

if df[required_columns].isna().any().any():
    raise ValueError("Forecasts contain missing values.")

if df["product_id"].duplicated().any():
    raise ValueError("Duplicate product IDs found.")

if (df["predicted_demand"] < 0).any():
    raise ValueError("Predicted demand cannot be negative.")

# Step 4: Convert predictions into JSON records
forecasts = df[required_columns].to_dict(
    orient="records"
)

# Step 5: Save JSON
with open(output_path, "w", encoding="utf-8") as file:
    json.dump(forecasts, file, indent=4)

print("Forecast JSON generated successfully!")
print("Total products:", len(forecasts))
print("Saved to:", output_path)
