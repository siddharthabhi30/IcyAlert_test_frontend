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
    const metricObs = document.getElementById("metric_obs");
    const metricError = document.getElementById("metric_error");
    const metricSpread = document.getElementById("metric_spread");

    const LOCAL_DATASETS = Object.freeze({
        "2m_temperature|2020|09": "data/monthly_2m_temperature_2020_09.json"
    });

    // Promise caching prevents duplicate downloads while a dataset is still loading.
    const monthlyGridCache = new Map();
    const backendResponseCache = new Map();
    let chartInstance = null;
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
        fetchBtn.textContent = isLoading ? "Loading real monthly data…" : "Fetch & Analyze";
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

    async function loadMonthlyGrid(metadataUrl) {
        if (monthlyGridCache.has(metadataUrl)) return monthlyGridCache.get(metadataUrl);

        const promise = (async () => {
            const metadataResponse = await fetch(metadataUrl, { cache: "force-cache" });
            if (!metadataResponse.ok) throw new Error(`${metadataUrl} returned HTTP ${metadataResponse.status}`);
            const metadata = await metadataResponse.json();
            const baseUrl = new URL(".", new URL(metadataUrl, window.location.href));
            const [members, latCount, lonCount] = metadata.forecast.shape;
            const forecastLength = members * latCount * lonCount;
            const referenceLength = latCount * lonCount;
            const [forecast, reference] = await Promise.all([
                fetchFloat32(new URL(metadata.forecast.file, baseUrl), forecastLength),
                fetchFloat32(new URL(metadata.reference.file, baseUrl), referenceLength)
            ]);

            const mean = new Float32Array(referenceLength);
            for (let cell = 0; cell < referenceLength; cell += 1) {
                let sum = 0;
                let count = 0;
                for (let member = 0; member < members; member += 1) {
                    const value = forecast[member * referenceLength + cell];
                    if (Number.isFinite(value)) {
                        sum += value;
                        count += 1;
                    }
                }
                mean[cell] = count ? sum / count : NaN;
            }
            return { metadata, forecast, reference, mean, members, latCount, lonCount };
        })();

        monthlyGridCache.set(metadataUrl, promise);
        try {
            return await promise;
        } catch (error) {
            monthlyGridCache.delete(metadataUrl);
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

    function localPoint(dataset, payload) {
        const longitude = ((payload.lon % 360) + 360) % 360;
        const latIndex = nearestIndex(dataset.metadata.latitudes, payload.lat);
        const lonIndex = nearestIndex(dataset.metadata.longitudes, longitude);
        const cell = latIndex * dataset.lonCount + lonIndex;
        const cellCount = dataset.latCount * dataset.lonCount;
        const ensembles = [];
        for (let member = 0; member < dataset.members; member += 1) {
            ensembles.push(dataset.forecast[member * cellCount + cell]);
        }
        const mean = dataset.mean[cell];
        const obs = dataset.reference[cell];
        const finite = ensembles.filter(Number.isFinite);
        const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
        return {
            ensembles,
            metrics: { mean, obs, error: mean - obs, std: Math.sqrt(variance) },
            latIndex,
            lonIndex,
            matchedLat: dataset.metadata.latitudes[latIndex],
            matchedLon: dataset.metadata.longitudes[lonIndex]
        };
    }

    async function loadAnalysis() {
        const requestId = ++activeRequest;
        const payload = buildPayload();
        const localUrl = LOCAL_DATASETS[datasetKey(payload)];
        setLoading(true);

        try {
            if (localUrl) {
                showStatus("Loading the bundled real C3S and ERA5 monthly grids…");
                const dataset = await loadMonthlyGrid(localUrl);
                if (requestId !== activeRequest) return;
                const point = localPoint(dataset, payload);
                renderLocalDashboard(dataset, point);
                showStatus(
                    `Local real-data cache · nearest grid cell ${point.matchedLat.toFixed(1)}°N, ${point.matchedLon.toFixed(1)}°E`,
                    "success"
                );
                return;
            }

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
            if (!response.ok) {
                let detail = `Backend returned HTTP ${response.status}`;
                try {
                    const errorPayload = await response.json();
                    detail = errorPayload.detail || detail;
                } catch (_) {
                    // Keep the HTTP error if the backend did not return JSON.
                }
                throw new Error(detail);
            }
            const data = await response.json();
            if (requestId !== activeRequest) return;
            backendResponseCache.set(key, data);
            renderBackendDashboard(data);
            showStatus("Analysis complete using backend data.", "success");
        } catch (error) {
            if (requestId === activeRequest) showStatus(error.message, "error");
        } finally {
            if (requestId === activeRequest) setLoading(false);
        }
    }

    function renderMetricsAndChart(point) {
        metricMean.textContent = point.metrics.mean.toFixed(4);
        metricObs.textContent = point.metrics.obs.toFixed(4);
        metricError.textContent = point.metrics.error.toFixed(4);
        metricSpread.textContent = `±${point.metrics.std.toFixed(4)}`;
        drawChart(point.ensembles, point.metrics.mean, point.metrics.obs);
    }

    function renderLocalDashboard(dataset, point) {
        mapImage.src = renderMaps(dataset, point);
        mapImage.style.display = "block";
        mapPlaceholder.style.display = "none";
        renderMetricsAndChart(point);
    }

    function renderBackendDashboard(data) {
        mapImage.src = `data:image/png;base64,${data.image_b64}`;
        mapImage.style.display = "block";
        mapPlaceholder.style.display = "none";
        renderMetricsAndChart(data);
    }

    function finitePercentile(values, percentile) {
        const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
        return finite[Math.round((finite.length - 1) * percentile)];
    }

    function color(value, minimum, maximum, divergent = false) {
        if (!Number.isFinite(value)) return [15, 23, 42, 255];
        const scaled = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum || 1)));
        const stops = divergent
            ? [[33, 102, 172], [247, 247, 247], [178, 24, 43]]
            : [[49, 54, 149], [255, 255, 191], [165, 0, 38]];
        const section = scaled < 0.5 ? 0 : 1;
        const mix = section === 0 ? scaled * 2 : (scaled - 0.5) * 2;
        return [0, 1, 2].map(channel => Math.round(stops[section][channel] * (1 - mix) + stops[section + 1][channel] * mix)).concat(255);
    }

    function fieldCanvas(values, rows, columns, minimum, maximum, divergent) {
        const canvas = document.createElement("canvas");
        canvas.width = columns;
        canvas.height = rows;
        const context = canvas.getContext("2d");
        const image = context.createImageData(columns, rows);
        for (let index = 0; index < values.length; index += 1) {
            const rgba = color(values[index], minimum, maximum, divergent);
            image.data.set(rgba, index * 4);
        }
        context.putImageData(image, 0, 0);
        return canvas;
    }

    function renderMaps(dataset, point) {
        const difference = new Float32Array(dataset.mean.length);
        for (let index = 0; index < difference.length; index += 1) {
            difference[index] = dataset.mean[index] - dataset.reference[index];
        }
        const combined = new Float32Array(dataset.mean.length + dataset.reference.length);
        combined.set(dataset.mean);
        combined.set(dataset.reference, dataset.mean.length);
        const temperatureMin = finitePercentile(combined, 0.01);
        const temperatureMax = finitePercentile(combined, 0.99);
        const differenceLimit = Math.max(
            Math.abs(finitePercentile(difference, 0.01)),
            Math.abs(finitePercentile(difference, 0.99)),
            0.001
        );
        const panels = [
            [dataset.mean, "C3S ensemble mean", temperatureMin, temperatureMax, false],
            [dataset.reference, "ERA5 monthly reference", temperatureMin, temperatureMax, false],
            [difference, "Forecast − ERA5", -differenceLimit, differenceLimit, true]
        ];

        const canvas = document.createElement("canvas");
        canvas.width = 1500;
        canvas.height = 500;
        const context = canvas.getContext("2d");
        context.fillStyle = "#0f172a";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = "600 22px Inter, sans-serif";
        context.textAlign = "center";
        const panelWidth = 460;
        const panelHeight = 360;
        const top = 65;

        panels.forEach(([values, title, minimum, maximum, divergent], panelIndex) => {
            const left = 25 + panelIndex * 495;
            const source = fieldCanvas(values, dataset.latCount, dataset.lonCount, minimum, maximum, divergent);
            context.imageSmoothingEnabled = true;
            context.drawImage(source, left, top, panelWidth, panelHeight);
            context.fillStyle = "#f8fafc";
            context.fillText(title, left + panelWidth / 2, 38);
            context.strokeStyle = "#84cc16";
            context.lineWidth = 3;
            const x = left + point.lonIndex / (dataset.lonCount - 1) * panelWidth;
            const y = top + point.latIndex / (dataset.latCount - 1) * panelHeight;
            context.beginPath();
            context.moveTo(x - 9, y);
            context.lineTo(x + 9, y);
            context.moveTo(x, y - 9);
            context.lineTo(x, y + 9);
            context.stroke();
            context.font = "15px Inter, sans-serif";
            context.fillStyle = "#94a3b8";
            context.textAlign = "left";
            context.fillText(`${minimum.toFixed(1)} °C`, left, 455);
            context.textAlign = "right";
            context.fillText(`${maximum.toFixed(1)} °C`, left + panelWidth, 455);
            context.font = "600 22px Inter, sans-serif";
            context.textAlign = "center";
        });
        return canvas.toDataURL("image/png");
    }

    function drawChart(ensembles, mean, observation) {
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
                    { label: "ERA5 reference", data: [{ x: observation, y: 0 }], backgroundColor: "#10b981", pointRadius: 12, pointStyle: "triangle", rotation: 180 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { display: false, min: -0.2, max: 0.2 },
                    x: {
                        title: { display: true, text: "2 m temperature (°C)", color: "#94a3b8" },
                        grid: { color: "rgba(255, 255, 255, 0.1)" },
                        ticks: { color: "#94a3b8" }
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

    // Disable the button immediately and show the real bundled month on first open.
    loadAnalysis();
});
