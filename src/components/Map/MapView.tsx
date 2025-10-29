// ...existing code...
import React, { useRef, useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string;

export type MapPoint = {
  day: number;
  name: string;
  lat: number;
  lng: number;
  desc?: string;
  source?: string;
  geojson?: GeoJSON.Geometry | GeoJSON.Feature | GeoJSON.FeatureCollection;
};

interface MapViewProps {
  points?: MapPoint[]; // list of destinations (single place or itinerary)
  initialCoordinates?: [number, number];
  initialZoom?: number;
  className?: string;
}

const DEFAULT_PALETTE = [
  "#ff4d4f",
  "#ff7a45",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

const MapView: React.FC<MapViewProps> = ({
  points = [],
  initialCoordinates = [108.2772, 14.0583], // Vietnam center [lng, lat]
  initialZoom = 5,
  className,
}) => {
  useEffect(() => {
    console.log("MapView received points:", points);
    points.forEach((p, i) => {
      if (typeof p.lat !== "number" || typeof p.lng !== "number") {
        console.warn(`Point ${i} lat/lng not numbers:`, p);
      }
    });
  }, [points]);

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

  const outlinesRef = useRef(new Map<string, GeoJSON.Geometry | null>());

  // Changed: for multi-day journeys default to first day (remove "Tất cả" as default)
  const [selectedDay, setSelectedDay] = useState<number | "all">(
    points.length > 1 ? points[0].day : "all"
  );

  // loading state: true while we are fetching boundaries / updating map and when map is moving
  const [mapLoading, setMapLoading] = useState(false);

  // group points by day for tab UI
  const daysGroup = React.useMemo(() => {
    const m = new Map<number, MapPoint[]>();
    points.forEach((p) => {
      const arr = m.get(p.day) ?? [];
      arr.push(p);
      m.set(p.day, arr);
    });
    return m;
  }, [points]);

  useEffect(() => {
    if (map.current) return;
    map.current = new mapboxgl.Map({
      container: mapContainer.current!,
      style: "mapbox://styles/mapbox/streets-v12",
      center: initialCoordinates,
      zoom: initialZoom,
    });

    // attach load listener so we can react after the map is ready
    const onLoad = () => {
      // nothing immediate to do on load - updateMapView will set the loading state
    };

    map.current.on("load", onLoad);

    return () => {
      markers.current.forEach((m) => m.remove());
      // remove listeners if map exists
      if (map.current) {
        try {
          map.current.off("load", onLoad);
        } catch {
          // ignore
        }
        map.current.remove();
        map.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helper: create circle polygon (approx) around lon/lat with radius (meters)
  const makeCircle = (lng: number, lat: number, radius = 2000, steps = 64) => {
    const coords: [number, number][] = [];
    const earthCircumference = 40075000; // meters
    const degPerMeterLat = 360 / earthCircumference;
    for (let i = 0; i < steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const dLat = radius * Math.cos(theta) * degPerMeterLat;
      const dLng =
        (radius * Math.sin(theta) * degPerMeterLat) /
        Math.cos((lat * Math.PI) / 180);
      coords.push([lng + dLng, lat + dLat]);
    }
    coords.push(coords[0]);
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coords] },
      properties: {},
    } as GeoJSON.Feature<GeoJSON.Polygon>;
  };

  const clearOutlineLayers = () => {
    if (!map.current) return;
    const mp = map.current;
    if (!mp.loaded && !mp.loaded()) return;
    const layers = mp.getStyle().layers ?? [];
    layers.forEach((layer) => {
      if (layer.id.startsWith("outline-")) {
        try {
          if (mp.getLayer(layer.id)) mp.removeLayer(layer.id);
        } catch (e) {
          console.error(e);
        }
      }
    });
    Object.keys(mp.getStyle().sources ?? {}).forEach((srcId) => {
      if (srcId.startsWith("outline-")) {
        try {
          if (mp.getSource(srcId)) mp.removeSource(srcId);
        } catch (e) {
          console.error(e);
        }
      }
    });
  };

  const clearMarkers = () => {
    markers.current.forEach((m) => m.remove());
    markers.current = [];
  };

  const fitToPoints = (pts: MapPoint[], padding = 80, maxZoom?: number) => {
    if (!map.current || pts.length === 0) return;
    const bounds = new mapboxgl.LngLatBounds(
      [pts[0].lng, pts[0].lat],
      [pts[0].lng, pts[0].lat]
    );
    pts.forEach((p) => bounds.extend([p.lng, p.lat]));
    map.current.fitBounds(bounds, { padding, maxZoom });
  };

  const normalizeLatLng = (p: MapPoint) => {
    // robust parsing: accept strings with comma decimal separators and noisy chars
    const parse = (v: unknown): number => {
      if (v === null || v === undefined) return NaN;
      if (typeof v === "number") return v;
      let s = String(v).trim();
      // convert comma decimal to dot (e.g. "10,123" -> "10.123") but avoid thousands separators
      // if there are both '.' and ',' assume '.' is decimal and remove commas; otherwise replace comma with dot
      if (s.indexOf(".") >= 0 && s.indexOf(",") >= 0) {
        s = s.replace(/,/g, "");
      } else {
        s = s.replace(/,/g, ".");
      }
      // strip any non-numeric/non-dot/non-minus characters
      s = s.replace(/[^0-9.-]+/g, "");
      const n = parseFloat(s);
      return isFinite(n) ? n : NaN;
    };

    const rawLat = parse(p.lat);
    const rawLng = parse(p.lng);

    if (isNaN(rawLat) || isNaN(rawLng)) {
      console.warn("MapView: invalid coords for", p.name, {
        rawLat: p.lat,
        rawLng: p.lng,
        parsedLat: rawLat,
        parsedLng: rawLng,
      });
      return { lat: rawLat || 0, lng: rawLng || 0 };
    }

    // If latitude looks invalid (> 90) but longitude is valid, assume swapped
    let finalLat = rawLat;
    let finalLng = rawLng;
    if (Math.abs(rawLat) > 90 && Math.abs(rawLng) <= 90) {
      finalLat = rawLng;
      finalLng = rawLat;
      console.debug("MapView: swapped lat/lng (heuristic) for", p.name, {
        rawLat,
        rawLng,
        finalLat,
        finalLng,
      });
    } else {
      // Heuristic for Vietnam: lat roughly between 6..24, lng roughly between 102..110
      const looksLikeLat = (v: number) => v >= 6 && v <= 30;
      const looksLikeLng = (v: number) => v >= 95 && v <= 120;
      if (looksLikeLat(rawLng) && looksLikeLng(rawLat)) {
        // looks swapped
        finalLat = rawLng;
        finalLng = rawLat;
        console.debug(
          "MapView: swapped lat/lng based on VN heuristics for",
          p.name,
          { rawLat, rawLng, finalLat, finalLng }
        );
      }
    }

    return { lat: finalLat, lng: finalLng };
  };

  const slug = (s = "") =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

  const expandBBox = (
    bbox: [number, number, number, number],
    factor = 0.06
  ) => {
    // bbox = [minLng, minLat, maxLng, maxLat]
    const [minX, minY, maxX, maxY] = bbox;
    const dx = maxX - minX;
    const dy = maxY - minY;
    // if dx/dy zero, add small delta
    const padX = dx === 0 ? 0.01 : dx * factor;
    const padY = dy === 0 ? 0.01 : dy * factor;
    return [minX - padX, minY - padY, maxX + padX, maxY + padY] as [
      number,
      number,
      number,
      number
    ];
  };

  const fetchBoundaryFromNominatim = async (p: MapPoint) => {
    try {
      const q = encodeURIComponent(p.name);
      const searchUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${q}&polygon_geojson=1&limit=1&countrycodes=vn`;
      const headers = {
        Accept: "application/json",
        "User-Agent": "vietnam-journey-bot/1.0 (you@yourdomain.example)",
      };

      const res = await fetch(searchUrl, { headers });
      if (!res.ok) return null;
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) return null;

      type NominatimResult = {
        geojson?: GeoJSON.Geometry;
        class?: string;
        boundingbox?: unknown[];
        osm_type?: string;
        osm_id?: number | string;
      };

      const arr = raw as unknown[];
      const results: NominatimResult[] = arr.filter(
        (x): x is NominatimResult => typeof x === "object" && x !== null
      ) as NominatimResult[];

      // Prefer results that include polygon geojson first
      let candidate = results.find(
        (r) =>
          r.geojson &&
          (r.geojson.type === "Polygon" || r.geojson.type === "MultiPolygon")
      );

      // If none has polygon, prefer entries whose class indicates a place-area (tourism, natural, landuse, leisure, historic)
      if (!candidate) {
        const preferred = [
          "tourism",
          "natural",
          "landuse",
          "leisure",
          "historic",
        ];
        candidate = results.find(
          (r) => r.class !== undefined && preferred.includes(String(r.class))
        );
      }

      // As further fallback pick the result with largest bounding box area (more likely to be the area, not a single POI)
      if (!candidate) {
        let best: NominatimResult | null = null;
        let bestArea = 0;
        for (const a of results) {
          if (Array.isArray(a.boundingbox) && a.boundingbox.length === 4) {
            const vals = a.boundingbox.map((v) => Number(v));
            const minLat = Math.min(vals[0], vals[1]);
            const maxLat = Math.max(vals[0], vals[1]);
            const minLng = Math.min(vals[2], vals[3]);
            const maxLng = Math.max(vals[2], vals[3]);
            const area = Math.abs((maxLat - minLat) * (maxLng - minLng));
            if (area > bestArea) {
              bestArea = area;
              best = a;
            }
          }
        }
        candidate = best ?? results[0];
      }

      const first = candidate;

      // If candidate has polygon geojson, return it
      if (
        first?.geojson &&
        (first.geojson.type === "Polygon" ||
          first.geojson.type === "MultiPolygon")
      ) {
        return first.geojson as GeoJSON.Geometry;
      }

      // Try details lookup for the chosen candidate (using its osm_type/osm_id) to retrieve polygon geometry
      const osm_type = first?.osm_type; // e.g. "relation","way","node"
      const osm_id = first?.osm_id;
      if (osm_type && osm_id) {
        const mapType: Record<string, string> = {
          relation: "R",
          way: "W",
          node: "N",
        };
        const osmTypeLetter =
          mapType[String(osm_type).toLowerCase()] ??
          String(osm_type).charAt(0).toUpperCase();
        const detailsUrl = `https://nominatim.openstreetmap.org/details.php?osmtype=${osmTypeLetter}&osmid=${osm_id}&format=json&polygon_geojson=1`;
        const detailsRes = await fetch(detailsUrl, { headers });
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          if (
            details?.geojson &&
            (details.geojson.type === "Polygon" ||
              details.geojson.type === "MultiPolygon")
          ) {
            return details.geojson as GeoJSON.Geometry;
          }
          if (
            details?.polygon_geojson &&
            (details.polygon_geojson.type === "Polygon" ||
              details.polygon_geojson.type === "MultiPolygon")
          ) {
            return details.polygon_geojson as GeoJSON.Geometry;
          }
        }
      }

      if (
        first?.boundingbox &&
        Array.isArray(first.boundingbox) &&
        first.boundingbox.length === 4
      ) {
        // boundingbox from nominatim may return [south, north, west, east]
        const vals = first.boundingbox.map(Number);
        const minLatVal = Math.min(vals[0], vals[1]);
        const maxLatVal = Math.max(vals[0], vals[1]);
        const minLngVal = Math.min(vals[2], vals[3]);
        const maxLngVal = Math.max(vals[2], vals[3]);
        const poly: GeoJSON.Feature<GeoJSON.Polygon> = {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [minLngVal, minLatVal],
                [maxLngVal, minLatVal],
                [maxLngVal, maxLatVal],
                [minLngVal, maxLatVal],
                [minLngVal, minLatVal],
              ],
            ],
          },
        };
        return poly.geometry;
      }
    } catch (e) {
      console.warn("Boundary fetch failed for", p.name, e);
    }
    return null;
  };

  // helper to compute bounding box of a GeoJSON geometry (returns [minLng,minLat,maxLng,maxLat])
  const geometryBBox = (
    g: GeoJSON.Geometry
  ): [number, number, number, number] | null => {
    try {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      const visitCoords = (coords: unknown) => {
        if (Array.isArray(coords) && coords.length > 0) {
          if (typeof coords[0] === "number" && typeof coords[1] === "number") {
            const x = coords[0] as number;
            const y = coords[1] as number;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          } else {
            coords.forEach((c) => visitCoords(c));
          }
        }
      };
      if (g.type === "Point" && (g as GeoJSON.Point).coordinates) {
        visitCoords((g as GeoJSON.Point).coordinates);
      } else if (
        g.type === "LineString" &&
        (g as GeoJSON.LineString).coordinates
      ) {
        visitCoords((g as GeoJSON.LineString).coordinates);
      } else if (
        g.type === "MultiLineString" &&
        (g as GeoJSON.MultiLineString).coordinates
      ) {
        visitCoords((g as GeoJSON.MultiLineString).coordinates);
      } else if (g.type === "Polygon" && (g as GeoJSON.Polygon).coordinates) {
        visitCoords((g as GeoJSON.Polygon).coordinates);
      } else if (
        g.type === "MultiPolygon" &&
        (g as GeoJSON.MultiPolygon).coordinates
      ) {
        visitCoords((g as GeoJSON.MultiPolygon).coordinates);
      } else if (g.type === "GeometryCollection") {
        const coll = g as GeoJSON.GeometryCollection;
        if (Array.isArray(coll.geometries)) {
          coll.geometries.forEach((gg) => {
            const b = geometryBBox(gg);
            if (b) {
              if (b[0] < minX) minX = b[0];
              if (b[1] < minY) minY = b[1];
              if (b[2] > maxX) maxX = b[2];
              if (b[3] > maxY) maxY = b[3];
            }
          });
        }
      } else {
        return null;
      }
      if (!isFinite(minX)) return null;
      return [minX, minY, maxX, maxY];
    } catch (e) {
      console.log(e);
      return null;
    }
  };

  // update map view when points or selectedDay change
  useEffect(() => {
    const mp = map.current;
    if (!mp) return;

    const updateMapView = async () => {
      setMapLoading(true);
      try {
        // If multi-day journey, we no longer use "all" — show only active day
        const activePoints: MapPoint[] =
          selectedDay === "all"
            ? points.length === 1
              ? points
              : points.filter((p) => p.day === points[0].day)
            : points.filter((p) => p.day === selectedDay);

        clearOutlineLayers();
        clearMarkers();

        if (activePoints.length === 0) {
          mp.flyTo({ center: initialCoordinates, zoom: initialZoom });
          return;
        }

        // we'll compute a combined bounds so fit can zoom appropriately (closer if bbox small)
        let combinedBounds: mapboxgl.LngLatBounds | null = null;

        // sequentially process points (safer re: external requests)
        for (let idx = 0; idx < activePoints.length; idx++) {
          const p0 = activePoints[idx];
          // normalize coordinates (fix swapped lat/lng from upstream if any)
          const { lat, lng } = normalizeLatLng(p0);

          const el = document.createElement("div");
          el.className = "map-marker";
          el.style.width = "12px";
          el.style.height = "12px";
          el.style.borderRadius = "50%";
          el.style.background = "#fff";
          el.style.border = `2px solid ${
            DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length]
          }`;
          el.style.boxShadow = "0 0 6px rgba(0,0,0,0.12)";
          el.title = p0.name ?? "";

          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([lng, lat]) // use normalized order [lng, lat]
            .addTo(mp);
          markers.current.push(marker);

          const popupEl = document.createElement("div");
          popupEl.style.fontSize = "13px";
          const titleEl = document.createElement("div");
          titleEl.style.fontWeight = "600";
          titleEl.style.marginBottom = "4px";
          titleEl.textContent = p0.name ?? "";
          popupEl.appendChild(titleEl);
          if (p0.desc) {
            const descEl = document.createElement("div");
            descEl.style.marginBottom = "6px";
            descEl.textContent = p0.desc;
            popupEl.appendChild(descEl);
          }
          if (p0.source) {
            const linkEl = document.createElement("a");
            linkEl.href = p0.source;
            linkEl.target = "_blank";
            linkEl.rel = "noreferrer";
            linkEl.style.color = "#1d4ed8";
            linkEl.style.textDecoration = "underline";
            linkEl.textContent = "Nguồn đọc thêm";
            popupEl.appendChild(linkEl);
          }
          const popup = new mapboxgl.Popup({ offset: 10 }).setDOMContent(
            popupEl
          );
          marker.setPopup(popup);

          let geometry: GeoJSON.Geometry | null = null;
          if (p0.geojson) {
            const gj = p0.geojson as unknown;
            // FeatureCollection
            if (
              typeof gj === "object" &&
              gj !== null &&
              "type" in gj &&
              (gj as { type?: unknown }).type === "FeatureCollection"
            ) {
              const fc = gj as GeoJSON.FeatureCollection;
              const polyFeat = fc.features?.find(
                (f) =>
                  !!f.geometry &&
                  (f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon" ||
                    f.geometry.type === "MultiLineString" ||
                    f.geometry.type === "LineString")
              );
              if (polyFeat) geometry = polyFeat.geometry;
              else if (fc.features && fc.features[0] && fc.features[0].geometry)
                geometry = fc.features[0].geometry;
            } else if (typeof gj === "object" && gj !== null && "type" in gj) {
              // plain geometry with type
              geometry = gj as GeoJSON.Geometry;
            } else if (
              typeof gj === "object" &&
              gj !== null &&
              "features" in gj
            ) {
              const maybe = gj as { features?: unknown };
              if (Array.isArray(maybe.features)) {
                const fc = gj as GeoJSON.FeatureCollection;
                const polyFeat = fc.features?.find(
                  (f) =>
                    !!f.geometry &&
                    (f.geometry.type === "Polygon" ||
                      f.geometry.type === "MultiPolygon" ||
                      f.geometry.type === "MultiLineString" ||
                      f.geometry.type === "LineString")
                );
                if (polyFeat) geometry = polyFeat.geometry;
              }
            }
          }

          if (!geometry) {
            geometry = await fetchBoundaryFromNominatim(p0);
          }

          const color = DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];
          const srcId = `outline-${p0.day ?? 0}-${idx}-${slug(p0.name)}`;
          outlinesRef.current.set(srcId, geometry ?? null);

          if (
            geometry &&
            (geometry.type === "Polygon" ||
              geometry.type === "MultiPolygon" ||
              geometry.type === "LineString" ||
              geometry.type === "MultiLineString")
          ) {
            const feat: GeoJSON.Feature = {
              type: "Feature",
              properties: {},
              geometry: geometry as GeoJSON.Geometry,
            };

            if (!mp.getSource(srcId)) {
              mp.addSource(srcId, { type: "geojson", data: feat });
            } else {
              (mp.getSource(srcId) as mapboxgl.GeoJSONSource).setData(feat);
            }

            const fillId = `${srcId}-fill`;
            if (!mp.getLayer(fillId)) {
              mp.addLayer({
                id: fillId,
                type: "fill",
                source: srcId,
                paint: {
                  "fill-color": color,
                  "fill-opacity": 0.06,
                },
              });
            }

            const lineId = `${srcId}-line`;
            if (!mp.getLayer(lineId)) {
              mp.addLayer({
                id: lineId,
                type: "line",
                source: srcId,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                  "line-color": color,
                  "line-width": 2,
                  "line-dasharray": [4, 4],
                  "line-opacity": 0.95,
                },
              });
            }

            const b = geometryBBox(geometry);
            if (b) {
              const expanded = expandBBox(b, 0.06);
              if (!combinedBounds) {
                combinedBounds = new mapboxgl.LngLatBounds(
                  [expanded[0], expanded[1]],
                  [expanded[2], expanded[3]]
                );
              } else {
                combinedBounds.extend([expanded[0], expanded[1]]);
                combinedBounds.extend([expanded[2], expanded[3]]);
              }
            } else {
              if (!combinedBounds)
                combinedBounds = new mapboxgl.LngLatBounds(
                  [lng, lat],
                  [lng, lat]
                );
              else combinedBounds.extend([lng, lat]);
            }
          } else {
            // fallback circle around normalized point
            const feature = makeCircle(lng, lat, 2000); // slightly smaller radius
            if (!mp.getSource(srcId)) {
              mp.addSource(srcId, { type: "geojson", data: feature });
            } else {
              (mp.getSource(srcId) as mapboxgl.GeoJSONSource).setData(feature);
            }

            const layerId = `${srcId}-line`;
            if (!mp.getLayer(layerId)) {
              mp.addLayer({
                id: layerId,
                type: "line",
                source: srcId,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                  "line-color": color,
                  "line-width": 2,
                  "line-dasharray": [4, 4],
                  "line-opacity": 0.95,
                },
              });
            }

            // expand small box around point to allow close zoom but still keep outline near edge
            const delta = 0.008; // smaller than previous 0.02 for closer zoom
            const circB: [number, number, number, number] = [
              lng - delta,
              lat - delta,
              lng + delta,
              lat + delta,
            ];
            const expanded = expandBBox(circB, 0.04);
            if (!combinedBounds) {
              combinedBounds = new mapboxgl.LngLatBounds(
                [expanded[0], expanded[1]],
                [expanded[2], expanded[3]]
              );
            } else {
              combinedBounds.extend([expanded[0], expanded[1]]);
              combinedBounds.extend([expanded[2], expanded[3]]);
            }
          }
        }

        // Fit bounds or flyTo with closer zoom and reduced padding so outlines are near edges
        if (combinedBounds) {
          mp.fitBounds(combinedBounds, { padding: 60, maxZoom: 17 });
        } else if (activePoints.length === 1) {
          const p0 = activePoints[0];
          const { lat, lng } = normalizeLatLng(p0);
          mp.flyTo({ center: [lng, lat], zoom: 16, speed: 0.8 });
        } else {
          fitToPoints(activePoints, 80, 16);
        }
      } finally {
        setMapLoading(false);
      }
    };

    if (!mp.loaded || !mp.loaded()) {
      mp.once("load", () => {
        updateMapView().catch((e) => console.error(e));
      });
    } else {
      updateMapView().catch((e) => console.error(e));
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selectedDay]);

  // ensure mapLoading toggles off if component unmounts while true
  useEffect(() => {
    return () => setMapLoading(false);
  }, []);

  const zoomToPlace = (p: MapPoint, preferIdx?: number) => {
    if (!map.current) return;
    const { lat, lng } = normalizeLatLng(p);

    // match srcId used when rendering outlines (best effort)
    const idx = typeof preferIdx === "number" ? preferIdx : 0;
    const srcId = `outline-${p.day ?? 0}-${idx}-${slug(p.name)}`;
    const geom = outlinesRef.current.get(srcId) ?? null;

    if (geom) {
      const b = geometryBBox(geom);
      if (b) {
        const expanded = expandBBox(b, 0.06);
        map.current.fitBounds(
          [
            [expanded[0], expanded[1]],
            [expanded[2], expanded[3]],
          ],
          { padding: 60, maxZoom: 17 }
        );
        return;
      }
    }

    // fallback: use a tight bbox around point so outline will still be near edge
    const delta = 0.008;
    const bbox: [number, number, number, number] = [
      lng - delta,
      lat - delta,
      lng + delta,
      lat + delta,
    ];
    const expanded = expandBBox(bbox, 0.04);
    map.current.fitBounds(
      [
        [expanded[0], expanded[1]],
        [expanded[2], expanded[3]],
      ],
      { padding: 60, maxZoom: 17 }
    );
  };

  // if points changed and there is only one global point, auto-select all and focus
  useEffect(() => {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      setSelectedDay("all");
    } else {
      // Changed: for multi-day journeys default to first day's number (remove "Tất cả")
      setSelectedDay(points[0].day ?? points[0].day);
    }
  }, [points]);

  // UI rendering: day tabs and list
  const dayKeys = Array.from(daysGroup.keys()).sort((a, b) => a - b);

  // ...existing UI overlay code (tabs / single card) ...
  return (
    <div className={`relative ${className ?? "h-full"}`}>
      <div className="flex-1 rounded-lg overflow-hidden shadow-lg h-full relative">
        <div ref={mapContainer} className="w-full h-full min-h-80" />

        {/* Top-left overlay: removed "Tất cả" tab for journeys, only show day tabs */}
        <div className="absolute top-4 left-4 z-50">
          {points.length === 0 ? null : points.length === 1 ? (
            <div className="bg-white shadow-lg rounded-lg border p-3 w-64 max-w-xs">
              <div className="font-semibold text-sm">{points[0].name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {points[0].desc ?? ""}
              </div>
              {points[0].source && (
                <div className="mt-2 text-xs">
                  <a
                    href={points[0].source}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline"
                  >
                    Nguồn đọc thêm
                  </a>
                </div>
              )}
              <div className="text-xs text-gray-400 mt-2">
                Ngày {points[0].day}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 bg-blue-500 text-white text-xs py-1 rounded"
                  onClick={() => zoomToPlace(points[0])}
                >
                  Zoom đến
                </button>
                <button
                  className="bg-gray-100 text-xs py-1 px-2 rounded"
                  onClick={() => setSelectedDay(points[0].day)}
                >
                  Hiện ngày {points[0].day}
                </button>
              </div>
            </div>
          ) : (
            // Multi-day UI...
            <div className="bg-white shadow-lg rounded-lg border w-72 max-w-xs">
              {/* ...header and day buttons... */}
              <div className="p-2 border-b">
                <div className="text-sm font-semibold">Hành trình</div>
              </div>

              <div className="p-2 flex flex-wrap gap-2">
                {dayKeys.map((d) => (
                  <button
                    key={d}
                    className={`px-2 py-1 rounded text-xs ${
                      selectedDay === d
                        ? "bg-blue-500 text-white"
                        : "bg-gray-100"
                    }`}
                    onClick={() => setSelectedDay(d)}
                  >
                    Ngày {d}
                  </button>
                ))}
              </div>

              <div className="p-2 max-h-40 overflow-auto text-xs">
                {(() => {
                  const cur =
                    selectedDay === "all"
                      ? dayKeys[0]
                      : (selectedDay as number);
                  const list = daysGroup.get(Number(cur)) ?? [];
                  return (
                    <ul className="space-y-2">
                      {list.map((p, i) => (
                        <li
                          key={i}
                          className="p-2 border rounded cursor-pointer hover:bg-gray-50"
                          onClick={() => {
                            zoomToPlace(p, i);
                          }}
                        >
                          <div className="font-medium text-sm">{p.name}</div>
                          <div className="text-gray-500 text-xs">
                            {p.desc ?? ""}
                          </div>
                          {p.source && (
                            <div className="mt-1">
                              <a
                                href={p.source}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 underline text-xs"
                              >
                                Nguồn
                              </a>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Blocking loading overlay shown while fetching boundaries or when the map is moving */}
        {mapLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none user-select-none">
            <div className="flex flex-col items-center pointer-events-none p-4 rounded">
              <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              <div className="mt-2 text-sm text-white">Đang tải bản đồ...</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapView;
// ...existing code...
