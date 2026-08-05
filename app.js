document.addEventListener("DOMContentLoaded", () => {
    // UI Elements
    const fetchBtn = document.getElementById("fetch_btn");
    const statusMsg = document.getElementById("status_msg");
    const appToken = document.getElementById("app_token");
    const mapImage = document.getElementById("map_image");
    const mapPlaceholder = document.getElementById("map_placeholder");
    
    // Sliders
    const latSlider = document.getElementById("selected_lat");
    const lonSlider = document.getElementById("selected_lon");
    const latVal = document.getElementById("lat_val");
    const lonVal = document.getElementById("lon_val");

    // Metrics
    const metricMean = document.getElementById("metric_mean");
    const metricObs = document.getElementById("metric_obs");
    const metricError = document.getElementById("metric_error");
    const metricSpread = document.getElementById("metric_spread");

    let chartInstance = null;

    // Update slider values
    latSlider.addEventListener("input", (e) => latVal.textContent = parseFloat(e.target.value).toFixed(1));
    lonSlider.addEventListener("input", (e) => lonVal.textContent = parseFloat(e.target.value).toFixed(1));

    // Auto-load mock data on startup so it looks pretty instantly
    async function loadInitialMockData() {
        try {
            const response = await fetch("mock_2m_temperature_2020_09.json");
            const data = await response.json();
            renderDashboard(data);
        } catch (e) {
            console.error("Failed to load initial mock data:", e);
        }
    }
    
    // Call immediately
    loadInitialMockData();

    // Helper to render the dashboard
    function renderDashboard(data) {
        mapImage.src = `data:image/png;base64,${data.image_b64}`;
        mapImage.style.display = "block";
        mapPlaceholder.style.display = "none";

        metricMean.textContent = data.metrics.mean.toFixed(4);
        metricObs.textContent = data.metrics.obs.toFixed(4);
        metricError.textContent = data.metrics.error.toFixed(4);
        metricSpread.textContent = `±${data.metrics.std.toFixed(4)}`;

        drawChart(data.ensembles, data.metrics.mean, data.metrics.obs, data.metrics.std);
    }

    // Handle Fetch Button
    fetchBtn.addEventListener("click", async () => {
        const token = appToken.value;
        if (!token) {
            showStatus("Please enter your App Token.", "error");
            return;
        }

        // Get active backend URL
        const backendMode = document.querySelector('input[name="backend_mode"]:checked').value;

        // Build Payload
        const payload = {
            auth_token: token,
            variable: document.getElementById("target_var").value,
            year: document.getElementById("init_year").value,
            month: document.getElementById("init_month").value,
            lat: parseFloat(latSlider.value),
            lon: parseFloat(lonSlider.value)
        };

        const url = `${backendMode}/analyze`;
        const mockFilename = `mock_${payload.variable}_${payload.year}_${payload.month}.json`;
        
        fetchBtn.disabled = true;

        try {
            // 1. Try to load local mock data first
            showStatus("Checking local cache...", "");
            const mockRes = await fetch(mockFilename);
            let response;
            
            if (mockRes.ok) {
                showStatus("Local file found! Loading instantly...", "");
                response = mockRes;
            } else {
                // 2. If not found locally, call backend
                showStatus("No local cache found. Calling Backend API... (This may take up to 5 minutes)", "");
                response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            }

            if (!response.ok) {
                let errorText = "";
                try {
                    const errorJson = await response.json();
                    errorText = errorJson.detail || "Unknown JSON error";
                } catch(e) {
                    const text = await response.text();
                    errorText = `Gateway Error: ${text.substring(0, 100)}`;
                }
                throw new Error(errorText);
            }

            const data = await response.json();
            renderDashboard(data);
            showStatus("Analysis Complete!", "success");

        } catch (error) {
            showStatus(error.message, "error");
        } finally {
            fetchBtn.disabled = false;
        }
    });

    function showStatus(msg, type) {
        statusMsg.textContent = msg;
        statusMsg.className = `status ${type}`;
    }

    function drawChart(ensembles, mean, obs, std) {
        const ctx = document.getElementById("ensembleChart").getContext("2d");
        
        if (chartInstance) {
            chartInstance.destroy();
        }

        // Generate jitter for Y axis just to spread points visually
        const jitterData = ensembles.map(val => ({
            x: val,
            y: (Math.random() * 0.1) - 0.05
        }));

        chartInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Ensemble Members',
                        data: jitterData,
                        backgroundColor: 'rgba(59, 130, 246, 0.6)',
                        pointRadius: 6
                    },
                    {
                        label: 'Ensemble Mean',
                        data: [{ x: mean, y: 0 }],
                        backgroundColor: '#ef4444',
                        pointRadius: 10,
                        pointStyle: 'rect'
                    },
                    {
                        label: 'True Observation',
                        data: [{ x: obs, y: 0 }],
                        backgroundColor: '#10b981',
                        pointRadius: 12,
                        pointStyle: 'triangle',
                        rotation: 180
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        display: false,
                        min: -0.2,
                        max: 0.2
                    },
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }
});
