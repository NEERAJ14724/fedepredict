# FedPredict

**Explore U.S. airline delay patterns and try a privacy-aware federated-learning demo.**

FedPredict is a self-contained browser app built from the project’s BTS Airline Delay Cause dataset. It can be hosted as a static GitHub Pages site and opened directly from `index.html`.

## Open the app

Open `index.html` in a browser, or enable GitHub Pages for this repository (Settings → Pages → Deploy from a branch → `main` / `/(root)`). The app has no build step or package installation.

## What’s included

- Historical delay-rate trends and busy-airport comparisons.
- Monthly historical delay estimates, optionally filtered by airline and airport.
- An interactive sample-weighted FedAvg demonstration, with model JSON download and client update upload.
- A self-contained page with the data summaries embedded; it does not require a server or expose the source CSV as a download.

## Data and limitations

The supplied workbook contains 98,578 monthly airline–airport records covering 2021–2025. Delay risk is based on arrivals delayed 15 minutes or more divided by arriving flights. Average arrival delay is total arrival delay divided by arriving flights.

These are historical monthly estimates, not individual-flight predictions or a live flight feed. The federated section demonstrates averaging of summary statistics; it is not a trained LSTM–GCN model, secure aggregation, or differential privacy. Model changes are stored in the current browser when local storage is available.

