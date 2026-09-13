// PLACEHOLDER: constants. These have to come from the portal-backend, read
// with the signed-in user's token.
import type { PortalDataStructure } from "./types";

export const PORTAL_DATA_STRUCTURES: PortalDataStructure[] = [
  {
    urn: "urn:core:platform:civitas:datastructure:mobility:TrafficCounterReading:1.0.0",
    name: "TrafficCounterReading",
    version: "1.0.0",
    description:
      "Eine Zählstellen-Messung: Fahrzeuganzahl, Durchschnittsgeschwindigkeit, Richtung und Standort.",
    domain: "Mobilität",
    publisher: "Stadt Musterhausen",
    usedBy: ["Verkehrszählung"],
    properties: [
      { name: "counterId", type: "string", description: "Kennung der Zählstelle", required: true },
      { name: "timestamp", type: "string", format: "date-time", description: "Messzeitpunkt", required: true },
      { name: "vehicleCount", type: "integer", minimum: 0, maximum: 500, description: "Fahrzeuge im Intervall", required: true },
      { name: "avgSpeedKmh", type: "number", minimum: 0, maximum: 120, description: "Durchschnittsgeschwindigkeit", required: false },
      { name: "direction", type: "string", enum: ["inbound", "outbound"], description: "Fahrtrichtung", required: true },
      { name: "location.lat", type: "number", minimum: -90, maximum: 90, description: "Breitengrad", required: true },
      { name: "location.lon", type: "number", minimum: -180, maximum: 180, description: "Längengrad", required: true },
    ],
  },
  {
    urn: "urn:core:platform:civitas:datastructure:environment:AirQualityReading:1.0.0",
    name: "AirQualityReading",
    version: "1.0.0",
    description:
      "Eine Luftqualitätsmessung: PM2.5 und PM10 mit Temperatur, Luftfeuchte, Zeitpunkt und Standort.",
    domain: "Umwelt",
    publisher: "Stadt Musterhausen",
    usedBy: ["Luftqualität (SensorThings)", "Kiez-Klima Station"],
    properties: [
      { name: "stationId", type: "string", description: "Kennung der Messstation", required: true },
      { name: "timestamp", type: "string", format: "date-time", description: "Messzeitpunkt", required: true },
      { name: "pm25", type: "number", minimum: 0, maximum: 150, description: "Feinstaub PM2.5 in µg/m³", required: true },
      { name: "pm10", type: "number", minimum: 0, maximum: 250, description: "Feinstaub PM10 in µg/m³", required: true },
      { name: "temperature", type: "number", minimum: -20, maximum: 45, description: "Temperatur in °C", required: false },
      { name: "humidity", type: "number", minimum: 0, maximum: 100, description: "Relative Luftfeuchte in %", required: false },
      { name: "location.lat", type: "number", minimum: -90, maximum: 90, description: "Breitengrad", required: true },
      { name: "location.lon", type: "number", minimum: -180, maximum: 180, description: "Längengrad", required: true },
    ],
  },
  {
    urn: "urn:core:platform:civitas:datastructure:kataster:KiezBaum:1.0.0",
    name: "KiezBaum",
    version: "1.0.0",
    description:
      "Stammdaten eines Stadtbaums aus dem Fachverfahren: Baum-ID, Art, Pflanzjahr, Stammumfang, Standort.",
    domain: "Kataster",
    publisher: "Stadt Musterhausen",
    usedBy: ["Kiez-Baumkataster"],
    properties: [
      { name: "baum_id", type: "string", primaryKey: true, description: "Eindeutige Baum-ID", required: true },
      { name: "art", type: "string", enum: ["Linde", "Ahorn", "Platane", "Eiche", "Kastanie"], description: "Baumart", required: true },
      { name: "pflanzjahr", type: "integer", minimum: 1900, maximum: 2026, description: "Pflanzjahr", required: true },
      { name: "stammumfang_cm", type: "integer", minimum: 10, maximum: 400, description: "Stammumfang in cm", required: false },
      { name: "latitude", type: "number", minimum: -90, maximum: 90, description: "Breitengrad", required: true },
      { name: "longitude", type: "number", minimum: -180, maximum: 180, description: "Längengrad", required: true },
      { name: "erfasst_am", type: "string", format: "date-time", description: "Erfassungszeitpunkt", required: true },
    ],
  },
  {
    urn: "urn:core:platform:civitas:datastructure:energy:SmartPlugReading:1.0.0",
    name: "SmartPlugReading",
    version: "1.0.0",
    description:
      "Elektrische Messwerte einer Tasmota-Steckdose: Leistung, Spannung, Strom, Frequenz.",
    domain: "Energie",
    publisher: "Civitas Connect e. V.",
    usedBy: ["Smart Grid / Netzschutz"],
    properties: [
      { name: "plugId", type: "string", description: "Kennung der Steckdose", required: true },
      { name: "timestamp", type: "string", format: "date-time", description: "Messzeitpunkt", required: true },
      { name: "powerW", type: "number", minimum: 0, maximum: 3500, description: "Leistung in W", required: true },
      { name: "voltageV", type: "number", minimum: 200, maximum: 250, description: "Spannung in V", required: true },
      { name: "currentA", type: "number", minimum: 0, maximum: 16, description: "Stromstärke in A", required: true },
      { name: "frequencyHz", type: "number", minimum: 49.5, maximum: 50.5, description: "Netzfrequenz in Hz", required: false },
      { name: "relayOn", type: "boolean", description: "Schaltzustand", required: true },
    ],
  },
  {
    urn: "urn:core:platform:civitas:datastructure:common:GeoPoint:1.0.0",
    name: "GeoPoint",
    version: "1.0.0",
    description: "Geokoordinate (Breite, Länge) als gemeinsames Element, von anderen Strukturen eingebettet.",
    domain: "Basis",
    publisher: "Civitas Connect e. V.",
    usedBy: [],
    properties: [
      { name: "lat", type: "number", minimum: -90, maximum: 90, description: "Breitengrad", required: true },
      { name: "lon", type: "number", minimum: -180, maximum: 180, description: "Längengrad", required: true },
    ],
  },
];

export function findDataStructure(urn: string | undefined): PortalDataStructure | undefined {
  return urn ? PORTAL_DATA_STRUCTURES.find((d) => d.urn === urn) : undefined;
}
