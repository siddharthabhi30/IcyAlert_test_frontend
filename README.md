# IcyAlert test frontend

The default September 2020 view is completely static and works on GitHub Pages.
It loads bundled monthly fields before making any backend request.

## Bundled comparisons

- Air temperature: C3S System 51 ensemble forecast, ERA5 reanalysis, and the
  nearest quality-passed CDS land-station observation.
- Sea-ice concentration: C3S SEAS5/System 51 dynamical forecast output, ERA5
  reanalysis, and the OSI SAF OSI-450-a1 v3.1 satellite-derived climate record.

The latitude/longitude sliders control both analyses. Sea-ice data are aligned
to the C3S 1-degree grid for display and pointwise comparison; OSI SAF remains
labelled separately as the satellite-derived climate record rather than as
reanalysis.

Source links and each product's role are shown directly below its analysis.
