"""Transcription of the regression training cells in the supplied Colab.

Run from the repository root:
    python notebooks/colab_regression_training.py --data path/to/data.csv

This preserves the Colab experiment for reference. Its target (arr_delay) is
directly composed of several input delay-cause fields, so its scores are
leakage-inflated and must not be used as evidence of real predictive ability.
Use ../train_model.py for the repository's separate monthly delay-rate model.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import ElasticNet, Lasso, LinearRegression, Ridge
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.svm import SVR
from sklearn.tree import DecisionTreeRegressor


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="Colab dataset CSV")
    parser.add_argument("--out", type=Path, default=Path("artifacts"))
    args = parser.parse_args()

    data = pd.read_csv(args.data).dropna()
    features = [
        "arr_flights", "arr_cancelled", "arr_diverted", "weather_delay",
        "nas_delay", "security_delay", "late_aircraft_delay",
    ]
    X = data[features]
    y = data["arr_delay"]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    models = {
        "Linear Regression": LinearRegression(),
        "Ridge Regression": Ridge(alpha=1.0),
        "Lasso Regression": Lasso(alpha=0.1),
        "ElasticNet Regression": ElasticNet(alpha=0.1, l1_ratio=0.5),
        "Decision Tree": DecisionTreeRegressor(random_state=42),
        "Random Forest": RandomForestRegressor(n_estimators=100, random_state=42),
        "Gradient Boosting": GradientBoostingRegressor(n_estimators=100, random_state=42),
        "Support Vector Regression": SVR(kernel="rbf"),
        "Neural Network (MLP)": MLPRegressor(
            hidden_layer_sizes=(64, 32), max_iter=500, random_state=42
        ),
    }

    results = {}
    for name, model in models.items():
        model.fit(X_train, y_train)
        train_pred = model.predict(X_train)
        test_pred = model.predict(X_test)
        all_pred = model.predict(X)
        results[name] = {
            "Train MSE": mean_squared_error(y_train, train_pred),
            "Test MSE": mean_squared_error(y_test, test_pred),
            "Overall MSE": mean_squared_error(y, all_pred),
            "Train R²": r2_score(y_train, train_pred),
            "Test R²": r2_score(y_test, test_pred),
            "Overall R²": r2_score(y, all_pred),
        }

    results_df = pd.DataFrame(results).T
    print(results_df.sort_values(by="Test R²", ascending=False))
    best_model_name = results_df["Test R²"].idxmax()
    best_model = models[best_model_name]
    args.out.mkdir(parents=True, exist_ok=True)
    model_path = args.out / "best_flight_delay_r1_model.pkl"
    joblib.dump(best_model, model_path)
    print(f"Best model: {best_model_name}")
    print(f"Model saved to: {model_path}")


if __name__ == "__main__":
    main()

