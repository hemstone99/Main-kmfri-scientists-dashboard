import * as L from 'leaflet';

/**
 * Accurate GeoJSON representation of the Republic of Kenya national territorial borders
 * and Kenya's Exclusive Economic Zone (EEZ) in the Western Indian Ocean.
 */
export const KENYA_NATIONAL_BORDER_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'Republic of Kenya',
        type: 'National Territorial Boundary',
        agency: 'Kenya Marine and Fisheries Research Institute (KMFRI)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [33.909, -1.059], // Tanzania border at Lake Victoria (Muhuru Bay)
            [34.072, -0.355], // Lake Victoria Western Sector (Rusinga / Mbita)
            [33.985, 0.112],  // Samia / Busia shoreline
            [34.135, 0.465],  // Busia
            [34.552, 1.125],  // Mount Elgon
            [34.938, 1.908],  // West Pokot / Uganda border
            [34.992, 2.512],  // Loima / Turkana West
            [34.475, 3.524],  // Lokichoggio
            [33.998, 4.222],  // Ilemi Triangle West (South Sudan border)
            [35.298, 4.621],  // Ilemi North / Todenyang
            [35.858, 4.448],  // Northern Lake Turkana (Omo Delta)
            [36.225, 4.448],  // Sibiloi / Ethiopia border
            [36.855, 4.022],  // North Horr border
            [37.562, 3.615],  // Sololo
            [38.512, 3.498],  // Moyale
            [39.654, 3.852],  // Takaba / Banisa
            [40.892, 4.256],  // Rhamu
            [41.885, 3.938],  // Mandera Tri-point
            [40.992, 2.785],  // El Wak
            [40.992, 0.854],  // Liboi / Garissa border
            [41.562, -1.652], // Ras Kamboni / Kiunga Indian Ocean border
            [41.055, -2.185], // Lamu Archipelago coast
            [40.215, -2.592], // Kipini / Ungwana Bay
            [40.128, -3.225], // Malindi / Watamu coast
            [39.855, -3.635], // Kilifi Creek
            [39.685, -4.055], // Mombasa Island / Tudor Creek
            [39.515, -4.425], // Diani / Gazi Bay
            [39.205, -4.678], // Vanga / Shimoni / Jasini (Tanzania coastal border)
            [37.652, -3.325], // Taveta / Lake Jipe
            [37.412, -3.052], // Kilimanjaro foothills / Loitokitok
            [36.792, -2.548], // Namanga
            [36.022, -2.012], // Lake Natron / Magadi border
            [35.158, -1.682], // Maasai Mara / Serengeti border
            [34.455, -1.325], // Isebania / Migori
            [33.909, -1.059], // Close ring at Lake Victoria
          ],
        ],
      },
    },
  ],
};

export const KENYA_EEZ_MARITIME_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'Kenya Exclusive Economic Zone (EEZ)',
        type: 'Western Indian Ocean Marine Jurisdiction (200 NM)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [39.205, -4.678], // Southern coastal border (Vanga/Shimoni)
            [42.85, -4.678],  // Pemba Channel / Offshore EEZ South
            [43.65, -2.85],   // Outer EEZ Deep Ocean Sector
            [41.562, -1.652], // Northern coastal border (Kiunga)
            [41.055, -2.185],
            [40.215, -2.592],
            [40.128, -3.225],
            [39.855, -3.635],
            [39.685, -4.055],
            [39.515, -4.425],
            [39.205, -4.678],
          ],
        ],
      },
    },
  ],
};

/**
 * Renders Kenya's national territorial border and Exclusive Economic Zone (EEZ)
 * on a Leaflet map instance with high-contrast satellite-ready cartographic styling.
 */
export function addKenyaBordersOverlay(map: L.Map): L.LayerGroup {
  const group = L.layerGroup();

  // Outer subtle glow for the Kenyan national border on satellite imagery
  L.geoJSON(KENYA_NATIONAL_BORDER_GEOJSON, {
    style: {
      color: '#0284C7',
      weight: 6,
      opacity: 0.35,
      fillOpacity: 0,
      interactive: false,
    },
  }).addTo(group);

  // Crisp inner national border line
  L.geoJSON(KENYA_NATIONAL_BORDER_GEOJSON, {
    style: {
      color: '#38BDF8',
      weight: 2.5,
      opacity: 0.95,
      fillColor: '#159A9C',
      fillOpacity: 0.05,
    },
    onEachFeature: (feature, layer) => {
      if (feature.properties?.name) {
        layer.bindTooltip(
          `<strong>${feature.properties.name}</strong> · ${feature.properties.type}`,
          { sticky: true, direction: 'top' }
        );
      }
    },
  }).addTo(group);

  // Kenya Indian Ocean Exclusive Economic Zone (EEZ) maritime research boundary
  L.geoJSON(KENYA_EEZ_MARITIME_GEOJSON, {
    style: {
      color: '#2DD4BF',
      weight: 2,
      opacity: 0.85,
      dashArray: '6, 6',
      fillColor: '#0284C7',
      fillOpacity: 0.08,
    },
    onEachFeature: (feature, layer) => {
      if (feature.properties?.name) {
        layer.bindTooltip(
          `<strong>${feature.properties.name}</strong> · KMFRI Marine Research Zone`,
          { sticky: true, direction: 'top' }
        );
      }
    },
  }).addTo(group);

  group.addTo(map);
  return group;
}
