
import pandas as pd
import joblib
from pathlib import Path
from datetime import timedelta

# Step 1: Locate files
base_path = Path(__file__).parent

model_path = base_path / "models" / "smartmart_model.joblib"
data_path = (
    base_path / "data" /
    "smartmart_synthetic_sales_12_months.csv"
)

# Step 2: Load trained ML model
saved_data = joblib.load(model_path)

model = saved_data["model"]
features = saved_data["features"]

# Step 3: Load sales history
df = pd.read_csv(data_path)
df["date"] = pd.to_datetime(df["date"])

df = df.sort_values(["product_id", "date"])

# Step 4: Find the next prediction date
last_date = df["date"].max()
next_date = last_date + timedelta(days=1)

print("\nSMARTMART AI DEMAND FORECAST")
print("Prediction date:", next_date.date())
print("-" * 65)

# Step 5: Predict demand for every product
results = []

for product_id, product_data in df.groupby("product_id"):

    product_data = product_data.sort_values("date")

    # Get the latest 7 days of historical demand
    history = product_data["demand_units"].tail(7)

    if len(history) < 7:
        print("Skipping product", product_id, "- insufficient history")
        continue

    # Ensure data is recent enough for the prediction date
    if product_data["date"].max() != last_date:
        print("Skipping product", product_id, "- missing latest sales date")
        continue

    # Prepare input features
    input_data = pd.DataFrame([{
        "product_id": product_id,
        "weekday": next_date.dayofweek,
        "month": next_date.month,
        "is_weekend": int(next_date.dayofweek >= 5),
        "lag_1": history.iloc[-1],
        "lag_7": history.iloc[0],
        "rolling_7": history.mean()
    }])

    # Match training feature order
    input_data = input_data[features]

    # Run ML prediction
    prediction = model.predict(input_data)[0]
    predicted_units = max(0, round(prediction))

    product_name = product_data["product_name"].iloc[-1]

    results.append({
        "product_id": product_id,
        "product_name": product_name,
        "predicted_demand": predicted_units
    })

# Step 6: Display results
forecast_df = pd.DataFrame(results)

if forecast_df.empty:
    print("No predictions generated.")
else:
    print(forecast_df.to_string(index=False))

    # Step 7: Save predictions to CSV
    output_path = base_path / "data" / "predictions.csv"
    forecast_df.to_csv(output_path, index=False)

    print("\nPredictions saved to:", output_path)
