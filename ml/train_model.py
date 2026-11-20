
import pandas as pd
import joblib
from pathlib import Path

from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error

# Step 1: Load dataset
base_path = Path(__file__).parent
data_path = base_path / "data" / "smartmart_synthetic_sales_12_months.csv"

df = pd.read_csv(data_path)

# Step 2: Prepare dates and sort records
df["date"] = pd.to_datetime(df["date"])

df = df.sort_values(
    ["product_id", "date"]
).copy()

# Step 3: Create calendar features
df["weekday"] = df["date"].dt.dayofweek
df["month"] = df["date"].dt.month
df["is_weekend"] = (df["weekday"] >= 5).astype(int)

# Step 4: Create historical demand features
groups = df.groupby("product_id")["demand_units"]

df["lag_1"] = groups.shift(1)
df["lag_7"] = groups.shift(7)

df["rolling_7"] = df.groupby("product_id")[
    "demand_units"
].transform(
    lambda values: values.shift(1).rolling(7).mean()
)

# Remove rows without sufficient history
df = df.dropna().copy()

# Step 5: Select features and target
features = [
    "product_id",
    "weekday",
    "month",
    "is_weekend",
    "lag_1",
    "lag_7",
    "rolling_7"
]

# Step 6: Split by date, not randomly
unique_dates = sorted(df["date"].unique())
split_index = int(len(unique_dates) * 0.8)
split_date = unique_dates[split_index]

train = df[df["date"] < split_date]
test = df[df["date"] >= split_date]

X_train = train[features]
y_train = train["demand_units"]

X_test = test[features]
y_test = test["demand_units"]

# Step 7: Train Random Forest
model = RandomForestRegressor(
    n_estimators=200,
    max_depth=8,
    random_state=42,
    n_jobs=-1
)

model.fit(X_train, y_train)

# Step 8: Evaluate predictions
predictions = model.predict(X_test)

model_mae = mean_absolute_error(
    y_test, predictions
)

# Baseline: same weekday last week
baseline_mae = mean_absolute_error(
    y_test, X_test["lag_7"]
)

print("SMARTMART ML TRAINING RESULTS")
print("-----------------------------")
print("Products:", df["product_id"].nunique())
print("Training records:", len(train))
print("Testing records:", len(test))
print("Model MAE:", round(model_mae, 2))
print("Baseline MAE:", round(baseline_mae, 2))

# Step 9: Save model
model_path = base_path / "models" / "smartmart_model.joblib"

model_path.parent.mkdir(parents=True, exist_ok=True)

joblib.dump(
    {
        "model": model,
        "features": features
    },
    model_path
)

print("Model saved successfully!")
