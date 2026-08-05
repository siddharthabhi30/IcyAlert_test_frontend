#!/usr/bin/env python3
"""Build the browser cache from C3S NetCDF and CDS station observations."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path

import numpy as np
from netCDF4 import Dataset


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_grid(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with Dataset(path) as dataset:
        values = np.asarray(
            np.ma.filled(dataset.variables["t2m"][:], np.nan),
            dtype=np.float32,
        ).squeeze()
        latitudes = np.asarray(dataset.variables["latitude"][:], dtype=np.float64)
        longitudes = np.asarray(dataset.variables["longitude"][:], dtype=np.float64)
    return values, latitudes, longitudes


def read_stations(path: Path) -> list[list[object]]:
    stations: dict[tuple[str, float, float], tuple[str, list[float]]] = {}
    with zipfile.ZipFile(path) as archive:
        csv_name = next(name for name in archive.namelist() if name.endswith(".csv"))
        stream = io.TextIOWrapper(archive.open(csv_name), encoding="utf-8-sig")
        reader = csv.DictReader(line for line in stream if not line.startswith("#"))
        for row in reader:
            if row["value_significance"] != "2" or row["quality_flag"] != "0":
                continue
            latitude = float(row["latitude"])
            longitude = float(row["longitude"])
            temperature = float(row["observation_value"])
            if row["units"].lower() in {"k", "kelvin"}:
                temperature -= 273.15
            station_id = row["primary_station_id"]
            key = (station_id, latitude, longitude)
            stations.setdefault(key, (row["station_name"].strip(), []))[1].append(temperature)

    return [
        [station_id, name, latitude, longitude, round(float(np.mean(values)), 4)]
        for (station_id, latitude, longitude), (name, values) in stations.items()
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--forecast", type=Path, required=True)
    parser.add_argument("--reanalysis", type=Path, required=True)
    parser.add_argument("--observations", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    forecast, latitudes, longitudes = read_grid(args.forecast)
    reanalysis, reanalysis_latitudes, reanalysis_longitudes = read_grid(args.reanalysis)
    stations = read_stations(args.observations)
    if forecast.ndim != 3:
        raise ValueError(f"Unexpected forecast shape: {forecast.shape}")
    if reanalysis.ndim != 2:
        raise ValueError(f"Unexpected reanalysis shape: {reanalysis.shape}")

    latitude_indices = np.abs(reanalysis_latitudes[:, None] - latitudes[None, :]).argmin(axis=0)
    longitude_indices = np.abs(reanalysis_longitudes[:, None] - longitudes[None, :]).argmin(axis=0)
    forecast_celsius = np.ascontiguousarray(forecast - np.float32(273.15), dtype="<f4")
    reanalysis_celsius = np.ascontiguousarray(
        reanalysis[np.ix_(latitude_indices, longitude_indices)] - np.float32(273.15),
        dtype="<f4",
    )

    args.output.mkdir(parents=True, exist_ok=True)
    forecast_name = "c3s_2m_temperature_2020_09.f32"
    reanalysis_name = "era5_2m_temperature_2020_09_on_c3s_grid.f32"
    stations_name = "insitu_land_air_temperature_2020_09_arctic.json"
    forecast_path = args.output / forecast_name
    reanalysis_path = args.output / reanalysis_name
    stations_path = args.output / stations_name
    forecast_celsius.tofile(forecast_path)
    reanalysis_celsius.tofile(reanalysis_path)
    stations_path.write_text(
        json.dumps(
            {
                "columns": ["station_id", "station_name", "latitude", "longitude", "temperature_celsius"],
                "rows": stations,
            },
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )

    metadata = {
        "schemaVersion": 2,
        "variable": "2m_temperature",
        "year": "2020",
        "month": "09",
        "units": "degC",
        "forecast": {
            "label": "C3S ECMWF System 51 monthly ensemble",
            "file": forecast_name,
            "shape": list(forecast_celsius.shape),
            "sha256": sha256(forecast_path),
        },
        "reanalysis": {
            "label": "ERA5 monthly reanalysis on the C3S grid",
            "file": reanalysis_name,
            "shape": list(reanalysis_celsius.shape),
            "sha256": sha256(reanalysis_path),
        },
        "observations": {
            "label": "CDS monthly land-station air temperatures",
            "dataset": "insitu-observations-surface-land",
            "file": stations_name,
            "count": len(stations),
            "sha256": sha256(stations_path),
        },
        "latitudes": latitudes.tolist(),
        "longitudes": longitudes.tolist(),
        "collocation": "nearest C3S grid cell to each station",
    }
    metadata_path = args.output / "monthly_2m_temperature_2020_09.json"
    metadata_path.write_text(json.dumps(metadata, separators=(",", ":")) + "\n", encoding="utf-8")

    print(f"Wrote {forecast_path} ({forecast_path.stat().st_size} bytes)")
    print(f"Wrote {reanalysis_path} ({reanalysis_path.stat().st_size} bytes)")
    print(f"Wrote {stations_path} ({stations_path.stat().st_size} bytes, {len(stations)} stations)")
    print(f"Wrote {metadata_path} ({metadata_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
