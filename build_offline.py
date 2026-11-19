"""Build a single-file FedPredict page that works from file:// without a server."""
import json
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).parent
df = pd.read_csv(ROOT / "data" / "flight_delay.csv")
carriers = sorted({(str(r.carrier), str(r.carrier_name)) for r in df.itertuples()})
airports = sorted({(str(r.airport), str(r.airport_name)) for r in df.itertuples()})
carrier_ix = {code: i for i, (code, _) in enumerate(carriers)}
airport_ix = {code: i for i, (code, _) in enumerate(airports)}
cols = ["arr_flights", "arr_del15", "arr_cancelled", "arr_delay", "carrier_delay", "weather_delay", "nas_delay", "late_aircraft_delay"]
groups = df.groupby(["carrier", "airport", "month"], sort=True)[cols].sum().reset_index()
rows = [[carrier_ix[r.carrier], airport_ix[r.airport], int(r.month), *[round(float(getattr(r, c)), 2) for c in cols]] for r in groups.itertuples()]
flights = float(df.arr_flights.sum())
delayed = float(df.arr_del15.sum())
data = {"records": int(len(df)), "flights": flights, "delayed": delayed,
        "rate": delayed / flights, "minutes": float(df.arr_delay.sum()) / flights,
        "carriers": carriers, "airports": airports, "rows": rows}

page = (ROOT / "index.html").read_text(encoding="utf-8")
page = page.replace('<link rel="stylesheet" href="/styles.css">', '<style>\n' + (ROOT / "styles.css").read_text(encoding="utf-8").replace("@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');", "") + '\n</style>')
page = page.replace('href="/api/federated/model"', 'href="#" id="global-model-download"')
page = page.replace('<script src="/app.js" defer></script>', '<script>const DATA=' + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ';</script>\n<script>\n' + (ROOT / "offline.js").read_text(encoding="utf-8") + '\n</script>')
(ROOT / "FedPredict.html").write_text(page, encoding="utf-8")
print(f"Created {ROOT / 'FedPredict.html'} ({(ROOT / 'FedPredict.html').stat().st_size:,} bytes)")

