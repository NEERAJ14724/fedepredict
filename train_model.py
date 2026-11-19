"""Train and evaluate a flight-delay-rate model on BTS monthly aggregates.

This predicts the share of monthly arrivals delayed by 15+ minutes for an
airline/airport/month cohort. It is not an individual-flight or live model.
The latest year is held out for a chronological evaluation.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

NUMERIC = ["year", "month", "log_arr_flights"]
CATEGORICAL = ["carrier", "airport"]
REQUIRED = [*NUMERIC[:2], *CATEGORICAL, "arr_flights", "arr_del15"]


def load_data(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in {".xlsx", ".xls"}:
        frame = pd.read_excel(path)
    else:
        frame = pd.read_csv(path)
    missing = sorted(set(REQUIRED) - set(frame.columns))
    if missing:
        raise ValueError(f"Dataset is missing columns: {', '.join(missing)}")
    frame = frame.dropna(subset=REQUIRED).copy()
    frame = frame.loc[frame["arr_flights"] > 0]
    frame["log_arr_flights"] = np.log1p(frame["arr_flights"].clip(lower=0))
    frame["delay_rate"] = (frame["arr_del15"] / frame["arr_flights"]).clip(0, 1)
    return frame


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="BTS CSV or XLSX file")
    parser.add_argument("--out", type=Path, default=Path("artifacts"), help="Output directory")
    args = parser.parse_args()

    data = load_data(args.data)
    test_year = int(data["year"].max())
    train = data.loc[data["year"] < test_year]
    test = data.loc[data["year"] == test_year]
    if train.empty or test.empty:
        raise ValueError("Need at least two years of data for a chronological holdout.")

    prep = ColumnTransformer([
        ("numeric", StandardScaler(), NUMERIC),
        ("categorical", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
    ])
    pipeline = Pipeline([
        ("features", prep),
        ("regressor", MLPRegressor(
            hidden_layer_sizes=(64, 32), activation="relu", solver="adam",
            alpha=0.001, learning_rate_init=0.001, max_iter=300,
            early_stopping=True, validation_fraction=0.1,
            n_iter_no_change=20, random_state=42,
        )),
    ])

    x_train, y_train = train[NUMERIC + CATEGORICAL], train["delay_rate"]
    x_test, y_test = test[NUMERIC + CATEGORICAL], test["delay_rate"]
    pipeline.fit(x_train, y_train)
    predicted = np.clip(pipeline.predict(x_test), 0, 1)
    metrics = {
        "target": "arr_del15 / arr_flights",
        "target_description": "Share of monthly arriving flights delayed 15 or more minutes",
        "test_year": test_year,
        "train_rows": int(len(train)),
        "test_rows": int(len(test)),
        "mae": float(mean_absolute_error(y_test, predicted)),
        "rmse": float(np.sqrt(mean_squared_error(y_test, predicted))),
        "r2": float(r2_score(y_test, predicted)),
        "features": NUMERIC + CATEGORICAL,
        "excluded_outcome_features": [
            "arr_delay", "carrier_delay", "weather_delay", "nas_delay",
            "security_delay", "late_aircraft_delay", "arr_del15",
        ],
    }

    args.out.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, args.out / "delay_rate_mlp.joblib")
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))
    print(f"Saved model: {args.out / 'delay_rate_mlp.joblib'}")


if __name__ == "__main__":
    main()

