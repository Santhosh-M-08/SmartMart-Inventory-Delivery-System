
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
import joblib

base_path = Path(__file__).parent

# Load dataset
df = pd.read_csv(
    base_path / "data" / "smartmart_synthetic_sales_12_months.csv"
)

# Select Milk
milk_data = df[df["product_id"] == 101].copy()

milk_data["date"] = pd.to_datetime(milk_data["date"])
milk_data = milk_data.sort_values("date")

# Calendar features
milk_data["weekday"] = milk_data["date"].dt.dayofweek
milk_data["month"] = milk_data["date"].dt.month
milk_data["is_weekend"] = (
    milk_data["weekday"] >= 5
).astype(int)

# Historical demand features
milk_data["lag_1"] = milk_data["demand_units"].shift(1)
milk_data["lag_7"] = milk_data["demand_units"].shift(7)

milk_data["rolling_7"] = (
    milk_data["demand_units"]
    .shift(1)
    .rolling(window=7)
    .mean()
)

# Remove rows without enough history
milk_data = milk_data.dropna()

features = [
    "weekday",
    "month",
    "is_weekend",
    "lag_1",
    "lag_7",
    "rolling_7"
]

X = milk_data[features]
y = milk_data["demand_units"]

# Chronological train-test split
split_index = int(len(milk_data) * 0.8)

X_train = X.iloc[:split_index]
X_test = X.iloc[split_index:]

y_train = y.iloc[:split_index]
y_test = y.iloc[split_index:]

# Train model
model = RandomForestRegressor(
    n_estimators=200,
    max_depth=8,
    random_state=42
)

model.fit(X_train, y_train)

# Predictions
predictions = model.predict(X_test)

# Improved baseline: use previous day's demand
baseline_predictions = X_test["lag_1"]

# Calculate errors
model_mae = mean_absolute_error(
    y_test, predictions
)

baseline_mae = mean_absolute_error(
    y_test, baseline_predictions
)

print("Improved ML Model MAE:", round(model_mae, 2))
print("Previous-Day Baseline MAE:", round(baseline_mae, 2))

# Save model with feature names
model_path = base_path / "models" / "milk_model.joblib"

joblib.dump(
    {
        "model": model,
        "features": features
    },
    model_path
)

print("Improved model saved successfully!")
