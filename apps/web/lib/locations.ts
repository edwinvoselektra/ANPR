export type Recorder={id:string;name:string;ipAddress:string;rtspPort:number;channelCount?:number|null};
export type VpnLocation={id:string;name:string;description?:string|null;routerType:string;vpnType:string;vpnMode:string;tunnelAddress:string;remoteLanCidr:string;remoteGatewayIp?:string|null;endpointHost?:string|null;listenPort:number;mtu:number;active:boolean;publicKey?:string|null;hasPrivateKey:boolean;connectionStatus:string;tunnelOnline?:boolean|null;routeReachable?:boolean|null;recorderReachable?:boolean|null;recorderPortOpen?:boolean|null;lastHandshakeAt?:string|null;lastCheckedAt?:string|null;lastSeenAt?:string|null;recorders:Recorder[];_count?:{cameras:number};cameras?:Array<{id:string;name:string;status:string;anprChannel:number}>};

export const locationStatusLabels:Record<string,string>={UNKNOWN:"Onbekend",CONNECTING:"Verbinden…",ONLINE:"Online",DEGRADED:"Deels beschikbaar",OFFLINE:"Offline"};
export const locationStatusColors:Record<string,string>={UNKNOWN:"gray",CONNECTING:"amber",ONLINE:"green",DEGRADED:"amber",OFFLINE:"red"};
export const routerLabels:Record<string,string>={TP_LINK_OMADA_ER605:"TP-Link Omada ER605",MANUAL_OTHER:"Handmatig / Andere router"};
