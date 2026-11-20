
import pandas as pd
from pathlib import Path

# Locate our dataset
file_path = Path(__file__).parent / "data" / "smartmart_synthetic_sales_12_months.csv"

# Read the CSV file
df = pd.read_csv(file_path)

# Display the first five records
print("First 5 records:")
print(df.head())

# Check dataset dimensions
print("\nDataset shape:")
print(df.shape)

# Display all column names
print("\nColumns:")
print(df.columns.tolist())

# Display records belonging to Milk
milk_data = df[df["product_id"] == 101]

print("\nMilk sales:")
print(milk_data[["date", "product_name", "units_sold", "demand_units"]].head(10))

# Calculate average daily milk demand
average_demand = milk_data["demand_units"].mean()

print("\nAverage daily milk demand:")
print(round(average_demand, 2))
