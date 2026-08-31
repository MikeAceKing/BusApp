export type Locale = 'nl'|'fr';
export type EntryMode = 'BUS'|'PARENT';
export type BusSpaceRole = 'OWNER'|'DRIVER'|'ATTENDANT';
export type TripStatus = 'BOARDING'|'IN_TRANSIT'|'ARRIVED'|'COMPLETED'|'CANCELLED';
export type AttendanceStatus = 'EXPECTED'|'BOARDED'|'MISSED'|'DROPPED_OFF';
export type GeometrySource = 'road'|'waypoints'|'estimate';
export type RouteAccuracy = 'ROAD'|'ESTIMATE';
export type RouteUxState = 'NOT_CALCULATED'|'CALCULATING'|'ROAD_ROUTE_READY'|'ESTIMATE_READY'|'MAP_UNAVAILABLE'|'PROVIDER_FAILED';
export type AvatarStyle = 'initials-blue'|'initials-green'|'initials-purple'|'initials-orange'|'initials-rose';
export type AvatarReference = { source:'BUILT_IN'|'UPLOAD';builtInAvatarId:string|null;assetId:string|null;version:number;photoUrl:string|null };
export type UserProfile = {user_id:string;display_name:string;language:Locale;avatar_version:number;avatar:AvatarReference};

export type LocationChoice = { displayAddress:string; latitude:number; longitude:number; provider:string; reference:string|null };
export type SpaceSummary = { id:string; name:string; avatar_key:'bus'|'van'|'coach'|null; default_language:Locale; roles:BusSpaceRole[] };
export type ContextResponse = { user:{id:string;email:string|null;isAnonymous:boolean};profile?:UserProfile; spaces:SpaceSummary[]; parentGrants:Array<{id:string;parent_access_id:string;last_seen_at:string}> };
export type Bus = { id:string;bus_space_id:string;name:string;avatar_key:'bus'|'van'|'coach';avatar?:AvatarReference;avatar_version?:number;capacity:number;start_display_address:string;start_latitude:number;start_longitude:number;end_display_address:string|null;end_latitude:number|null;end_longitude:number|null };
export type Stop = { id:string;bus_space_id:string;bus_id:string;label:string|null;display_address:string;latitude:number;longitude:number;expected_passenger_count:number;manual_sequence:number;active:boolean };
export type Passenger = { id:string;bus_space_id:string;stop_id:string;display_name:string;avatar_key:string;avatar?:AvatarReference;avatar_version?:number;active:boolean };
export type RoutePlanStop = { stop_id:string;sequence:number;estimated_arrival_offset_seconds:number;display_address_snapshot:string;latitude_snapshot:number;longitude_snapshot:number;expected_passenger_count_snapshot:number };
export type RoutePlan = { id:string;bus_id:string;provider:string;optimization_mode:'AUTOMATIC'|'MANUAL';distance_meters:number;duration_seconds:number;route_geometry:{type:'LineString';coordinates:Array<[number,number]>};provider_metadata:{estimate?:boolean;geometrySource?:GeometrySource;accuracy?:RouteAccuracy;fallbackReason?:string};stale_at:string|null;stops:RoutePlanStop[] };
export type ParentAccessSummary = { id:string;parent_display_name:string;code_version:number;created_at:string;last_used_at:string|null;revoked_at:string|null;passengerIds:string[] };
export type ActiveTripSummary = { id:string;status:TripStatus;driver_session_id:string|null;route_plan_id:string;current_stop_sequence:number };
export type BusSpacePermissions = { manageBusProfile:boolean };
export type SpaceHome = { space:SpaceSummary;profile?:UserProfile;bus:Bus|null;stops:Stop[];passengers:Passenger[];routePlan:RoutePlan|null;activeTrip:ActiveTripSummary|null;members:Array<{id:string;user_id:string;role:BusSpaceRole}>;parentAccess:ParentAccessSummary[];role?:BusSpaceRole;permissions?:BusSpacePermissions };

export type TripStop = { id:string;source_stop_id:string;sequence:number;display_address:string;latitude:number;longitude:number;expected_passenger_count:number;estimated_arrival_offset_seconds:number;status:'PENDING'|'APPROACHING'|'AT_STOP'|'COMPLETED'|'SKIPPED' };
export type TripPassenger = { id:string;passenger_id:string;trip_stop_id:string;display_name_snapshot:string;avatar_key_snapshot:string;avatar?:AvatarReference;status:AttendanceStatus;version:number };
export type TripRuntimeResponse = { role:BusSpaceRole;trip:null|ActiveTripSummary&{bus:{id:string;name:string;avatar_key:string};stops:TripStop[];nextStop:TripStop|null;passengers:TripPassenger[]} };

export type ParentHome = { grantId:string;parent:{displayName:string;profile?:UserProfile};space:{id:string;name:string;avatar_key:string|null;default_language:Locale};bus:(Pick<Bus,'id'|'name'|'avatar_key'|'avatar'>)|null;trip:null|{id:string;status:TripStatus;currentStopSequence:number;startedAt:string|null;location:null|{latitude:number;longitude:number;capturedAt:string}};passengers:Array<Passenger&{stop:null|{id:string;display_address:string;latitude:number;longitude:number};status:AttendanceStatus;statusVersion:number;etaMinutes:number|null}> };
export type BusNotification = {id:string;event_type:string;title:string;message:string;read_at:string|null;created_at:string};

export type ParentVisibleStaffProfile = { displayName:string; role:'DRIVER'|'ATTENDANT'; avatar:AvatarReference };
export type ParentMapContext = {
  bus:{ latitude:number; longitude:number }|null;
  ownStop:{ latitude:number; longitude:number; displayLabel:string }|null;
  etaSeconds:number|null;
  routeGeometry:{ type:'LineString'; coordinates:Array<[number,number]> }|null;
};
export type ParentVisibleBusProfile = {
  bus:{ displayName:string; avatar:AvatarReference; currentTripStatus:TripStatus|null };
  driver:ParentVisibleStaffProfile|null;
  attendant:ParentVisibleStaffProfile|null;
  ownStop:{ displayAddress:string }|null;
  map?:ParentMapContext;
};
