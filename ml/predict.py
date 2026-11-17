
import pandas as pd
import joblib
import argparse
from pathlib import Path
from datetime import timedelta

base_path = Path(__file__).parent

# Accept a CSV file from the terminal
parser = argparse.ArgumentParser()
parser.add_argument(
    "dataset",
    nargs="?",
    default=str(
        base_path / "data" /
        "smartmart_synthetic_sales_12_months.csv"
    )
)
args = parser.parse_args()

# Load trained model
saved_data = joblib.load(
    base_path / "models" / "smartmart_model.joblib"
)

model = saved_data["model"]
features = saved_data["features"]

# Load reference products used during training
reference = pd.read_csv(
    base_path / "data" /
    "smartmart_synthetic_sales_12_months.csv"
)

known_products = (
    reference.groupby("product_id")["product_name"]
    .first().to_dict()
)

# Load the selected dataset
df = pd.read_csv(args.dataset)

required = {
    "date", "product_id",
    "product_name", "demand_units"
}

missing = required - set(df.columns)

if missing:
    raise ValueError(f"Missing columns: {missing}")

df["date"] = pd.to_datetime(df["date"])
df["product_id"] = pd.to_numeric(
    df["product_id"], errors="raise"
)
df["demand_units"] = pd.to_numeric(
    df["demand_units"], errors="raise"
)

if df[list(required)].isna().any().any():
    raise ValueError("Required fields contain missing values.")

if (df["demand_units"] < 0).any():
    raise ValueError("Demand cannot be negative.")

if df.duplicated(["product_id", "date"]).any():
    raise ValueError("Duplicate product-date records found.")

results = []

for product_id, product_data in df.groupby("product_id"):

    product_data = product_data.sort_values("date")

    # Prevent using the model for unfamiliar products
    if product_id not in known_products:
        print(f"Skipping unknown product ID: {product_id}")
        continue

    expected_name = known_products[product_id]

    if not product_data["product_name"].eq(expected_name).all():
        print(f"Skipping product {product_id}: name mismatch")
        continue

    history = product_data.tail(7)

    if len(history) < 7:
        print(f"Skipping {expected_name}: insufficient history")
        continue

    # Ensure there are no missing days in recent history
    expected_dates = pd.date_range(
        end=history["date"].iloc[-1],
        periods=7,
        freq="D"
    )

    if not history["date"].reset_index(drop=True).equals(
        pd.Series(expected_dates)
    ):
        print(f"Skipping {expected_name}: gaps in dates")
        continue

    next_date = history["date"].iloc[-1] + timedelta(days=1)

    input_data = pd.DataFrame([{
        "product_id": product_id,
        "weekday": next_date.dayofweek,
        "month": next_date.month,
        "is_weekend": int(next_date.dayofweek >= 5),
        "lag_1": history["demand_units"].iloc[-1],
        "lag_7": history["demand_units"].iloc[0],
        "rolling_7": history["demand_units"].mean()
    }])

    prediction = model.predict(input_data[features])[0]

    results.append({
        "product_id": product_id,
        "product_name": expected_name,
        "prediction_date": next_date.date().isoformat(),
        "predicted_demand": max(0, round(prediction))
    })

forecast_df = pd.DataFrame(results)

if forecast_df.empty:
    print("No valid products found for prediction.")
else:
    print("\nSMARTMART AI DEMAND FORECAST")
    print("-" * 65)
    print(forecast_df.to_string(index=False))

    output_path = base_path / "data" / "predictions.csv"
    forecast_df.to_csv(output_path, index=False)

    print("\nPredictions saved to:", output_path)
