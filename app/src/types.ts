export type Locale = 'nl'|'fr';
export type EntryMode = 'BUS'|'PARENT';
export type BusSpaceRole = 'OWNER'|'DRIVER'|'ATTENDANT';
export type TripStatus = 'BOARDING'|'IN_TRANSIT'|'ARRIVED'|'COMPLETED'|'CANCELLED';
export type AttendanceStatus = 'EXPECTED'|'BOARDED'|'MISSED'|'DROPPED_OFF';
export type AvatarStyle = 'initials-blue'|'initials-green'|'initials-purple'|'initials-orange'|'initials-rose';

export type LocationChoice = { displayAddress:string; latitude:number; longitude:number; provider:string; reference:string|null };
export type SpaceSummary = { id:string; name:string; avatar_key:'bus'|'van'|'coach'|null; default_language:Locale; roles:BusSpaceRole[] };
export type ContextResponse = { user:{id:string;email:string|null;isAnonymous:boolean}; spaces:SpaceSummary[]; parentGrants:Array<{id:string;parent_access_id:string;last_seen_at:string}> };
export type Bus = { id:string;bus_space_id:string;name:string;avatar_key:'bus'|'van'|'coach';capacity:number;start_display_address:string;start_latitude:number;start_longitude:number;end_display_address:string|null;end_latitude:number|null;end_longitude:number|null };
export type Stop = { id:string;bus_space_id:string;bus_id:string;label:string|null;display_address:string;latitude:number;longitude:number;expected_passenger_count:number;manual_sequence:number;active:boolean };
export type Passenger = { id:string;bus_space_id:string;stop_id:string;display_name:string;avatar_key:string;active:boolean };
export type RoutePlanStop = { stop_id:string;sequence:number;estimated_arrival_offset_seconds:number;display_address_snapshot:string;latitude_snapshot:number;longitude_snapshot:number;expected_passenger_count_snapshot:number };
export type RoutePlan = { id:string;bus_id:string;provider:string;optimization_mode:'AUTOMATIC'|'MANUAL';distance_meters:number;duration_seconds:number;route_geometry:{type:'LineString';coordinates:Array<[number,number]>};provider_metadata:{estimate?:boolean;geometrySource?:'estimate'|'waypoints'|'road'};stale_at:string|null;stops:RoutePlanStop[] };
export type ParentAccessSummary = { id:string;parent_display_name:string;code_version:number;created_at:string;last_used_at:string|null;revoked_at:string|null;passengerIds:string[] };
export type ActiveTripSummary = { id:string;status:TripStatus;driver_session_id:string|null;route_plan_id:string;current_stop_sequence:number };
export type SpaceHome = { space:SpaceSummary;bus:Bus|null;stops:Stop[];passengers:Passenger[];routePlan:RoutePlan|null;activeTrip:ActiveTripSummary|null;members:Array<{id:string;user_id:string;role:BusSpaceRole}>;parentAccess:ParentAccessSummary[] };

export type TripStop = { id:string;source_stop_id:string;sequence:number;display_address:string;latitude:number;longitude:number;expected_passenger_count:number;estimated_arrival_offset_seconds:number;status:'PENDING'|'APPROACHING'|'AT_STOP'|'COMPLETED'|'SKIPPED' };
export type TripPassenger = { id:string;passenger_id:string;trip_stop_id:string;display_name_snapshot:string;avatar_key_snapshot:string;status:AttendanceStatus;version:number };
export type TripRuntimeResponse = { role:BusSpaceRole;trip:null|ActiveTripSummary&{bus:{id:string;name:string;avatar_key:string};stops:TripStop[];nextStop:TripStop|null;passengers:TripPassenger[]} };

export type ParentHome = { grantId:string;parent:{displayName:string};space:{id:string;name:string;avatar_key:string|null;default_language:Locale};bus:{id:string;name:string;avatar_key:string}|null;trip:null|{id:string;status:TripStatus;currentStopSequence:number;startedAt:string|null;location:null|{latitude:number;longitude:number;capturedAt:string}};passengers:Array<Passenger&{stop:null|{id:string;display_address:string;latitude:number;longitude:number};status:AttendanceStatus;statusVersion:number;etaMinutes:number|null}> };
export type BusNotification = {id:string;event_type:string;title:string;message:string;read_at:string|null;created_at:string};
