
import pandas as pd
from pathlib import Path
from math import ceil

base_path = Path(__file__).parent

# Load the ML predictions
predictions = pd.read_csv(
    base_path / "data" / "predictions.csv"
)

# Load historical inventory data
sales = pd.read_csv(
    base_path / "data" /
    "smartmart_synthetic_sales_12_months.csv"
)

# Find the latest recorded stock for each product
sales["date"] = pd.to_datetime(sales["date"])

latest_stock = (
    sales.sort_values("date")
    .groupby("product_id")
    .tail(1)[["product_id", "closing_stock"]]
)

# Combine predictions with available stock
df = predictions.merge(
    latest_stock,
    on="product_id",
    how="left",
    validate="one_to_one"
)

if df["closing_stock"].isna().any():
    raise ValueError("Stock data missing for some products.")

# Assume the supplier takes 2 days to deliver
lead_time = 2

# Keep 2 extra days of safety stock
safety_days = 2

results = []

for _, row in df.iterrows():

    demand = max(0, float(row["predicted_demand"]))
    stock = float(row["closing_stock"])

    if demand == 0:
        days_left = float("inf")
    else:
        days_left = stock / demand

    # Determine stock risk
    if days_left <= 1:
        status = "Critical"
    elif days_left <= 3:
        status = "Warning"
    else:
        status = "Healthy"

    # Reorder enough for lead time and safety buffer
    target_stock = demand * (lead_time + safety_days)

    reorder_quantity = max(
        0,
        ceil(target_stock - stock)
    )

    results.append({
        "product_id": int(row["product_id"]),
        "product_name": row["product_name"],
        "current_stock": int(stock),
        "predicted_demand": int(demand),
        "days_left": round(days_left, 2),
        "status": status,
        "reorder_quantity": reorder_quantity
    })

alerts = pd.DataFrame(results)

print("\nSMARTMART STOCK INTELLIGENCE")
print("-" * 85)
print(alerts.to_string(index=False))

# Save the alert report
output_path = base_path / "data" / "stock_alerts.csv"

alerts.to_csv(output_path, index=False)

print("\nStock alerts saved to:", output_path)
