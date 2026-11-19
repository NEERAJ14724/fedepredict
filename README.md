# FedPredict

A public-facing exploration app for the supplied BTS Airline Delay Cause data, with an instant historical cohort estimate and an interactive federated averaging demonstration.

## Start locally

Requires Node.js 20 or newer. No packages are needed.

On Windows, double-click `Start FedPredict.bat` and keep its window open while you use the app. The server prints the exact local address it chose.

For the simplest launch, open `FedPredict.html` directly in Edge or Chrome. This single-file version bundles the historical summaries and runs without Node or a server. Its demo model updates are saved in that browser when local storage is available.

```powershell
npm start
```

Open `http://localhost:3000`. Set `PORT` to use a different port.

## What it does

- Reads the supplied `FINAL DATA FOR PROJECT.xlsx`, converted to `data/flight_delay.csv` for a small, dependency-free Node server.
- Shows dataset counts, a month-of-year delay rate, and high-volume airports.
- Estimates historical delay probability for a selected month and optional airline/airport. Delay probability is based on arrivals delayed 15+ minutes divided by arriving flights. Average minutes is total arrival delay divided by arrivals.
- Exposes a JSON prediction endpoint at `POST /api/predict` and dataset metadata at `GET /api/overview`.
- Lets a demo client submit aggregate sample count, delay probability, and mean delay minutes. The server combines those values using sample-weighted averaging and serves the current snapshot at `GET /api/federated/model`.
- Includes a `render.yaml` service blueprint and a sample client update JSON file.

## Training the repository model

The training script is [`train_model.py`](train_model.py). It trains a scikit-learn MLP regressor to estimate the delayed-arrival share (`arr_del15 / arr_flights`) from BTS monthly aggregate records. It holds out the latest year for evaluation and saves `artifacts/delay_rate_mlp.joblib` and `artifacts/metrics.json`.

```powershell
python -m pip install -r requirements.txt
python train_model.py --data "path/to/FINAL DATA FOR PROJECT.xlsx"
```

This is a monthly cohort model, not a model for an individual flight or a live prediction feed. It is separate from the browser app's historical-rate estimate and federated averaging demo. The model artifact is generated locally and is ignored by Git.

The Colab's original regression experiment is transcribed in [`notebooks/colab_regression_training.py`](notebooks/colab_regression_training.py). Run it with `python notebooks/colab_regression_training.py --data path/to/data.csv`. It trains nine regressors and saves `artifacts/best_flight_delay_r1_model.pkl`.

That original experiment predicts `arr_delay` using `weather_delay`, `nas_delay`, `security_delay`, and `late_aircraft_delay`, which are components of the target. Its random row split also does not test future dates. The reported test R² near 0.984 is therefore leakage-inflated and should not be treated as real-world predictive performance. The cleaner `train_model.py` workflow above predicts monthly delay rate and holds out the latest year.

The Colab itself contains many repeated experiments and app cells. A full `.ipynb` export was not saved locally, so this repository contains the extracted regression training workflow plus the complete app source, rather than a verbatim copy of every Colab cell. Other Colab sections refer to model checkpoints and files that were missing when their app cells ran.

## Data and model limits

The dataset has 98,578 monthly airline-airport records (2021–2025), not flight-level observations or a live feed. The estimate is retrospective and monthly; it cannot predict an individual flight or use current weather, ATC, aircraft rotation, or live status. The interactive federated step demonstrates weighted averaging of client summaries. It does not implement a trained LSTM-GCN, secure aggregation, differential privacy, or production client authentication. Demo model updates live in process memory and reset when the server restarts.

The source dataset is the BTS Airline Delay Cause data supplied with the project. The app does not expose the CSV as a static download, and the raw workbook/CSV is not committed to this repository.

## Deployment

The project is a self-contained Node web service and can run on a Node hosting service. `PORT` is read from the environment. `render.yaml` defines a Render web service and health check; connect this repository to a Render account and deploy the blueprint to publish it. Public deployment still needs a hosting account and a destination controlled by the project owner.

