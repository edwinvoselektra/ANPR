export const vehicleColors: Record<string, string> = {
  BLACK: "Zwart", WHITE: "Wit", GRAY: "Grijs", SILVER: "Zilver", RED: "Rood", BLUE: "Blauw",
  GREEN: "Groen", YELLOW: "Geel", BROWN: "Bruin", ORANGE: "Oranje", OTHER: "Overig", UNKNOWN: "Onbekend"
};

export const vehicleTypes: Record<string, string> = {
  CAR: "Personenauto", VAN: "Bestelauto", TRUCK: "Vrachtwagen", MOTORCYCLE: "Motor",
  BUS: "Bus", TRAILER: "Aanhanger", UNKNOWN: "Onbekend"
};

import {directionLabels} from "@anpr/shared";
export const directions:Record<string,string>=directionLabels;
