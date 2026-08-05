document.addEventListener("DOMContentLoaded", () => {
    const fetchBtn = document.getElementById("fetch_btn");
    const statusMsg = document.getElementById("status_msg");
    const appToken = document.getElementById("app_token");
    const mapImage = document.getElementById("map_image");
    const mapPlaceholder = document.getElementById("map_placeholder");
    const latSlider = document.getElementById("selected_lat");
    const lonSlider = document.getElementById("selected_lon");
    const latVal = document.getElementById("lat_val");
    const lonVal = document.getElementById("lon_val");
    const metricMean = document.getElementById("metric_mean");
    const metricReanalysis = document.getElementById("metric_reanalysis");
    const metricObs = document.getElementById("metric_obs");
    const metricError = document.getElementById("metric_error");
    const metricObservationError = document.getElementById("metric_observation_error");
    const metricSpread = document.getElementById("metric_spread");
    const seaIceMapImage = document.getElementById("sea_ice_map_image");
    const seaIceMapPlaceholder = document.getElementById("sea_ice_map_placeholder");
    const seaIceMetricMean = document.getElementById("sea_ice_metric_mean");
    const seaIceMetricReanalysis = document.getElementById("sea_ice_metric_reanalysis");
    const seaIceMetricObservation = document.getElementById("sea_ice_metric_observation");
    const seaIceMetricReanalysisError = document.getElementById("sea_ice_metric_reanalysis_error");
    const seaIceMetricObservationError = document.getElementById("sea_ice_metric_observation_error");
    const seaIceMetricSpread = document.getElementById("sea_ice_metric_spread");

    const LOCAL_DATASETS = Object.freeze({
        "2m_temperature|2020|09": "data/monthly_2m_temperature_2020_09.json?v=3"
    });
    const LOCAL_SEA_ICE_DATASET = "data/monthly_sea_ice_cover_2020_09.json?v=2";
    const monthlyCache = new Map();
    const backendResponseCache = new Map();
    let chartInstance = null;
    let seaIceChartInstance = null;
    let activeRequest = 0;

    function selectedBackend() {
        const queryOverride = new URLSearchParams(window.location.search).get("backend");
        if (queryOverride) return queryOverride.replace(/\/$/, "");
        return document.querySelector('input[name="backend_mode"]:checked').value;
    }

    function buildPayload() {
        return {
            auth_token: appToken.value,
            variable: document.getElementById("target_var").value,
            year: document.getElementById("init_year").value,
            month: document.getElementById("init_month").value,
            lat: Number(latSlider.value),
            lon: Number(lonSlider.value)
        };
    }

    function datasetKey(payload) {
        return `${payload.variable}|${payload.year}|${payload.month}`;
    }

    function backendCacheKey(backend, payload) {
        return `${backend}|${datasetKey(payload)}|${payload.lat.toFixed(2)}|${payload.lon.toFixed(2)}`;
    }

    function setLoading(isLoading) {
        fetchBtn.disabled = isLoading;
        fetchBtn.setAttribute("aria-busy", String(isLoading));
        fetchBtn.textContent = isLoading ? "Loading real observations…" : "Fetch & Analyze";
    }

    function showStatus(message, type = "") {
        statusMsg.textContent = message;
        statusMsg.className = `status ${type}`;
    }

    async function fetchFloat32(url, expectedLength) {
        const response = await fetch(url, { cache: "force-cache" });
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== expectedLength * 4) {
            throw new Error(`${url} has ${buffer.byteLength} bytes; expected ${expectedLength * 4}`);
        }
        return new Float32Array(buffer);
    }

    function ensembleMean(forecast, members, cellCount) {
        const mean = new Float32Array(cellCount);
        for (let cell = 0; cell < cellCount; cell += 1) {
            let sum = 0;
            let count = 0;
            for (let member = 0; member < members; member += 1) {
                const value = forecast[member * cellCount + cell];
                if (Number.isFinite(value)) {
                    sum += value;
                    count += 1;
                }
            }
            mean[cell] = count ? sum / count : NaN;
        }
        return mean;
    }

    async function loadMonthlyData(metadataUrl) {
        if (monthlyCache.has(metadataUrl)) return monthlyCache.get(metadataUrl);

        const promise = (async () => {
            const metadataResponse = await fetch(metadataUrl, { cache: "force-cache" });
            if (!metadataResponse.ok) throw new Error(`${metadataUrl} returned HTTP ${metadataResponse.status}`);
            const metadata = await metadataResponse.json();
            const baseUrl = new URL(".", new URL(metadataUrl, window.location.href));
            const [members, latCount, lonCount] = metadata.forecast.shape;
            const [forecast, reanalysis, observationPayload] = await Promise.all([
                fetchFloat32(new URL(metadata.forecast.file, baseUrl), members * latCount * lonCount),
                fetchFloat32(new URL(metadata.reanalysis.file, baseUrl), latCount * lonCount),
                fetch(new URL(metadata.observations.file, baseUrl), { cache: "force-cache" }).then(response => {
                    if (!response.ok) throw new Error(`Station observations returned HTTP ${response.status}`);
                    return response.json();
                })
            ]);

            const cellCount = latCount * lonCount;
            const mean = ensembleMean(forecast, members, cellCount);

            return {
                metadata,
                forecast,
                reanalysis,
                mean,
                stations: observationPayload.rows,
                members,
                latCount,
                lonCount
            };
        })();

        monthlyCache.set(metadataUrl, promise);
        try {
            return await promise;
        } catch (error) {
            monthlyCache.delete(metadataUrl);
            throw error;
        }
    }

    async function loadSeaIceData() {
        if (monthlyCache.has(LOCAL_SEA_ICE_DATASET)) {
            return monthlyCache.get(LOCAL_SEA_ICE_DATASET);
        }

        const promise = (async () => {
            const metadataResponse = await fetch(LOCAL_SEA_ICE_DATASET, { cache: "force-cache" });
            if (!metadataResponse.ok) {
                throw new Error(`Sea-ice metadata returned HTTP ${metadataResponse.status}`);
            }
            const metadata = await metadataResponse.json();
            const baseUrl = new URL(".", new URL(LOCAL_SEA_ICE_DATASET, window.location.href));
            const [members, latCount, lonCount] = metadata.forecast.shape;
            const cellCount = latCount * lonCount;
            const [forecast, reanalysis, observation] = await Promise.all([
                fetchFloat32(new URL(metadata.forecast.file, baseUrl), members * cellCount),
                fetchFloat32(new URL(metadata.reanalysis.file, baseUrl), cellCount),
                fetchFloat32(new URL(metadata.observations.file, baseUrl), cellCount)
            ]);
            return {
                metadata,
                forecast,
                reanalysis,
                observation,
                mean: ensembleMean(forecast, members, cellCount),
                members,
                latCount,
                lonCount
            };
        })();

        monthlyCache.set(LOCAL_SEA_ICE_DATASET, promise);
        try {
            return await promise;
        } catch (error) {
            monthlyCache.delete(LOCAL_SEA_ICE_DATASET);
            throw error;
        }
    }

    function nearestIndex(values, target) {
        let bestIndex = 0;
        let bestDistance = Infinity;
        values.forEach((value, index) => {
            const distance = Math.abs(value - target);
            if (distance < bestDistance) {
                bestIndex = index;
                bestDistance = distance;
            }
        });
        return bestIndex;
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const radians = degrees => degrees * Math.PI / 180;
        const deltaLat = radians(lat2 - lat1);
        const deltaLon = radians(((lon2 - lon1 + 180) % 360) - 180);
        const a = Math.sin(deltaLat / 2) ** 2
            + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function stationForecastPoint(dataset, station) {
        const stationLat = station[2];
        const stationLon = ((station[3] % 360) + 360) % 360;
        const latIndex = nearestIndex(dataset.metadata.latitudes, stationLat);
        const lonIndex = nearestIndex(dataset.metadata.longitudes, stationLon);
        const cell = latIndex * dataset.lonCount + lonIndex;
        return { latIndex, lonIndex, cell, mean: dataset.mean[cell] };
    }

    function localPoint(dataset, payload) {
        let station = dataset.stations[0];
        let stationDistance = Infinity;
        dataset.stations.forEach(candidate => {
            const distance = haversineKm(payload.lat, payload.lon, candidate[2], candidate[3]);
            if (distance < stationDistance) {
                station = candidate;
                stationDistance = distance;
            }
        });

        const grid = stationForecastPoint(dataset, station);
        const cellCount = dataset.latCount * dataset.lonCount;
        const ensembles = [];
        for (let member = 0; member < dataset.members; member += 1) {
            ensembles.push(dataset.forecast[member * cellCount + grid.cell]);
        }
        const finite = ensembles.filter(Number.isFinite);
        const variance = finite.reduce((sum, value) => sum + (value - grid.mean) ** 2, 0) / finite.length;
        const observation = station[4];
        const reanalysis = dataset.reanalysis[grid.cell];
        return {
            ensembles,
            metrics: {
                mean: grid.mean,
                reanalysis,
                obs: observation,
                error: grid.mean - reanalysis,
                observation_error: grid.mean - observation,
                std: Math.sqrt(variance)
            },
            latIndex: grid.latIndex,
            lonIndex: grid.lonIndex,
            station,
            stationDistance
        };
    }

    function seaIcePoint(dataset, payload) {
        const longitude = ((payload.lon % 360) + 360) % 360;
        const latIndex = nearestIndex(dataset.metadata.latitudes, payload.lat);
        const lonIndex = nearestIndex(dataset.metadata.longitudes, longitude);
        const cell = latIndex * dataset.lonCount + lonIndex;
        const cellCount = dataset.latCount * dataset.lonCount;
        const ensembles = [];
        for (let member = 0; member < dataset.members; member += 1) {
            ensembles.push(dataset.forecast[member * cellCount + cell]);
        }
        const finite = ensembles.filter(Number.isFinite);
        const mean = dataset.mean[cell];
        const variance = finite.length
            ? finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length
            : NaN;
        const reanalysis = dataset.reanalysis[cell];
        const observation = dataset.observation[cell];
        return {
            ensembles,
            latIndex,
            lonIndex,
            latitude: dataset.metadata.latitudes[latIndex],
            longitude: dataset.metadata.longitudes[lonIndex],
            metrics: {
                mean,
                reanalysis,
                observation,
                reanalysisError: mean - reanalysis,
                observationError: mean - observation,
                std: Math.sqrt(variance)
            }
        };
    }

    async function loadAnalysis() {
        const requestId = ++activeRequest;
        const payload = buildPayload();
        const localUrl = LOCAL_DATASETS[datasetKey(payload)];
        setLoading(true);

        try {
            if (localUrl) {
                showStatus("Loading bundled temperature and sea-ice forecast/reference data…");
                const [dataset, seaIceDataset] = await Promise.all([
                    loadMonthlyData(localUrl),
                    loadSeaIceData()
                ]);
                if (requestId !== activeRequest) return;
                const point = localPoint(dataset, payload);
                const icePoint = seaIcePoint(seaIceDataset, payload);
                renderLocalDashboard(dataset, point);
                renderSeaIceDashboard(seaIceDataset, icePoint);
                const stationName = point.station[1] || point.station[0];
                showStatus(
                    `${stationName} station · ${point.stationDistance.toFixed(0)} km away; sea-ice grid · ${icePoint.latitude.toFixed(1)}°, ${icePoint.longitude.toFixed(1)}°`,
                    "success"
                );
                return;
            }

            clearSeaIceDashboard();
            showStatus("Not bundled locally; requesting the backend…");
            const backend = selectedBackend();
            const key = backendCacheKey(backend, payload);
            if (backendResponseCache.has(key)) {
                renderBackendDashboard(backendResponseCache.get(key));
                showStatus("Loaded from the browser's backend-response cache.", "success");
                return;
            }
            const response = await fetch(`${backend}/analyze`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
            const data = await response.json();
            if (requestId !== activeRequest) return;
            backendResponseCache.set(key, data);
            renderBackendDashboard(data);
            const station = data.observation;
            showStatus(
                `${station.station_name || station.station_id} · ${station.distance_from_requested_km.toFixed(0)} km from requested point`,
                "success"
            );
        } catch (error) {
            if (requestId === activeRequest) showStatus(error.message, "error");
        } finally {
            if (requestId === activeRequest) setLoading(false);
        }
    }

    function renderMetricsAndChart(point) {
        metricMean.textContent = point.metrics.mean.toFixed(4);
        metricReanalysis.textContent = point.metrics.reanalysis.toFixed(4);
        metricObs.textContent = point.metrics.obs.toFixed(4);
        metricError.textContent = point.metrics.error.toFixed(4);
        metricObservationError.textContent = point.metrics.observation_error.toFixed(4);
        metricSpread.textContent = `±${point.metrics.std.toFixed(4)}`;
        drawChart(point.ensembles, point.metrics.mean, point.metrics.reanalysis, point.metrics.obs);
    }

    function renderLocalDashboard(dataset, point) {
        mapImage.src = renderMaps(dataset, point);
        mapImage.style.display = "block";
        mapPlaceholder.style.display = "none";
        renderMetricsAndChart(point);
    }

    function formatPercent(value, signed = false) {
        if (!Number.isFinite(value)) return "No data";
        const prefix = signed && value > 0 ? "+" : "";
        return `${prefix}${value.toFixed(2)}%`;
    }

    function renderSeaIceDashboard(dataset, point) {
        seaIceMapImage.src = renderSeaIceMaps(dataset, point);
        seaIceMapImage.style.display = "block";
        seaIceMapPlaceholder.style.display = "none";
        seaIceMetricMean.textContent = formatPercent(point.metrics.mean);
        seaIceMetricReanalysis.textContent = formatPercent(point.metrics.reanalysis);
        seaIceMetricObservation.textContent = formatPercent(point.metrics.observation);
        seaIceMetricReanalysisError.textContent = formatPercent(point.metrics.reanalysisError, true);
        seaIceMetricObservationError.textContent = formatPercent(point.metrics.observationError, true);
        seaIceMetricSpread.textContent = Number.isFinite(point.metrics.std)
            ? `±${point.metrics.std.toFixed(2)}%`
            : "No data";
        drawSeaIceChart(point);
    }

    function clearSeaIceDashboard() {
        seaIceMapImage.style.display = "none";
        seaIceMapPlaceholder.style.display = "flex";
        seaIceMapPlaceholder.querySelector("p").textContent = "Sea-ice data is currently bundled for September 2020.";
        [
            seaIceMetricMean,
            seaIceMetricReanalysis,
            seaIceMetricObservation,
            seaIceMetricReanalysisError,
            seaIceMetricObservationError,
            seaIceMetricSpread
        ].forEach(element => { element.textContent = "--"; });
        if (seaIceChartInstance) {
            seaIceChartInstance.destroy();
            seaIceChartInstance = null;
        }
    }

    function renderBackendDashboard(data) {
        mapImage.src = `data:image/png;base64,${data.image_b64}`;
        mapImage.style.display = "block";
        mapPlaceholder.style.display = "none";
        renderMetricsAndChart(data);
    }

    function finitePercentile(values, percentile) {
        const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
        if (!finite.length) return NaN;
        return finite[Math.round((finite.length - 1) * percentile)];
    }

    function color(value, minimum, maximum, divergent = false, palette = "temperature") {
        if (!Number.isFinite(value)) return [15, 23, 42, 255];
        const scaled = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum || 1)));
        const stops = divergent
            ? [[33, 102, 172], [247, 247, 247], [178, 24, 43]]
            : palette === "ice"
                ? [[8, 47, 73], [56, 189, 248], [248, 250, 252]]
                : [[49, 54, 149], [255, 255, 191], [165, 0, 38]];
        const section = scaled < 0.5 ? 0 : 1;
        const mix = section === 0 ? scaled * 2 : (scaled - 0.5) * 2;
        return [0, 1, 2]
            .map(channel => Math.round(stops[section][channel] * (1 - mix) + stops[section + 1][channel] * mix))
            .concat(255);
    }

    function fieldCanvas(values, rows, columns, minimum, maximum, divergent = false, palette = "temperature") {
        const canvas = document.createElement("canvas");
        canvas.width = columns;
        canvas.height = rows;
        const context = canvas.getContext("2d");
        const image = context.createImageData(columns, rows);
        for (let index = 0; index < values.length; index += 1) {
            image.data.set(color(values[index], minimum, maximum, divergent, palette), index * 4);
        }
        context.putImageData(image, 0, 0);
        return canvas;
    }

    function renderMaps(dataset, point) {
        const difference = new Float32Array(dataset.mean.length);
        for (let index = 0; index < difference.length; index += 1) {
            difference[index] = dataset.mean[index] - dataset.reanalysis[index];
        }
        const combined = new Float32Array(dataset.mean.length + dataset.reanalysis.length);
        combined.set(dataset.mean);
        combined.set(dataset.reanalysis, dataset.mean.length);
        const temperatureMin = finitePercentile(combined, 0.01);
        const temperatureMax = finitePercentile(combined, 0.99);
        const errorLimit = Math.max(
            Math.abs(finitePercentile(difference, 0.01)),
            Math.abs(finitePercentile(difference, 0.99)),
            0.001
        );
        const panels = [
            [dataset.mean, "C3S seasonal forecast (ensemble mean)", temperatureMin, temperatureMax, false],
            [dataset.reanalysis, "ERA5 reanalysis (assimilated analysis)", temperatureMin, temperatureMax, false],
            [difference, "Forecast − ERA5 error", -errorLimit, errorLimit, true]
        ];

        const canvas = document.createElement("canvas");
        canvas.width = 1500;
        canvas.height = 500;
        const context = canvas.getContext("2d");
        context.fillStyle = "#0f172a";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const panelWidth = 460;
        const panelHeight = 360;
        const top = 65;

        panels.forEach(([values, title, minimum, maximum, divergent], panelIndex) => {
            const left = 25 + panelIndex * 495;
            const field = fieldCanvas(
                values,
                dataset.latCount,
                dataset.lonCount,
                minimum,
                maximum,
                divergent
            );
            context.imageSmoothingEnabled = true;
            context.drawImage(field, left, top, panelWidth, panelHeight);
            context.fillStyle = "#f8fafc";
            context.font = "600 21px Inter, sans-serif";
            context.textAlign = "center";
            context.fillText(title, left + panelWidth / 2, 38);

            context.strokeStyle = "#84cc16";
            context.lineWidth = 3;
            const selectedX = left + point.lonIndex / (dataset.lonCount - 1) * panelWidth;
            const selectedY = top + point.latIndex / (dataset.latCount - 1) * panelHeight;
            context.beginPath();
            context.moveTo(selectedX - 9, selectedY);
            context.lineTo(selectedX + 9, selectedY);
            context.moveTo(selectedX, selectedY - 9);
            context.lineTo(selectedX, selectedY + 9);
            context.stroke();

            context.font = "15px Inter, sans-serif";
            context.fillStyle = "#94a3b8";
            context.textAlign = "left";
            context.fillText(`${minimum.toFixed(1)} °C`, left, 455);
            context.textAlign = "right";
            context.fillText(`${maximum.toFixed(1)} °C`, left + panelWidth, 455);
        });
        return canvas.toDataURL("image/png");
    }

    function renderSeaIceMaps(dataset, point) {
        const forecastMinusObservation = new Float32Array(dataset.mean.length);
        for (let index = 0; index < forecastMinusObservation.length; index += 1) {
            forecastMinusObservation[index] = dataset.mean[index] - dataset.observation[index];
        }
        const errorLimit = Math.max(
            Math.abs(finitePercentile(forecastMinusObservation, 0.01)),
            Math.abs(finitePercentile(forecastMinusObservation, 0.99)),
            1
        );
        const panels = [
            [dataset.mean, "C3S forecast (51-member mean)", 0, 100, false, "ice"],
            [dataset.reanalysis, "ERA5 reanalysis", 0, 100, false, "ice"],
            [dataset.observation, "OSI SAF satellite-derived CDR", 0, 100, false, "ice"],
            [forecastMinusObservation, "Forecast − OSI SAF error", -errorLimit, errorLimit, true, "temperature"]
        ];

        const canvas = document.createElement("canvas");
        canvas.width = 1500;
        canvas.height = 650;
        const context = canvas.getContext("2d");
        context.fillStyle = "#0f172a";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const panelWidth = 700;
        const panelHeight = 190;

        panels.forEach(([values, title, minimum, maximum, divergent, palette], panelIndex) => {
            const column = panelIndex % 2;
            const row = Math.floor(panelIndex / 2);
            const left = 25 + column * 745;
            const top = 60 + row * 295;
            const field = fieldCanvas(
                values,
                dataset.latCount,
                dataset.lonCount,
                minimum,
                maximum,
                divergent,
                palette
            );
            context.imageSmoothingEnabled = true;
            context.drawImage(field, left, top, panelWidth, panelHeight);
            context.fillStyle = "#f8fafc";
            context.font = "600 21px Inter, sans-serif";
            context.textAlign = "center";
            context.fillText(title, left + panelWidth / 2, top - 20);

            context.strokeStyle = "#84cc16";
            context.lineWidth = 3;
            const selectedX = left + point.lonIndex / (dataset.lonCount - 1) * panelWidth;
            const selectedY = top + point.latIndex / (dataset.latCount - 1) * panelHeight;
            context.beginPath();
            context.moveTo(selectedX - 9, selectedY);
            context.lineTo(selectedX + 9, selectedY);
            context.moveTo(selectedX, selectedY - 9);
            context.lineTo(selectedX, selectedY + 9);
            context.stroke();

            context.font = "15px Inter, sans-serif";
            context.fillStyle = "#94a3b8";
            context.textAlign = "left";
            context.fillText(`${minimum.toFixed(0)}%`, left, top + panelHeight + 25);
            context.textAlign = "right";
            context.fillText(`${maximum.toFixed(0)}%`, left + panelWidth, top + panelHeight + 25);
        });

        context.font = "13px Inter, sans-serif";
        context.fillStyle = "#94a3b8";
        context.textAlign = "right";
        context.fillText("OSI SAF data: Copyright 2020 EUMETSAT", 1470, 630);
        return canvas.toDataURL("image/png");
    }

    function drawChart(ensembles, mean, reanalysis, observation) {
        if (typeof Chart === "undefined") return;
        const context = document.getElementById("ensembleChart").getContext("2d");
        if (chartInstance) chartInstance.destroy();
        const jitteredMembers = ensembles.map((value, index) => ({ x: value, y: ((index % 11) - 5) / 100 }));
        chartInstance = new Chart(context, {
            type: "scatter",
            data: {
                datasets: [
                    { label: `${ensembles.length} C3S ensemble members`, data: jitteredMembers, backgroundColor: "rgba(59, 130, 246, 0.6)", pointRadius: 6 },
                    { label: "Ensemble mean", data: [{ x: mean, y: 0 }], backgroundColor: "#ef4444", pointRadius: 10, pointStyle: "rect" },
                    { label: "ERA5 reanalysis", data: [{ x: reanalysis, y: 0 }], backgroundColor: "#a855f7", pointRadius: 11, pointStyle: "circle" },
                    { label: "Measured station temperature", data: [{ x: observation, y: 0 }], backgroundColor: "#10b981", pointRadius: 12, pointStyle: "triangle", rotation: 180 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { display: false, min: -0.2, max: 0.2 },
                    x: {
                        title: { display: true, text: "Monthly air temperature (°C)", color: "#94a3b8" },
                        grid: { color: "rgba(255, 255, 255, 0.1)" },
                        ticks: { color: "#94a3b8" }
                    }
                }
            }
        });
    }

    function drawSeaIceChart(point) {
        if (typeof Chart === "undefined") return;
        const context = document.getElementById("seaIceEnsembleChart").getContext("2d");
        if (seaIceChartInstance) seaIceChartInstance.destroy();
        const finiteMembers = point.ensembles.filter(Number.isFinite);
        const jitteredMembers = finiteMembers.map((value, index) => ({
            x: value,
            y: ((index % 11) - 5) / 100
        }));
        const datasets = [
            { label: `${finiteMembers.length} C3S ensemble members`, data: jitteredMembers, backgroundColor: "rgba(59, 130, 246, 0.6)", pointRadius: 6 },
            { label: "C3S ensemble mean", data: [{ x: point.metrics.mean, y: 0 }], backgroundColor: "#ef4444", pointRadius: 10, pointStyle: "rect" }
        ];
        if (Number.isFinite(point.metrics.reanalysis)) {
            datasets.push({ label: "ERA5 reanalysis", data: [{ x: point.metrics.reanalysis, y: 0 }], backgroundColor: "#a855f7", pointRadius: 11, pointStyle: "circle" });
        }
        if (Number.isFinite(point.metrics.observation)) {
            datasets.push({ label: "OSI SAF satellite-derived CDR", data: [{ x: point.metrics.observation, y: 0 }], backgroundColor: "#10b981", pointRadius: 12, pointStyle: "triangle", rotation: 180 });
        }
        seaIceChartInstance = new Chart(context, {
            type: "scatter",
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { display: false, min: -0.2, max: 0.2 },
                    x: {
                        title: { display: true, text: "Monthly sea-ice concentration (%)", color: "#94a3b8" },
                        grid: { color: "rgba(255, 255, 255, 0.1)" },
                        ticks: { color: "#94a3b8", stepSize: 10 },
                        min: 0,
                        max: 100
                    }
                }
            }
        });
    }

    latSlider.addEventListener("input", event => { latVal.textContent = Number(event.target.value).toFixed(1); });
    lonSlider.addEventListener("input", event => { lonVal.textContent = Number(event.target.value).toFixed(1); });
    latSlider.addEventListener("change", loadAnalysis);
    lonSlider.addEventListener("change", loadAnalysis);
    fetchBtn.addEventListener("click", loadAnalysis);
    document.querySelectorAll('input[name="backend_mode"]').forEach(input => input.addEventListener("change", loadAnalysis));
    ["target_var", "init_year", "init_month"].forEach(id => document.getElementById(id).addEventListener("change", loadAnalysis));

    loadAnalysis();
});
