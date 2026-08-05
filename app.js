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

    const PUBLIC_MONTHLY_DATASET = Object.freeze({
        variable: "2m_temperature",
        year: "2020",
        month: "09"
    });

    const responseCache = new Map();
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
            lat: parseFloat(latSlider.value),
            lon: parseFloat(lonSlider.value)
        };
    }

    function isPublicMonthlyDataset(payload) {
        return payload.variable === PUBLIC_MONTHLY_DATASET.variable
            && payload.year === PUBLIC_MONTHLY_DATASET.year
            && payload.month === PUBLIC_MONTHLY_DATASET.month;
    }

    function cacheKey(backend, payload) {
        return [
            backend,
            payload.variable,
            payload.year,
            payload.month,
            payload.lat.toFixed(2),
            payload.lon.toFixed(2)
        ].join("|");
    }

    function setLoading(isLoading) {
        fetchBtn.disabled = isLoading;
        fetchBtn.setAttribute("aria-busy", String(isLoading));
        fetchBtn.textContent = isLoading ? "Loading real monthly data…" : "Fetch & Analyze";
    }

    async function loadAnalysis() {
        const requestId = ++activeRequest;
        const backend = selectedBackend();
        const payload = buildPayload();
        const key = cacheKey(backend, payload);

        setLoading(true);
        try {
            showStatus("Checking local monthly cache…", "");

            if (responseCache.has(key)) {
                renderDashboard(responseCache.get(key));
                showStatus("Loaded from browser response cache.", "success");
                return;
            }

            if (!isPublicMonthlyDataset(payload) && !payload.auth_token) {
                throw new Error("Enter the App Token to request data outside the bundled September 2020 demo.");
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
                    const text = await response.text();
                    if (text) detail = text.substring(0, 160);
                }
                throw new Error(detail);
            }

            const data = await response.json();
            if (requestId !== activeRequest) return;

            responseCache.set(key, data);
            renderDashboard(data);
            const source = data.source?.cache === "bundled"
                ? "real bundled C3S and ERA5 monthly files"
                : "backend data cache";
            showStatus(`Analysis complete using ${source}.`, "success");
        } catch (error) {
            if (requestId === activeRequest) {
                showStatus(error.message, "error");
            }
        } finally {
            if (requestId === activeRequest) {
                setLoading(false);
            }
        }
    }

    function renderDashboard(data) {
        mapImage.src = `data:image/png;base64,${data.image_b64}`;
        mapImage.style.display = "block";
        mapPlaceholder.style.display = "none";

        metricMean.textContent = data.metrics.mean.toFixed(4);
        metricObs.textContent = data.metrics.obs.toFixed(4);
        metricError.textContent = data.metrics.error.toFixed(4);
        metricSpread.textContent = `±${data.metrics.std.toFixed(4)}`;

        drawChart(data.ensembles, data.metrics.mean, data.metrics.obs);
    }

    function showStatus(message, type) {
        statusMsg.textContent = message;
        statusMsg.className = `status ${type}`;
    }

    function drawChart(ensembles, mean, observation) {
        const context = document.getElementById("ensembleChart").getContext("2d");
        if (chartInstance) chartInstance.destroy();

        const jitteredMembers = ensembles.map((value, index) => ({
            x: value,
            y: ((index % 11) - 5) / 100
        }));

        chartInstance = new Chart(context, {
            type: "scatter",
            data: {
                datasets: [
                    {
                        label: "51 C3S ensemble members",
                        data: jitteredMembers,
                        backgroundColor: "rgba(59, 130, 246, 0.6)",
                        pointRadius: 6
                    },
                    {
                        label: "Ensemble mean",
                        data: [{ x: mean, y: 0 }],
                        backgroundColor: "#ef4444",
                        pointRadius: 10,
                        pointStyle: "rect"
                    },
                    {
                        label: "ERA5 reference",
                        data: [{ x: observation, y: 0 }],
                        backgroundColor: "#10b981",
                        pointRadius: 12,
                        pointStyle: "triangle",
                        rotation: 180
                    }
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

    latSlider.addEventListener("input", event => {
        latVal.textContent = parseFloat(event.target.value).toFixed(1);
    });
    lonSlider.addEventListener("input", event => {
        lonVal.textContent = parseFloat(event.target.value).toFixed(1);
    });

    // Query once after the user finishes moving a coordinate slider.
    latSlider.addEventListener("change", loadAnalysis);
    lonSlider.addEventListener("change", loadAnalysis);
    fetchBtn.addEventListener("click", loadAnalysis);

    document.querySelectorAll('input[name="backend_mode"]').forEach(input => {
        input.addEventListener("change", () => {
            if (isPublicMonthlyDataset(buildPayload())) loadAnalysis();
        });
    });

    ["target_var", "init_year", "init_month"].forEach(id => {
        document.getElementById(id).addEventListener("change", () => {
            if (isPublicMonthlyDataset(buildPayload())) {
                loadAnalysis();
            } else {
                showStatus("Not bundled locally. Enter the token and click Fetch & Analyze.", "");
            }
        });
    });

    // The default September 2020 real monthly dataset appears as soon as the UI opens.
    loadAnalysis();
});
