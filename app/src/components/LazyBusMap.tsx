import { Suspense, lazy } from 'react';
import type { ComponentProps } from 'react';
import type { BusMap as BusMapComponent } from './BusMap';

// MapLibre is roughly a megabyte of JavaScript. The trip runtime must stay fast on a phone
// in a vehicle, so the renderer is only fetched once a map is actually shown.
const BusMap = lazy(() => import('./BusMap').then((module) => ({ default: module.BusMap })));

export type { MapStop, MapBus, MapStopKind } from './BusMap';

export function LazyBusMap(props: ComponentProps<typeof BusMapComponent>) {
  return <Suspense fallback={<div className={`bus-map bus-map--${props.variant || 'staff'}`}><div className="bus-map__canvas bus-map__canvas--loading" /></div>}>
    <BusMap {...props} />
  </Suspense>;
}
