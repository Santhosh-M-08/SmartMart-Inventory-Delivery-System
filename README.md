# SmartMart – Inventory & Delivery Management System

SmartMart helps supermarket staff track stock, manage customer deliveries, and decide when to reorder products. When staff create a delivery, SmartMart records the order and updates inventory. The Stock Intelligence page combines the remaining stock with predicted daily demand to estimate how long each product will last.

## Features

| Module | What you can do |
| --- | --- |
| Dashboard | View stock alerts, recent orders, order statuses, and demand forecasts. |
| Inventory | Add and edit products, update prices and quantities, and filter products by category. |
| Orders & Delivery | Create multi-item deliveries, review order details, and update delivery status. |
| Stock Intelligence | Compare available stock with predicted demand, identify products at risk of running out, and view suggested reorder quantities. |
| AI Chatbot | Ask questions about store data, such as “How much milk is in stock?” The assistant supports a local Ollama model. |
| Expiry Management | Track product batches and expiry notifications. |

## Run locally

The commands below use Windows PowerShell. You’ll need Git, Node.js 22 or later, npm, and Python 3. The repository includes a product catalog and forecasts, so you can try the dashboard without training the model.

### 1. Clone the repository

```powershell
git clone https://github.com/Santhosh-M-08/SmartMart-Inventory-Delivery-System.git
cd SmartMart-Inventory-Delivery-System
```

### 2. Set up the database and start the API

```powershell
cd Backend
npm.cmd ci
node database/import_products.js
node database/import_predictions.js
npm.cmd start
```

Import products first because each forecast references a product ID. The setup creates the SQLite database at `Backend/database/smartmart.db`.

Keep this terminal open. Visit [the products endpoint](http://localhost:3000/api/products) to confirm that the API returns the catalog.

### 3. Start the website

Open a second terminal in the **repository root**, where `index.html` is located.

```powershell
py -m http.server 5500 --bind 127.0.0.1
```

Open [SmartMart](http://localhost:5500/login.html). For the demo login, enter any nonempty username and password. The frontend expects the API at `http://localhost:3000`.

On later visits, start the API and frontend again. The SQLite database retains your data between sessions.

## Try a sample workflow

1. Open **Inventory**, find Milk, and note its current stock.
2. In **Orders & Delivery**, select **+ New Delivery** and create an order for two units of Milk.
3. Return to **Inventory** and check that the stock decreased by two.
4. Open **Stock Intelligence** and find Milk. Compare its remaining stock, predicted daily demand, estimated days left, and suggested reorder quantity.

## How demand forecasting works

SmartMart trains a `RandomForestRegressor` on synthetic daily sales data. For each product, it uses yesterday’s demand, demand on the same weekday last week, the average demand over the previous seven days, and calendar features.

The model trains on the earliest 80% of dates and is evaluated on the latest 20%. The training script reports mean absolute error (MAE) in units and compares it with a baseline that uses demand from the same weekday last week.

Stock Intelligence uses the forecast to calculate:

- **Days of stock remaining** = current stock ÷ predicted daily demand, when demand is above zero.
- **Suggested reorder quantity** = the units needed to cover two days of lead time and two days of safety stock, after subtracting stock already available. The minimum recommendation is zero.

For example, if Bread has **125 units** in stock and predicted demand is **62 units per day**, it has about **2.02 days** of stock remaining. Four days of coverage requires 248 units, so SmartMart suggests ordering **123 units**.

### Regenerate the forecasts

Run these commands from the repository root when you want to retrain the model and refresh the stored forecasts.

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r ml/requirements.txt
.\.venv\Scripts\python.exe ml/train_model.py
.\.venv\Scripts\python.exe ml/predict.py
.\.venv\Scripts\python.exe ml/export_forecasts.py
node Backend/database/import_predictions.js
```

The prediction date is the day after the latest observation for each product. To move the forecast forward, update the sales history before regenerating predictions.

## Enable the local AI chatbot

Install Ollama and download the model configured in `js/ollama.js`.

```powershell
ollama pull qwen3:4b
```

If the Ollama service is stopped, start it in a separate terminal with `ollama serve`. The chatbot connects to `http://localhost:11434`.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express |
| Database | SQLite, better-sqlite3 |
| Demand forecasting | Python, pandas, scikit-learn |
| Local language model | Ollama, Qwen3 4B |

## Team

| Team member | Contribution |
| --- | --- |
| Santhosh Reddy M | Orders & Delivery, Stock Intelligence, demand forecasting |
| Jagadeesha | Inventory Management |
| Srujan | Dashboard, shared UI, AI chatbot |
