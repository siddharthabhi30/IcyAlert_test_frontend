import streamlit as st
import requests
import base64
import numpy as np
import matplotlib.pyplot as plt

st.set_page_config(page_title="IcyAlert: Frontend Dashboard", layout="wide")

st.title("🧊 IcyAlert: Decoupled Architecture Frontend")

with st.sidebar:
    st.header("🔑 Authentication")
    app_token = st.text_input("App Token", type="password", placeholder="Enter secret token")
    
    st.markdown("---")
    st.header("Data Parameters")
    target_var = st.selectbox("State Variable", [
        "sea_ice_cover", 
        "2m_temperature", 
        "sea_surface_temperature",
        "mean_sea_level_pressure",
        "total_precipitation",
        "10m_u_component_of_wind",
        "10m_v_component_of_wind"
    ])
    init_year = st.selectbox("Year", ["2015", "2016", "2017", "2018", "2019", "2020"], index=5)
    init_month = st.selectbox("Month", ["01", "03", "06", "09", "12"], index=3)
    
    st.markdown("---")
    st.header("📍 Interactive Pixel Selector")
    selected_lat = st.slider("Latitude", min_value=-90.0, max_value=90.0, value=75.0, step=0.5)
    selected_lon = st.slider("Longitude", min_value=0.0, max_value=359.0, value=0.0, step=0.5)

if st.button("Fetch & Analyze from Backend"):
    if not app_token:
        st.error("Please provide the App Token to access the Backend API.")
        st.stop()
    st.session_state.active = True
    st.session_state.app_token = app_token

if st.session_state.get('active', False):
    with st.spinner("Calling Backend API... (Calculating Ensemble Spread)"):
        try:
            res = requests.post("https://icyalert-test-backend.onrender.com/analyze", json={
                "auth_token": st.session_state.app_token,
                "variable": target_var,
                "year": init_year,
                "month": init_month,
                "lat": selected_lat,
                "lon": selected_lon
            })
            
            if res.status_code != 200:
                try:
                    error_msg = res.json().get('detail', 'Unknown error')
                except ValueError:
                    # If Render returns an HTML error page (like 502 Bad Gateway)
                    error_msg = f"Server returned {res.status_code}: {res.text[:100]}"
                st.error(f"Backend Error: {error_msg}")
                st.stop()
                
            data = res.json()
        except requests.exceptions.ConnectionError:
            st.error("Could not connect to the Backend API. Make sure it is running on port 8000!")
            st.stop()
            
    st.markdown("### 🗺️ Spatial Maps (Rendered by Backend)")
    st.image(base64.b64decode(data['image_b64']), use_column_width=True)
    
    st.markdown("---")
    st.markdown(f"### 📍 Pixel Analysis at Lat: {selected_lat}°, Lon: {selected_lon}°")
    
    metrics = data['metrics']
    fc_point = np.array(data['ensembles'])
    
    col1, col2 = st.columns([1, 2])
    with col1:
        st.metric("Ensemble Mean", f"{metrics['mean']:.4f}")
        st.metric("True Observation", f"{metrics['obs']:.4f}")
        st.metric("Error", f"{metrics['error']:.4f}", delta=f"{metrics['error']:.4f}", delta_color="inverse")
        st.metric("Ensemble Spread", f"± {metrics['std']:.4f}")
            
    with col2:
        fig2, ax = plt.subplots(figsize=(8, 3))
        
        # Plot everything on a horizontal number line (Y=0)
        y_jitter = np.random.normal(0, 0.05, size=len(fc_point))
        
        ax.scatter(fc_point, y_jitter, color='blue', alpha=0.5, s=60, label='Ensemble Members')
        ax.scatter(metrics['mean'], 0, color='red', s=200, zorder=5, label='Ensemble Mean')
        
        ax.errorbar(metrics['mean'], 0, xerr=metrics['std'], color='red', capsize=10, linewidth=3, zorder=4)
        ax.axvline(x=metrics['obs'], color='black', linestyle='--', linewidth=2, label='True Observation')
        
        ax.set_ylim(-0.5, 0.5)
        ax.set_yticks([]) 
        ax.set_xlabel(f"Actual Value ({target_var})", fontsize=12)
        ax.set_title(f"Ensemble Spread vs Error\n(Pixel: {selected_lat}°, {selected_lon}°)", fontsize=14)
        ax.legend(loc="upper right")
        ax.grid(True, axis='x', alpha=0.3)
        st.pyplot(fig2)
