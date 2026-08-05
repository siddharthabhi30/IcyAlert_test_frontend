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

    // Handle Fetch Button
    fetchBtn.addEventListener("click", async () => {
        const token = appToken.value;
        if (!token) {
            showStatus("Please enter your App Token.", "error");
            return;
        }

        // Get active backend URL
        const backendMode = document.querySelector('input[name="backend_mode"]:checked').value;
        const url = `${backendMode}/analyze`;

        // Build Payload
        const payload = {
            auth_token: token,
            variable: document.getElementById("target_var").value,
            year: document.getElementById("init_year").value,
            month: document.getElementById("init_month").value,
            lat: parseFloat(latSlider.value),
            lon: parseFloat(lonSlider.value)
        };

        showStatus("Calling Backend API... (This may take up to 5 minutes)", "");
        fetchBtn.disabled = true;

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

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
            
            // 1. Update Map
            mapImage.src = `data:image/png;base64,${data.image_b64}`;
            mapImage.style.display = "block";
            mapPlaceholder.style.display = "none";

            // 2. Update Metrics
            metricMean.textContent = data.metrics.mean.toFixed(4);
            metricObs.textContent = data.metrics.obs.toFixed(4);
            metricError.textContent = data.metrics.error.toFixed(4);
            metricSpread.textContent = `±${data.metrics.std.toFixed(4)}`;

            // 3. Draw Chart
            drawChart(data.ensembles, data.metrics.mean, data.metrics.obs, data.metrics.std);

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
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    annotation: {
                        annotations: {
                            obsLine: {
                                type: 'line',
                                xMin: obs,
                                xMax: obs,
                                borderColor: 'white',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                label: {
                                    content: 'True Observation',
                                    display: true,
                                    position: 'start'
                                }
                            }
                        }
                    }
                },
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
