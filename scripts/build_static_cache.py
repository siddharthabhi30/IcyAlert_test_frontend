#!/usr/bin/env python3
"""Convert the real monthly NetCDF files into browser-readable Float32 grids."""

from __future__ import annotations

import argparse
import hashlib
import json
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
        values = np.asarray(np.ma.filled(dataset.variables["t2m"][:], np.nan), dtype=np.float32).squeeze()
        latitudes = np.asarray(dataset.variables["latitude"][:], dtype=np.float64)
        longitudes = np.asarray(dataset.variables["longitude"][:], dtype=np.float64)
    return values, latitudes, longitudes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--forecast", type=Path, required=True)
    parser.add_argument("--observation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    forecast, latitudes, longitudes = read_grid(args.forecast)
    observation, observation_latitudes, observation_longitudes = read_grid(args.observation)

    if forecast.ndim != 3 or observation.ndim != 2:
        raise ValueError(f"Unexpected shapes: forecast={forecast.shape}, observation={observation.shape}")

    latitude_indices = np.abs(observation_latitudes[:, None] - latitudes[None, :]).argmin(axis=0)
    longitude_indices = np.abs(observation_longitudes[:, None] - longitudes[None, :]).argmin(axis=0)
    latitude_error = float(np.max(np.abs(observation_latitudes[latitude_indices] - latitudes)))
    longitude_error = float(np.max(np.abs(observation_longitudes[longitude_indices] - longitudes)))
    if latitude_error > 1e-6 or longitude_error > 1e-6:
        raise ValueError(
            "ERA5 does not contain the exact C3S grid coordinates: "
            f"latitude error={latitude_error}, longitude error={longitude_error}"
        )

    # Both products are temperature in kelvin. Store Celsius to keep browser work simple.
    forecast_celsius = np.ascontiguousarray(forecast - np.float32(273.15), dtype="<f4")
    observation_on_forecast_grid = np.ascontiguousarray(
        observation[np.ix_(latitude_indices, longitude_indices)] - np.float32(273.15),
        dtype="<f4",
    )

    args.output.mkdir(parents=True, exist_ok=True)
    forecast_name = "c3s_2m_temperature_2020_09.f32"
    observation_name = "era5_2m_temperature_2020_09_on_c3s_grid.f32"
    forecast_path = args.output / forecast_name
    observation_path = args.output / observation_name
    forecast_celsius.tofile(forecast_path)
    observation_on_forecast_grid.tofile(observation_path)

    metadata = {
        "schemaVersion": 1,
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
        "reference": {
            "label": "ERA5 monthly reanalysis on the exact C3S grid",
            "file": observation_name,
            "shape": list(observation_on_forecast_grid.shape),
            "sha256": sha256(observation_path),
        },
        "latitudes": latitudes.tolist(),
        "longitudes": longitudes.tolist(),
        "gridAlignment": {
            "method": "exact coordinate subset",
            "maximumLatitudeDifferenceDegrees": latitude_error,
            "maximumLongitudeDifferenceDegrees": longitude_error,
        },
    }
    metadata_path = args.output / "monthly_2m_temperature_2020_09.json"
    metadata_path.write_text(json.dumps(metadata, separators=(",", ":")) + "\n", encoding="utf-8")

    print(f"Wrote {forecast_path} ({forecast_path.stat().st_size} bytes)")
    print(f"Wrote {observation_path} ({observation_path.stat().st_size} bytes)")
    print(f"Wrote {metadata_path} ({metadata_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
