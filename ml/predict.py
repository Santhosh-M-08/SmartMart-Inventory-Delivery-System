
import pandas as pd
import joblib
from pathlib import Path
from datetime import timedelta

# Step 1: Locate our files
base_path = Path(__file__).parent

model_path = base_path / "models" / "milk_model.joblib"
data_path = (
    base_path / "data" /
    "smartmart_synthetic_sales_12_months.csv"
)

# Step 2: Load the trained model
saved_data = joblib.load(model_path)

model = saved_data["model"]
features = saved_data["features"]

# Step 3: Load historical sales
df = pd.read_csv(data_path)

milk_data = df[df["product_id"] == 101].copy()

milk_data["date"] = pd.to_datetime(milk_data["date"])
milk_data = milk_data.sort_values("date")

# Step 4: Find the next date
last_date = milk_data["date"].max()
next_date = last_date + timedelta(days=1)

# Step 5: Get the last 7 days of demand
last_7_days = milk_data["demand_units"].tail(7)

if len(last_7_days) < 7:
    raise ValueError("At least 7 days of sales are required.")

# Step 6: Prepare features for prediction
input_data = pd.DataFrame([{
    "weekday": next_date.dayofweek,
    "month": next_date.month,
    "is_weekend": int(next_date.dayofweek >= 5),
    "lag_1": last_7_days.iloc[-1],
    "lag_7": last_7_days.iloc[0],
    "rolling_7": last_7_days.mean()
}])

# Ensure features match training order
input_data = input_data[features]

# Step 7: Predict future demand
prediction = model.predict(input_data)[0]

predicted_units = max(0, round(prediction))

# Step 8: Display result
print("\nSMARTMART AI DEMAND FORECAST")
print("----------------------------")
print("Product: Milk")
print("Prediction date:", next_date.date())
print("Predicted demand:", predicted_units, "units")
