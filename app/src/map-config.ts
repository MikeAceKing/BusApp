// Central map configuration. The style provider is replaceable without touching any
// component or domain logic, so a later move to Protomaps/PMTiles, MapTiler or a
// self-hosted style is a configuration change only.
export type MapStyleProvider = 'openfreemap' | 'custom';

// OpenFreeMap's public instance needs no API key and no registration, so this URL is
// safe to ship in the browser bundle. It is a public style, not a secret.
const openFreeMapStyles = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/bright',
  positron: 'https://tiles.openfreemap.org/styles/positron',
} as const;

export const mapStyleProvider: MapStyleProvider =
  String(import.meta.env.VITE_MAP_STYLE_PROVIDER || 'openfreemap') === 'custom' ? 'custom' : 'openfreemap';

// Liberty carries the colourful, friendly character BusApp already uses; the greyscale
// business styles would fight the warm school-bus identity.
export const mapStyleUrl: string =
  String(import.meta.env.VITE_MAP_STYLE_URL || '') || openFreeMapStyles.liberty;

// Attribution is required and must stay visible.
export const mapAttribution =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

// Belgium/France operating area, used to frame the map before any coordinate is known.
export const mapDefaultCenter: [number, number] = [4.35, 50.85];
export const mapDefaultZoom = 8;
